import { NextResponse } from "next/server";
import { jobRequestSchema } from "@/lib/contracts";
import { jobManager } from "@/lib/job-manager";
import { startJob } from "@/lib/orchestrate";
import { deriveIssueId } from "@/lib/task-builder";
import { storeEnabled, listConversations } from "@/lib/store";
import { currentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = jobRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid request", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
      { status: 400 },
    );
  }

  // Derive a label when the user didn't provide an issue id, so the branch/PR
  // and the dashboard all show a consistent, readable identifier.
  const data = { ...parsed.data, issue_id: parsed.data.issue_id?.trim() || deriveIssueId(parsed.data.instructions) };

  const job = jobManager.create(data, userId);
  startJob(job, data);
  return NextResponse.json({ job_id: job.id });
}

export async function GET(req: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const archived = new URL(req.url).searchParams.get("archived") === "true";

  // DB is the durable source of truth (survives restarts); fall back to memory.
  if (storeEnabled()) {
    const rows = await listConversations(userId, archived);
    return NextResponse.json({
      jobs: rows.map((r) => ({
        id: r.id,
        title: r.title,
        status: r.status,
        issue_id: r.issue_id,
        repo: r.repo,
        sandbox_state: r.sandbox_state,
        sandbox_details: r.sandbox_details,
        pr_url: r.pr_url,
        archived_at: r.archived_at,
        created_at: r.created_at,
      })),
    });
  }
  return NextResponse.json({
    jobs: jobManager.list(userId, archived).map((j) => ({
      id: j.id,
      title: j.title,
      status: j.status,
      issue_id: j.request.issue_id,
      repo: j.request.repo,
      sandbox_state: j.sandboxState,
      sandbox_details: j.sandboxDetails,
      pr_url: j.prUrl,
      archived_at: j.archivedAt,
      created_at: j.createdAt,
    })),
  });
}
