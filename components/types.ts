export type JobStatus =
  | "provisioning"
  | "bootstrapping"
  | "running"
  | "completed"
  | "failed"
  | "stopped";

export type SandboxState = "pending" | "active" | "stopped" | "destroyed";

export interface SandboxDetails {
  id: string | null;
  name?: string | null;
  state: SandboxState;
  raw_state?: string | null;
  cpu?: number | null;
  memory?: number | null;
  disk?: number | null;
  target?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  last_activity_at?: string | null;
  auto_stop_interval?: number | null;
  auto_delete_interval?: number | null;
  error_reason?: string | null;
  checked_at: string;
  unavailable_reason?: string | null;
}

export interface JobSummary {
  id: string;
  title: string | null;
  status: JobStatus;
  issue_id: string;
  repo: string;
  sandbox_state: SandboxState;
  sandbox_details: SandboxDetails | null;
  pr_url: string | null;
  archived_at: string | null;
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
  live: boolean;
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
