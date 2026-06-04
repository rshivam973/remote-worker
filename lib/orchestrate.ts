/**
 * The async provision → bootstrap → run → finalize flow (platform TRD §9).
 * Kicked off (not awaited) by POST /api/jobs. Advances job status and streams
 * pi-coder events + synthetic platform events to subscribers.
 */
import type { JobRequest } from "./contracts";
import { jobManager, type Job } from "./job-manager";
import { buildTask } from "./task-builder";
import { DaytonaRunner, runnerConfigFromEnv } from "./daytona-runner";

export function startJob(job: Job, request: JobRequest): void {
  // Fire and forget; the function manages the job's lifecycle internally.
  void run(job, request);
}

async function run(job: Job, request: JobRequest): Promise<void> {
  const id = job.id;
  const { task, env } = buildTask(request);

  let runner: DaytonaRunner;
  try {
    runner = new DaytonaRunner(runnerConfigFromEnv());
  } catch (err) {
    fail(id, `Configuration error: ${(err as Error).message}`);
    return;
  }
  job.runner = runner;

  try {
    jobManager.setStatus(id, "provisioning");
    jobManager.emitPlatform(id, "Provisioning Daytona sandbox…");
    await runner.provision(env);
    const details = await runner.refreshSandboxDetails();
    jobManager.update(id, {
      sandboxId: runner.sandboxId,
      sandboxState: details?.state ?? "active",
      sandboxDetails: details,
    });
    jobManager.emitPlatform(id, `Sandbox ready (${runner.sandboxId}).`);

    jobManager.setStatus(id, "bootstrapping");
    await runner.bootstrap((l) => jobManager.emitPlatform(id, l));
    await runner.installPiCoder((l) => jobManager.emitPlatform(id, l));
    await runner.uploadTask(task);
    jobManager.emitPlatform(id, "Task uploaded. Starting pi-coder…");

    jobManager.setStatus(id, "running");
    // Blocks until the pi-coder process exits; events stream via the callback.
    await runner.start(
      id,
      (e) => jobManager.pushEvent(id, e),
      (line) => {
        // Keep stderr noise low: only forward non-empty trimmed lines.
        const t = line.trim();
        if (t) jobManager.emitPlatform(id, t);
      },
    );

    // Process exited — capture the final result.
    const result = await runner.readResult();
    const status = (result?.status as string) ?? job.resultStatus ?? "unknown";
    let prUrl: string | undefined;
    if (typeof result?.artifacts === "object" && result.artifacts) {
      const pr = (result.artifacts as Record<string, unknown>).pr_url;
      if (typeof pr === "string") prUrl = pr;
    }

    const alreadyStopped = jobManager.get(id)?.status === "stopped";
    jobManager.update(id, {
      resultStatus: status,
      prUrl,
      status: alreadyStopped ? undefined : status === "failed" ? "failed" : "completed",
    });
    jobManager.emitPlatform(id, `Run finished with status: ${status}.`);
  } catch (err) {
    fail(id, (err as Error).message);
  } finally {
    // Keep the sandbox alive so it can be inspected, resumed, or destroyed from
    // the dashboard. Daytona's autoStop/autoDelete intervals are the backstops.
    if (jobManager.get(id)?.sandboxState === "active") {
      jobManager.emitPlatform(id, "Sandbox kept alive — stop, resume, or destroy it from the console.");
    }
    // Flush the remaining event log to the DB and close the batcher.
    await jobManager.endPersistence(id);
  }
}

function fail(id: string, message: string): void {
  jobManager.update(id, { status: "failed", error: message });
  jobManager.emitPlatform(id, message, "error");
}
