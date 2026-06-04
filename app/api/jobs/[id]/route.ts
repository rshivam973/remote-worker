import { NextResponse } from "next/server";
import { conversationUpdateSchema } from "@/lib/contracts";
import { jobManager } from "@/lib/job-manager";
import { deleteConversation, getConversation, storeEnabled, updateConversation } from "@/lib/store";
import { currentUserId } from "@/lib/auth";
import { destroySandboxById, refreshSandboxDetails } from "@/lib/sandbox-status";

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
      title: job.title,
      status: job.status,
      request: job.request,
      sandbox_id: job.sandboxId,
      sandbox_state: job.sandboxState,
      sandbox_details: refreshed ?? job.sandboxDetails,
      pr_url: job.prUrl,
      result_status: job.resultStatus,
      error: job.error,
      archived_at: job.archivedAt,
      created_at: job.createdAt,
      live: true,
    });
  }

  let row = await getConversation(id, userId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (row.sandbox_id && row.sandbox_state !== "destroyed") {
    const refreshed = await refreshSandboxDetails(row.sandbox_id);
    if (refreshed) {
      await updateConversation(row.id, { sandbox_state: refreshed.state, sandbox_details: refreshed });
      row = { ...row, sandbox_state: refreshed.state, sandbox_details: refreshed };
    }
  }
  return NextResponse.json({
    id: row.id,
    title: row.title,
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
    archived_at: row.archived_at,
    created_at: row.created_at,
    live: false,
  });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = conversationUpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid conversation update" }, { status: 400 });
  const patch: { title?: string; archived_at?: string | null } = {};
  if (parsed.data.title !== undefined) patch.title = parsed.data.title;
  if (parsed.data.archived !== undefined) patch.archived_at = parsed.data.archived ? new Date().toISOString() : null;

  const job = jobManager.getForUser(id, userId);
  if (job) {
    const result = await updateConversation(id, patch);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    if (patch.title !== undefined) job.title = patch.title;
    if (patch.archived_at !== undefined) job.archivedAt = patch.archived_at;
    return NextResponse.json({ ok: true });
  }

  const row = await getConversation(id, userId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await updateConversation(id, patch);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const liveJob = jobManager.getForUser(id, userId);
  if (liveJob) {
    const prepared = await jobManager.prepareDeleteForUser(id, userId);
    if (!prepared) return NextResponse.json({ error: "not found" }, { status: 404 });
    if (storeEnabled()) {
      const result = await deleteConversation(id, userId);
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    }
    jobManager.removeForUser(id, userId);
    return NextResponse.json({ ok: true });
  }

  const row = await getConversation(id, userId);
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  const result = await deleteConversation(id, userId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  if (row.sandbox_id && row.sandbox_state !== "destroyed") {
    void destroySandboxById(row.sandbox_id).catch((err) => {
      console.error("[api/jobs] sandbox cleanup after delete failed:", (err as Error).message);
    });
  }
  return NextResponse.json({ ok: true });
}
