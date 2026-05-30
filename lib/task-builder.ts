/**
 * Turn a validated JobRequest into the pi-coder task.json payload plus the
 * secret env map injected into the sandbox. Secrets are referenced in the task
 * by env-var NAME only — they never live inside task.json (pi-coder TRD §12).
 */
import { randomUUID } from "node:crypto";
import type { JobRequest } from "./contracts";

const LLM_KEY_ENV = "LLM_API_KEY";
const GITHUB_TOKEN_ENV = "GITHUB_TOKEN";

/**
 * Derive a branch/PR-friendly identifier from the task instructions when the
 * user didn't supply an issue id. e.g. "Add a dark mode toggle" → "feature-add-a-dark-mode".
 */
export function deriveIssueId(instructions: string): string {
  const slug = instructions
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  return `feature-${slug || "task"}`.slice(0, 48);
}

export interface BuiltTask {
  taskId: string;
  /** The exact object written to /tmp/pi-coder/task.json. */
  task: Record<string, unknown>;
  /** Secret env vars injected into the sandbox (key name → value). */
  env: Record<string, string>;
}

export function buildTask(req: JobRequest): BuiltTask {
  const taskId = randomUUID();
  const issueId = req.issue_id?.trim() || deriveIssueId(req.instructions);

  const task = {
    task_id: taskId,
    repo: req.repo,
    base_ref: req.base_ref,
    issue_id: issueId,
    instructions: req.instructions,
    acceptance_criteria: req.acceptance_criteria,
    constraints: {
      max_steps: 40,
      max_runtime_sec: 1800,
      allow_network: true,
      allow_write: req.allow_write,
    },
    tool_profile: "auto",
    command_overrides: {},
    provider: {
      name: req.provider.name,
      model: req.provider.model,
      api_key_env: LLM_KEY_ENV,
    },
    github: {
      token_env: GITHUB_TOKEN_ENV,
      pr_target_ref: req.base_ref,
    },
  };

  const env: Record<string, string> = {
    [LLM_KEY_ENV]: req.provider_api_key,
    [GITHUB_TOKEN_ENV]: req.github_pat,
  };

  return { taskId, task, env };
}
