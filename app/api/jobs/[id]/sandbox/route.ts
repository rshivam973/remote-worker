import { NextResponse } from "next/server";
import { z } from "zod";
import { jobManager } from "@/lib/job-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({ action: z.enum(["stop", "start", "destroy"]) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!jobManager.get(id)) return NextResponse.json({ error: "not found" }, { status: 404 });

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
    return NextResponse.json({ ok: true, sandbox_state });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
