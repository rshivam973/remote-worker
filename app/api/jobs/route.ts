import { NextResponse } from "next/server";
import { jobRequestSchema } from "@/lib/contracts";
import { jobManager } from "@/lib/job-manager";
import { startJob } from "@/lib/orchestrate";
import { deriveIssueId } from "@/lib/task-builder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
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

  const job = jobManager.create(data);
  startJob(job, data);
  return NextResponse.json({ job_id: job.id });
}

export async function GET() {
  return NextResponse.json({
    jobs: jobManager.list().map((j) => ({
      id: j.id,
      status: j.status,
      issue_id: j.request.issue_id,
      repo: j.request.repo,
      sandbox_state: j.sandboxState,
      pr_url: j.prUrl,
      created_at: j.createdAt,
    })),
  });
}
