/**
 * In-memory job registry + SSE fan-out (platform TRD §6, §9). One process,
 * long-lived (next start). Survives dev HMR via a globalThis singleton.
 */
import { randomUUID } from "node:crypto";
import type { JobRequest, JobStatus, SandboxState, PiEvent, ControlCommand } from "./contracts";
import type { DaytonaRunner } from "./daytona-runner";
import * as store from "./store";

/** Request with secrets stripped — safe to expose. */
export type SafeJobRequest = Omit<JobRequest, "provider_api_key" | "github_pat">;

export type { SandboxState };

export interface Job {
  id: string;
  status: JobStatus;
  request: SafeJobRequest;
  sandboxId: string | null;
  sandboxState: SandboxState;
  events: PiEvent[];
  subscribers: Set<(e: PiEvent) => void>;
  prUrl: string | null;
  resultStatus: string | null;
  error: string | null;
  createdAt: string;
  runner: DaytonaRunner | null;
}

export type SandboxAction = "stop" | "start" | "destroy";

const EVENT_BUFFER_CAP = 5000;
const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "stopped"]);

class JobManager {
  private readonly jobs = new Map<string, Job>();

  create(request: JobRequest): Job {
    const { provider_api_key: _k, github_pat: _p, ...safe } = request;
    const job: Job = {
      id: randomUUID(),
      status: "provisioning",
      request: safe,
      sandboxId: null,
      sandboxState: "pending",
      events: [],
      subscribers: new Set(),
      prUrl: null,
      resultStatus: null,
      error: null,
      createdAt: new Date().toISOString(),
      runner: null,
    };
    this.jobs.set(job.id, job);

    // Persist the conversation (DB = durable source of truth).
    store.insertConversation({
      id: job.id,
      status: job.status,
      issue_id: safe.issue_id ?? null,
      repo: safe.repo,
      base_ref: safe.base_ref ?? null,
      instructions: safe.instructions ?? null,
      provider: safe.provider ?? null,
      sandbox_id: null,
      sandbox_state: job.sandboxState,
      pr_url: null,
      result_status: null,
      error: null,
      created_at: job.createdAt,
    });

    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Merge a patch into a live job AND persist it. Flushes the event log on terminal status. */
  update(
    id: string,
    patch: Partial<{
      status: JobStatus;
      sandboxId: string | null;
      sandboxState: SandboxState;
      prUrl: string | null;
      resultStatus: string | null;
      error: string | null;
    }>,
  ): void {
    const job = this.jobs.get(id);
    if (!job) return;
    if (patch.status !== undefined) job.status = patch.status;
    if (patch.sandboxId !== undefined) job.sandboxId = patch.sandboxId;
    if (patch.sandboxState !== undefined) job.sandboxState = patch.sandboxState;
    if (patch.prUrl !== undefined) job.prUrl = patch.prUrl;
    if (patch.resultStatus !== undefined) job.resultStatus = patch.resultStatus;
    if (patch.error !== undefined) job.error = patch.error;

    store.updateConversation(id, {
      status: patch.status,
      sandbox_id: patch.sandboxId,
      sandbox_state: patch.sandboxState,
      pr_url: patch.prUrl,
      result_status: patch.resultStatus,
      error: patch.error,
    });
  }

  /** Flush + close the event batcher for a job. Call once when the run ends. */
  async endPersistence(id: string): Promise<void> {
    await store.finalizeConversation(id);
  }

  list(): Job[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  setStatus(id: string, status: JobStatus): void {
    this.update(id, { status });
  }

  isTerminal(id: string): boolean {
    const job = this.jobs.get(id);
    return job ? TERMINAL.has(job.status) : true;
  }

  /** Emit a synthetic platform event (provisioning/bootstrap/info/error). */
  emitPlatform(id: string, message: string, level: "info" | "error" = "info"): void {
    this.pushEvent(id, { type: "platform", level, message, ts: new Date().toISOString() });
  }

  pushEvent(id: string, event: PiEvent): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.events.push(event);
    if (job.events.length > EVENT_BUFFER_CAP) job.events.shift();

    // Persist the event (coalesced + batched inside the store).
    store.recordEvent(id, event);

    // Surface key fields onto the conversation row.
    if (event.type === "pr_created" && typeof event.url === "string") {
      job.prUrl = event.url;
      store.updateConversation(id, { pr_url: event.url });
    }
    if (event.type === "done" && typeof event.status === "string") {
      job.resultStatus = event.status;
      store.updateConversation(id, { result_status: event.status });
    }

    for (const sub of job.subscribers) {
      try {
        sub(event);
      } catch {
        /* a dead subscriber must not break others */
      }
    }
  }

  /** Atomically snapshot buffered events and attach a live subscriber. */
  subscribe(id: string, cb: (e: PiEvent) => void): { replay: PiEvent[]; unsubscribe: () => void } {
    const job = this.jobs.get(id);
    if (!job) return { replay: [], unsubscribe: () => {} };
    const replay = [...job.events];
    job.subscribers.add(cb);
    return { replay, unsubscribe: () => job.subscribers.delete(cb) };
  }

  async sendControl(id: string, cmd: ControlCommand): Promise<void> {
    const job = this.jobs.get(id);
    if (!job?.runner) throw new Error("job not running");
    await job.runner.sendControl(cmd);
  }

  /** Stop / start / destroy the job's sandbox; updates sandboxState. */
  async sandboxAction(id: string, action: SandboxAction): Promise<SandboxState> {
    const job = this.jobs.get(id);
    if (!job?.runner) throw new Error("no sandbox for this job");
    if (job.sandboxState === "destroyed") throw new Error("sandbox already destroyed");

    if (action === "stop") {
      await job.runner.stopSandbox();
      this.update(id, { sandboxState: "stopped" });
      this.emitPlatform(id, "Sandbox stopped.");
    } else if (action === "start") {
      await job.runner.startSandbox();
      this.update(id, { sandboxState: "active" });
      this.emitPlatform(id, "Sandbox resumed.");
    } else {
      await job.runner.destroySandbox();
      this.update(id, { sandboxState: "destroyed" });
      this.emitPlatform(id, "Sandbox destroyed.");
    }
    return job.sandboxState;
  }
}

// HMR-safe singleton.
const g = globalThis as unknown as { __jobManager?: JobManager };
export const jobManager: JobManager = g.__jobManager ?? (g.__jobManager = new JobManager());
