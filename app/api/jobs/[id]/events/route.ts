import { jobManager } from "@/lib/job-manager";
import type { PiEvent } from "@/lib/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Server-Sent Events stream of a job's pi-coder + platform events. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = jobManager.get(id);
  if (!job) return new Response("not found", { status: 404 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const safeEnqueue = (s: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(s));
        } catch {
          closed = true;
        }
      };
      const send = (e: PiEvent) => safeEnqueue(`data: ${JSON.stringify(e)}\n\n`);

      const { replay, unsubscribe } = jobManager.subscribe(id, send);
      for (const e of replay) send(e);

      const heartbeat = setInterval(() => safeEnqueue(`: ping\n\n`), 15000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      req.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
