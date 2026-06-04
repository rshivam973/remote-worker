/**
 * Daytona SDK wrapper (platform TRD §4, §5). Owns one sandbox for one job:
 * provision → bootstrap toolchain → install pi-coder → run it as an async
 * session command, streaming its stdout (NDJSON events) and relaying control to
 * its stdin. No changes to pi-coder — its stdin/stdout contract is honored
 * directly over the SDK.
 */
import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytonaio/sdk";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PiEvent, ControlCommand, SandboxDetails } from "./contracts";
import { destroyedSandboxSnapshot, snapshotSandbox } from "./sandbox-status";

const execFileAsync = promisify(execFile);

const PI_DIR = "/tmp/pi-coder";
const PI_INSTALL = "/opt/pi-coder";
const BIN = "/usr/local/bin";

export interface RunnerConfig {
  apiKey: string;
  image: string;
  cpu: number;
  memory: number;
  disk: number;
  piCoderSource: "upload" | "git";
  piCoderRepoUrl: string;
  piCoderLocalPath: string;
}

export function runnerConfigFromEnv(): RunnerConfig {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) throw new Error("DAYTONA_API_KEY is not set");
  return {
    apiKey,
    image: process.env.SANDBOX_IMAGE ?? "node:22-bookworm",
    cpu: Number(process.env.SANDBOX_CPU ?? 2),
    memory: Number(process.env.SANDBOX_MEMORY ?? 4),
    disk: Number(process.env.SANDBOX_DISK ?? 10),
    piCoderSource: (process.env.PI_CODER_SOURCE as "upload" | "git") ?? "upload",
    piCoderRepoUrl: process.env.PI_CODER_REPO_URL ?? "",
    piCoderLocalPath: resolve(process.env.PI_CODER_LOCAL_PATH ?? "../pi-coding-agent"),
  };
}

type LogFn = (line: string) => void;

export class DaytonaRunner {
  private readonly daytona: Daytona;
  private sandbox: Sandbox | null = null;
  private sessionId: string | null = null;
  private cmdId: string | null = null;
  /** Control commands sent before pi-coder is running; flushed once it starts. */
  private pendingControl: ControlCommand[] = [];

  constructor(private readonly cfg: RunnerConfig) {
    this.daytona = new Daytona({ apiKey: cfg.apiKey });
  }

  get sandboxId(): string | null {
    return this.sandbox?.id ?? null;
  }

  async refreshSandboxDetails(): Promise<SandboxDetails | null> {
    if (!this.sandbox) return null;
    try {
      await this.sandbox.refreshData();
      return snapshotSandbox(this.sandbox);
    } catch (err) {
      if (err instanceof DaytonaNotFoundError || (err as { statusCode?: number }).statusCode === 404) {
        const details = destroyedSandboxSnapshot(this.sandbox.id, "Daytona reports this sandbox was destroyed or deleted.");
        this.sandbox = null;
        return details;
      }
      throw err;
    }
  }

  /** Create the sandbox with the run secrets injected as env vars. */
  async provision(env: Record<string, string>): Promise<void> {
    this.sandbox = await this.daytona.create(
      {
        image: this.cfg.image,
        resources: { cpu: this.cfg.cpu, memory: this.cfg.memory, disk: this.cfg.disk },
        envVars: env,
        labels: { app: "pr-factory" },
        autoStopInterval: 30,
        autoDeleteInterval: 120,
      },
      { timeout: 180 },
    );
  }

  private sb(): Sandbox {
    if (!this.sandbox) throw new Error("sandbox not provisioned");
    return this.sandbox;
  }

  /** run a one-shot command; throws with stderr/stdout on non-zero exit. */
  private async exec(command: string, timeout = 300, label = "command"): Promise<string> {
    const res = await this.sb().process.executeCommand(command, undefined, undefined, timeout);
    if (res.exitCode !== 0) {
      throw new Error(`${label} failed (exit ${res.exitCode}): ${(res.result || "").slice(-2000)}`);
    }
    return res.result || "";
  }

  /** Install git, ripgrep, and bun; expose bun on PATH. */
  async bootstrap(log: LogFn): Promise<void> {
    log("Installing system tools (git, ripgrep)…");
    await this.exec("apt-get update -qq 2>/dev/null && apt-get install -y git ripgrep 2>&1", 600, "apt install");
    log("Installing bun…");
    await this.exec("curl -fsSL https://bun.sh/install | bash 2>&1", 300, "bun install");
    await this.exec(`ln -sf "$HOME/.bun/bin/bun" ${BIN}/bun`, 30, "bun symlink");
    const ver = await this.exec(`${BIN}/bun --version`, 30, "bun version");
    log(`bun ${ver.trim()} ready`);
  }

