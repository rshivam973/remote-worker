import { NextResponse } from "next/server";
import { z } from "zod";
import { jobManager } from "@/lib/job-manager";
import { currentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["stop", "start", "destroy"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!jobManager.getForUser(id, userId)) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid action" }, { status: 400 });

  try {
    const sandbox_state = await jobManager.sandboxAction(id, parsed.data.action);
    const job = jobManager.getForUser(id, userId);
    return NextResponse.json({ ok: true, sandbox_state, sandbox_details: job?.sandboxDetails ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
