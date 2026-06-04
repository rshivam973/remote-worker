/**
 * In-memory job registry + SSE fan-out (platform TRD §6, §9). One process,
 * long-lived (next start). Survives dev HMR via a globalThis singleton.
 */
import { randomUUID } from "node:crypto";
import type { JobRequest, JobStatus, SandboxDetails, SandboxState, PiEvent, ControlCommand } from "./contracts";
import type { DaytonaRunner } from "./daytona-runner";
import * as store from "./store";
import type { MutationResult } from "./store";

/** Request with secrets stripped — safe to expose. */
export type SafeJobRequest = Omit<JobRequest, "provider_api_key" | "github_pat">;

export type { SandboxState };

export interface Job {
  id: string;
  ownerId: string;
  title: string | null;
  status: JobStatus;
  request: SafeJobRequest;
  sandboxId: string | null;
  sandboxState: SandboxState;
  sandboxDetails: SandboxDetails | null;
  events: PiEvent[];
  subscribers: Set<(e: PiEvent) => void>;
  prUrl: string | null;
  resultStatus: string | null;
  error: string | null;
  archivedAt: string | null;
  createdAt: string;
  runner: DaytonaRunner | null;
}

export type SandboxAction = "stop" | "start" | "destroy";

const EVENT_BUFFER_CAP = 5000;
const TERMINAL: ReadonlySet<JobStatus> = new Set(["completed", "failed", "stopped"]);

class JobManager {
  private readonly jobs = new Map<string, Job>();

