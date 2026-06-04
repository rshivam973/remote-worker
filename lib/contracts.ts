/**
 * Platform contracts. The JobRequest is what the submit form sends; the server
 * turns it into a pi-coder task.json + a secret env map (see task-builder.ts).
 * PiEvent mirrors pi-coder's stdout event envelope (kept permissive — the UI
 * narrows by `type`).
 */
import { z } from "zod";

export const providerNameSchema = z.enum(["openrouter", "anthropic", "openai"]);

export const jobRequestSchema = z.object({
  repo: z.string().url(),
  base_ref: z.string().min(1).default("main"),
  // Optional — when omitted, the server derives a label from the task so the
  // branch/PR still get a sensible name. Users can just ask for a feature.
  issue_id: z.string().optional(),
  instructions: z.string().min(1),
  acceptance_criteria: z.string().optional(),
  allow_write: z.array(z.string()).default(["."]),
  provider: z.object({
    name: providerNameSchema,
    model: z.string().min(1),
  }),
  // Secrets — used to create the sandbox env, then dropped from server memory.
  provider_api_key: z.string().min(1),
  github_pat: z.string().min(1),
});

export type JobRequest = z.infer<typeof jobRequestSchema>;

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

/** One NDJSON event as emitted by pi-coder on stdout (loose by design). */
export interface PiEvent {
  type: string;
  ts?: string;
  step?: number;
  [key: string]: unknown;
}

export type ControlCommand =
  | { type: "chat"; text: string }
  | { type: "status" }
  | { type: "interrupt" }
  | { type: "resume" }
  | { type: "stop" };

export const controlCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("chat"), text: z.string().min(1) }),
  z.object({ type: z.literal("status") }),
  z.object({ type: z.literal("interrupt") }),
  z.object({ type: z.literal("resume") }),
  z.object({ type: z.literal("stop") }),
]);
