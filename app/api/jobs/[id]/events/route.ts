import { jobManager } from "@/lib/job-manager";
import { getConversation, getEvents } from "@/lib/store";
import type { PiEvent } from "@/lib/contracts";
import { currentUserId } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

/** Server-Sent Events stream of a job's pi-coder + platform events. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await currentUserId();
  if (!userId) return new Response("unauthorized", { status: 401 });

  const job = jobManager.get(id);
  if (job && job.ownerId !== userId) return new Response("not found", { status: 404 });

  // Historical job (not live in this process): replay the durable log, then close.
  if (!job) {
    const row = await getConversation(id, userId);
    if (!row) return new Response("not found", { status: 404 });
    const history = await getEvents(id);
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of history) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        controller.close();
      },
    });
    return new Response(stream, { headers: SSE_HEADERS });
  }

  // Live job: replay the in-memory buffer (raw deltas) and stream new events.
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

  return new Response(stream, { headers: SSE_HEADERS });
}
