import { NextResponse } from "next/server";
import { controlCommandSchema } from "@/lib/contracts";
import { jobManager } from "@/lib/job-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobManager.get(id);
  if (!job) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const parsed = controlCommandSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid control command" }, { status: 400 });
  }

  try {
    await jobManager.sendControl(id, parsed.data);
    if (parsed.data.type === "stop") jobManager.setStatus(id, "stopped");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 409 });
  }
}
