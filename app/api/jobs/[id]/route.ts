import { NextResponse } from "next/server";
import { jobManager } from "@/lib/job-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobManager.get(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });
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
  });
}
