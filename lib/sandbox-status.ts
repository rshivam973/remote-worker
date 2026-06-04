import { Daytona, DaytonaNotFoundError, type Sandbox } from "@daytonaio/sdk";
import type { SandboxDetails, SandboxState } from "./contracts";

function mapDaytonaState(raw: string | null | undefined): SandboxState {
  switch (raw) {
    case "started":
      return "active";
    case "stopped":
    case "archived":
    case "stopping":
    case "archiving":
      return "stopped";
    case "destroyed":
    case "destroying":
    case "error":
    case "build_failed":
    case "unknown":
      return "destroyed";
    default:
      return "pending";
  }
}

export function snapshotSandbox(sandbox: Sandbox): SandboxDetails {
  const rawState = typeof sandbox.state === "string" ? sandbox.state : null;
  return {
    id: sandbox.id,
    name: sandbox.name ?? null,
    state: mapDaytonaState(rawState),
    raw_state: rawState,
    cpu: typeof sandbox.cpu === "number" ? sandbox.cpu : null,
    memory: typeof sandbox.memory === "number" ? sandbox.memory : null,
    disk: typeof sandbox.disk === "number" ? sandbox.disk : null,
    target: sandbox.target ?? null,
    created_at: sandbox.createdAt ?? null,
    updated_at: sandbox.updatedAt ?? null,
    last_activity_at: sandbox.lastActivityAt ?? null,
    auto_stop_interval: sandbox.autoStopInterval ?? null,
    auto_delete_interval: sandbox.autoDeleteInterval ?? null,
    error_reason: sandbox.errorReason ?? null,
    checked_at: new Date().toISOString(),
  };
}

export function destroyedSandboxSnapshot(id: string | null, reason?: string): SandboxDetails {
  return {
    id,
    state: "destroyed",
    raw_state: "destroyed",
    checked_at: new Date().toISOString(),
    unavailable_reason: reason ?? "Sandbox no longer exists.",
  };
}

export async function refreshSandboxDetails(sandboxId: string | null): Promise<SandboxDetails | null> {
  if (!sandboxId) return null;
  try {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) return null;
    const daytona = new Daytona({ apiKey });
    const sandbox = await daytona.get(sandboxId);
    await sandbox.refreshData();
    return snapshotSandbox(sandbox);
  } catch (err) {
    if (err instanceof DaytonaNotFoundError || (err as { statusCode?: number }).statusCode === 404) {
      return destroyedSandboxSnapshot(sandboxId, "Daytona reports this sandbox was destroyed or deleted.");
    }
    return null;
  }
}

export async function destroySandboxById(sandboxId: string | null): Promise<SandboxDetails | null> {
  if (!sandboxId) return null;
  try {
    const apiKey = process.env.DAYTONA_API_KEY;
    if (!apiKey) return null;
    const daytona = new Daytona({ apiKey });
    const sandbox = await daytona.get(sandboxId);
    await sandbox.delete(60);
    return destroyedSandboxSnapshot(sandboxId, "Sandbox was destroyed while deleting the conversation.");
  } catch (err) {
    if (err instanceof DaytonaNotFoundError || (err as { statusCode?: number }).statusCode === 404) {
      return destroyedSandboxSnapshot(sandboxId, "Sandbox was already destroyed or deleted.");
    }
    return null;
  }
}
