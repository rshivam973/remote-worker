import { NextResponse } from "next/server";
import { jobManager } from "@/lib/job-manager";
import { getConversation, updateConversation } from "@/lib/store";
import { currentUserId } from "@/lib/auth";
import { refreshSandboxDetails } from "@/lib/sandbox-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Prefer the live in-memory job (freshest); fall back to the durable DB row.
  const job = jobManager.getForUser(id, userId);
  if (job) {
    const refreshed = await jobManager.refreshSandboxDetails(id);
    return NextResponse.json({
      id: job.id,
      status: job.status,
      request: job.request,
      sandbox_id: job.sandboxId,
      sandbox_state: job.sandboxState,
      sandbox_details: refreshed ?? job.sandboxDetails,
      pr_url: job.prUrl,
      result_status: job.resultStatus,
      error: job.error,
      created_at: job.createdAt,
      live: true,
    });
  }

  let row = await getConversation(id, userId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.sandbox_id && row.sandbox_state !== "destroyed") {
    const refreshed = await refreshSandboxDetails(row.sandbox_id);
    if (refreshed) {
      updateConversation(row.id, { sandbox_state: refreshed.state, sandbox_details: refreshed });
      row = { ...row, sandbox_state: refreshed.state, sandbox_details: refreshed };
    }
  }
  return NextResponse.json({
    id: row.id,
    status: row.status,
    request: {
      repo: row.repo,
      base_ref: row.base_ref,
      issue_id: row.issue_id,
      instructions: row.instructions,
      provider: row.provider,
    },
    sandbox_id: row.sandbox_id,
    sandbox_state: row.sandbox_state,
    sandbox_details: row.sandbox_details,
    pr_url: row.pr_url,
    result_status: row.result_status,
    error: row.error,
    created_at: row.created_at,
    live: false,
  });
}
