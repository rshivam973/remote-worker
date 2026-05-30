export type JobStatus =
  | "provisioning"
  | "bootstrapping"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type SandboxState = "pending" | "active" | "stopped" | "destroyed";

export interface JobSummary {
  id: string;
  status: JobStatus;
  issue_id: string;
  repo: string;
  sandbox_state: SandboxState;
  pr_url: string | null;
  created_at: string;
}

export interface JobDetail extends JobSummary {
  request: {
    repo: string;
    base_ref: string;
    issue_id: string;
    instructions: string;
    provider: { name: string; model: string };
  };
  sandbox_id: string | null;
  result_status: string | null;
  error: string | null;
}

export interface PiEvent {
  type: string;
  [key: string]: unknown;
}

export const STATUS_META: Record<JobStatus, { label: string; color: string }> = {
  provisioning: { label: "Provisioning", color: "var(--sky)" },
  bootstrapping: { label: "Bootstrapping", color: "var(--sky)" },
  running: { label: "Running", color: "var(--amber)" },
  completed: { label: "Completed", color: "var(--ok)" },
  failed: { label: "Failed", color: "var(--err)" },
  stopped: { label: "Stopped", color: "var(--warn)" },
};

export const ACTIVE_STATUSES: ReadonlySet<JobStatus> = new Set([
  "provisioning",
  "bootstrapping",
  "running",
]);