  /** Place pi-coder at /opt/pi-coder, install deps, and expose a `pi-coder` launcher. */
  async installPiCoder(log: LogFn): Promise<void> {
    if (this.cfg.piCoderSource === "git") {
      if (!this.cfg.piCoderRepoUrl) throw new Error("PI_CODER_REPO_URL required for git source");
      log(`Cloning pi-coder from ${this.cfg.piCoderRepoUrl}…`);
      await this.exec(`git clone --depth 1 ${shellQuote(this.cfg.piCoderRepoUrl)} ${PI_INSTALL} 2>&1`, 300, "git clone pi-coder");
    } else {
      log("Uploading pi-coder source…");
      const tgz = join(tmpdir(), `pi-coder-${Date.now()}.tgz`);
      await execFileAsync("tar", [
        "-czf", tgz,
        "-C", this.cfg.piCoderLocalPath,
        "--exclude", "node_modules",
        "--exclude", "dist",
        "--exclude", ".git",
        ".",
      ]);
      await this.exec(`mkdir -p ${PI_INSTALL}`, 30, "mkdir install");
      await this.sb().fs.uploadFile(tgz, "/tmp/pi-coder-src.tgz");
      await this.exec(`tar -xzf /tmp/pi-coder-src.tgz -C ${PI_INSTALL} 2>&1`, 120, "extract pi-coder");
    }

    log("Installing pi-coder dependencies…");
    await this.exec(`cd ${PI_INSTALL} && ${BIN}/bun install 2>&1`, 600, "bun install pi-coder");

    // Launcher so `pi-coder ...` works on PATH for the session command.
    const launcher = `#!/usr/bin/env bash\nexec ${BIN}/bun ${PI_INSTALL}/src/cli.ts "$@"\n`;
    await this.sb().fs.uploadFile(Buffer.from(launcher), `${BIN}/pi-coder`);
    await this.exec(`chmod +x ${BIN}/pi-coder`, 30, "chmod launcher");

    const ready = await this.exec(`cd ${PI_DIR} 2>/dev/null; mkdir -p ${PI_DIR}; pi-coder --help >/dev/null 2>&1 && echo ok || echo fail`, 60, "pi-coder check");
    if (!ready.includes("ok")) throw new Error("pi-coder launcher did not run");
    log("pi-coder installed");
  }

  /** Write task.json into the sandbox. */
  async uploadTask(task: Record<string, unknown>): Promise<void> {
    await this.exec(`mkdir -p ${PI_DIR}`, 30, "mkdir pi-dir");
    await this.sb().fs.uploadFile(Buffer.from(JSON.stringify(task, null, 2)), `${PI_DIR}/task.json`);
  }

  /**
   * Start pi-coder as an async session command and stream its output.
   * onEvent receives parsed NDJSON events (stdout); onStderr receives raw log
   * chunks. Returns a promise that resolves when the process exits.
   */
  async start(jobId: string, onEvent: (e: PiEvent) => void, onStderr: LogFn): Promise<void> {
    const sandbox = this.sb();
    this.sessionId = `job-${jobId}`;
    await sandbox.process.createSession(this.sessionId);

    const cmd =
      `cd ${PI_DIR} && pi-coder run --task ${PI_DIR}/task.json ` +
      `--output ${PI_DIR}/result.json --workdir ${PI_DIR}/workspace`;
    const res = await sandbox.process.executeSessionCommand(this.sessionId, { command: cmd, runAsync: true });
    this.cmdId = res.cmdId;

    // Flush any control commands the user sent while we were still booting.
    for (const c of this.pendingControl.splice(0)) {
      try {
        await sandbox.process.sendSessionCommandInput(this.sessionId, this.cmdId, JSON.stringify(c) + "\n");
      } catch {
        /* best-effort */
      }
    }

    // Buffer partial lines; emit only complete NDJSON lines.
    let buf = "";
    const onStdout = (chunk: string) => {
      buf += chunk;
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          onEvent(JSON.parse(line) as PiEvent);
        } catch {
          // non-JSON line on stdout — forward as a stderr-style log
          onStderr(line);
        }
      }
    };

    await sandbox.process.getSessionCommandLogs(this.sessionId, this.cmdId, onStdout, (c) => onStderr(c));
    if (buf.trim()) onStdout("\n");
  }

  /** Relay a control command to pi-coder's stdin (buffered until it's running). */
  async sendControl(cmd: ControlCommand): Promise<void> {
    if (!this.sessionId || !this.cmdId) {
      this.pendingControl.push(cmd);
      return;
    }
    await this.sb().process.sendSessionCommandInput(this.sessionId, this.cmdId, JSON.stringify(cmd) + "\n");
  }

  /** Read the final result.json (after the process exits). Null if absent/unreadable. */
  async readResult(): Promise<Record<string, unknown> | null> {
    try {
      const out = await this.sb().process.executeCommand(`cat ${PI_DIR}/result.json`, undefined, undefined, 30);
      return out.exitCode === 0 ? (JSON.parse(out.result) as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }

  // --- sandbox lifecycle controls -----------------------------------------

  /** Best-known sandbox state ("started" | "stopped" | …). */
  getState(): string | null {
    return (this.sandbox?.state as string | undefined) ?? null;
  }

  /** Suspend the sandbox (Daytona also auto-stops idle ones). */
  async stopSandbox(): Promise<SandboxDetails | null> {
    await this.sb().stop(60);
    return this.refreshSandboxDetails();
  }

  /** Resume a stopped sandbox. */
  async startSandbox(): Promise<SandboxDetails | null> {
    await this.sb().start(60);
    return this.refreshSandboxDetails();
  }

  /** Destroy the sandbox permanently. */
  async destroySandbox(): Promise<SandboxDetails> {
    const id = this.sb().id;
    await this.sb().delete(60);
    this.sandbox = null;
    return destroyedSandboxSnapshot(id, "Sandbox was destroyed from the PR Factory console.");
  }

  /** Alias used by the orchestrator's cleanup path. */
  async teardown(): Promise<void> {
    if (this.sandbox) {
      try {
        await this.sandbox.delete();
      } catch {
        /* best-effort */
      }
      this.sandbox = null;
    }
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