  create(request: JobRequest, ownerId: string): Job {
    const { provider_api_key: _k, github_pat: _p, ...safe } = request;
    const job: Job = {
      id: randomUUID(),
      ownerId,
      title: null,
      status: "provisioning",
      request: safe,
      sandboxId: null,
      sandboxState: "pending",
      sandboxDetails: null,
      events: [],
      subscribers: new Set(),
      prUrl: null,
      resultStatus: null,
      error: null,
      archivedAt: null,
      createdAt: new Date().toISOString(),
      runner: null,
    };
    this.jobs.set(job.id, job);

    // Persist the conversation (DB = durable source of truth).
    store.insertConversation({
      id: job.id,
      owner_id: ownerId,
      title: null,
      status: job.status,
      issue_id: safe.issue_id ?? null,
      repo: safe.repo,
      base_ref: safe.base_ref ?? null,
      instructions: safe.instructions ?? null,
      provider: safe.provider ?? null,
      sandbox_id: null,
      sandbox_state: job.sandboxState,
      sandbox_details: null,
      pr_url: null,
      result_status: null,
      error: null,
      archived_at: null,
      created_at: job.createdAt,
    });

    return job;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  getForUser(id: string, ownerId: string): Job | undefined {
    const job = this.jobs.get(id);
    return job?.ownerId === ownerId ? job : undefined;
  }

  /** Merge a patch into a live job AND persist it. Flushes the event log on terminal status. */
  update(
    id: string,
    patch: Partial<{
      status: JobStatus;
      title: string | null;
      sandboxId: string | null;
      sandboxState: SandboxState;
      sandboxDetails: SandboxDetails | null;
      prUrl: string | null;
      resultStatus: string | null;
      error: string | null;
      archivedAt: string | null;
    }>,
  ): Promise<MutationResult> {
    const job = this.jobs.get(id);
    if (!job) return Promise.resolve({ ok: false, error: "job not found" });
    if (patch.status !== undefined) job.status = patch.status;
    if (patch.title !== undefined) job.title = patch.title;
    if (patch.sandboxId !== undefined) job.sandboxId = patch.sandboxId;
    if (patch.sandboxState !== undefined) job.sandboxState = patch.sandboxState;
    if (patch.sandboxDetails !== undefined) job.sandboxDetails = patch.sandboxDetails;
    if (patch.prUrl !== undefined) job.prUrl = patch.prUrl;
    if (patch.resultStatus !== undefined) job.resultStatus = patch.resultStatus;
    if (patch.error !== undefined) job.error = patch.error;
    if (patch.archivedAt !== undefined) job.archivedAt = patch.archivedAt;

    return store.updateConversation(id, {
      status: patch.status,
      title: patch.title,
      sandbox_id: patch.sandboxId,
      sandbox_state: patch.sandboxState,
      sandbox_details: patch.sandboxDetails,
      pr_url: patch.prUrl,
      result_status: patch.resultStatus,
      error: patch.error,
      archived_at: patch.archivedAt,
    });
  }

  /** Flush + close the event batcher for a job. Call once when the run ends. */
  async endPersistence(id: string): Promise<void> {
    await store.finalizeConversation(id);
  }

  list(ownerId: string, archived = false): Job[] {
    return [...this.jobs.values()]
      .filter((job) => job.ownerId === ownerId && (archived ? !!job.archivedAt : !job.archivedAt))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  rename(id: string, ownerId: string, title: string): Job | null {
    const job = this.getForUser(id, ownerId);
    if (!job) return null;
    this.update(id, { title });
    return job;
  }

  setArchived(id: string, ownerId: string, archived: boolean): Job | null {
    const job = this.getForUser(id, ownerId);
    if (!job) return null;
    this.update(id, { archivedAt: archived ? new Date().toISOString() : null });
    return job;
  }

  async prepareDeleteForUser(id: string, ownerId: string): Promise<boolean> {
    const job = this.getForUser(id, ownerId);
    if (!job) return false;
    if (job.runner && job.sandboxState !== "destroyed") {
      try {
        await job.runner.destroySandbox();
      } catch {
        /* best-effort: delete the conversation even if Daytona cleanup fails */
      }
    }
    await store.finalizeConversation(id);
    return true;
  }

  removeForUser(id: string, ownerId: string): boolean {
    const job = this.getForUser(id, ownerId);
    if (!job) return false;
    this.jobs.delete(id);
    return true;
  }

  async deleteForUser(id: string, ownerId: string): Promise<boolean> {
    const prepared = await this.prepareDeleteForUser(id, ownerId);
    if (!prepared) return false;
    return this.removeForUser(id, ownerId);
  }

  /** Dev HMR keeps the singleton instance but reloads the class; keep old jobs compatible. */
  ensureCurrentShape(): void {
    for (const job of this.jobs.values()) {
      if (job.title === undefined) job.title = null;
      if (job.archivedAt === undefined) job.archivedAt = null;
    }
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
      const details = await job.runner.stopSandbox();
      this.update(id, { sandboxState: details?.state ?? "stopped", sandboxDetails: details });
      this.emitPlatform(id, "Sandbox stopped.");
    } else if (action === "start") {
      const details = await job.runner.startSandbox();
      this.update(id, { sandboxState: details?.state ?? "active", sandboxDetails: details });
      this.emitPlatform(id, "Sandbox resumed.");
    } else {
      const details = await job.runner.destroySandbox();
      this.update(id, { sandboxState: "destroyed", sandboxDetails: details });
      this.emitPlatform(id, "Sandbox destroyed.");
    }
    return job.sandboxState;
  }

  async refreshSandboxDetails(id: string): Promise<SandboxDetails | null> {
    const job = this.jobs.get(id);
    if (!job?.runner || job.sandboxState === "destroyed") return job?.sandboxDetails ?? null;
    let details: SandboxDetails | null;
    try {
      details = await job.runner.refreshSandboxDetails();
    } catch {
      return job.sandboxDetails;
    }
    if (details) this.update(id, { sandboxState: details.state, sandboxDetails: details });
    return details;
  }
}

// HMR-safe singleton.
const g = globalThis as unknown as { __jobManager?: JobManager };
if (g.__jobManager) {
  Object.setPrototypeOf(g.__jobManager, JobManager.prototype);
  g.__jobManager.ensureCurrentShape();
} else {
  g.__jobManager = new JobManager();
}
export const jobManager: JobManager = g.__jobManager;
