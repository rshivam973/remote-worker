import { NextResponse } from "next/server";
import { jobManager } from "@/lib/job-manager";
import { getConversation } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Prefer the live in-memory job (freshest); fall back to the durable DB row.
  const job = jobManager.get(id);
  if (job) {
    return NextResponse.json({
      id: job.id,
      status: job.status,
      request: job.request,
      sandbox_id: job.sandboxId,
      sandbox_state: job.sandboxState,
      pr_url: job.prUrl,
      result_status: job.resultStatus,
      error: job.error,
      created_at: job.createdAt,
      live: true,
    });
  }

  const row = await getConversation(id);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
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
    pr_url: row.pr_url,
    result_status: row.result_status,
    error: row.error,
    created_at: row.created_at,
    live: false,
  });
}
