/**
 * Supabase persistence (platform TRD addendum). DB = durable source of truth for
 * conversations + their event log; the in-memory JobManager is the live cache.
 *
 * Persistence is best-effort and OPTIONAL: if SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY
 * are unset, the platform runs in memory-only mode (warns once). All DB calls are
 * fire-and-forget from the live path so they never block streaming.
 *
 * Event-log strategy (see also the design notes):
 *  - `llm_text` deltas are COALESCED into larger chunks before writing (the UI
 *    re-merges consecutive llm_text on replay), collapsing the delta firehose.
 *  - Writes are BATCHED per conversation (flush every 750ms or 25 events), with an
 *    immediate flush on important events (pr_created / done / error / user_msg).
 *  - Each event carries a per-conversation `seq` for stable replay ordering.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PiEvent, JobStatus, SandboxDetails, SandboxState } from "./contracts";

export interface ConversationRow {
  id: string;
  owner_id: string;
  status: JobStatus;
  issue_id: string | null;
  repo: string;
  base_ref: string | null;
  instructions: string | null;
  provider: { name: string; model: string } | null;
  sandbox_id: string | null;
  sandbox_state: SandboxState;
  sandbox_details: SandboxDetails | null;
  pr_url: string | null;
  result_status: string | null;
  error: string | null;
  created_at: string;
}

export type ConversationPatch = Partial<
  Pick<
    ConversationRow,
    "status" | "sandbox_id" | "sandbox_state" | "sandbox_details" | "pr_url" | "result_status" | "error"
  >
>;

let client: SupabaseClient | null | undefined;

function getClient(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    client = createClient(url, key, { auth: { persistSession: false } });
  } else {
    client = null;
    console.warn("[store] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set — persistence disabled (memory-only).");
  }
  return client;
}

export function storeEnabled(): boolean {
  return getClient() !== null;
}

// --- conversations --------------------------------------------------------

export function insertConversation(row: ConversationRow): void {
  const db = getClient();
  if (!db) return;
  void db
    .from("conversations")
    .insert({ ...row, updated_at: row.created_at })
    .then(({ error }) => error && console.error("[store] insertConversation:", error.message));
}

export function updateConversation(id: string, patch: ConversationPatch): void {
  const db = getClient();
  if (!db) return;
  void db
    .from("conversations")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id)
    .then(({ error }) => error && console.error("[store] updateConversation:", error.message));
}

export async function listConversations(ownerId: string): Promise<ConversationRow[]> {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from("conversations")
    .select("*")
    .eq("owner_id", ownerId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.error("[store] listConversations:", error.message);
    return [];
  }
  return (data ?? []) as ConversationRow[];
}

export async function getConversation(id: string, ownerId: string): Promise<ConversationRow | null> {
  const db = getClient();
  if (!db) return null;
  const { data, error } = await db
    .from("conversations")
    .select("*")
    .eq("id", id)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (error) {
    console.error("[store] getConversation:", error.message);
    return null;
  }
  return (data as ConversationRow) ?? null;
}

export async function getEvents(id: string): Promise<PiEvent[]> {
  const db = getClient();
  if (!db) return [];
  const { data, error } = await db
    .from("events")
    .select("payload")
    .eq("conversation_id", id)
    .order("seq", { ascending: true });
  if (error) {
    console.error("[store] getEvents:", error.message);
    return [];
  }
  return (data ?? []).map((r) => (r as { payload: PiEvent }).payload);
}

// --- event batching + coalescing -----------------------------------------

const IMMEDIATE_FLUSH = new Set(["pr_created", "done", "error", "user_msg"]);
const FLUSH_INTERVAL_MS = 750;
const FLUSH_SIZE = 25;

interface PendingRow {
  seq: number;
  type: string;
  payload: PiEvent;
}

class EventBatcher {
  private buffer: PendingRow[] = [];
  private seq = 0;
  private textBuf = "";
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly conversationId: string) {}

  add(event: PiEvent): void {
    if (event.type === "llm_text") {
      this.textBuf += String(event.text ?? "");
      this.schedule();
      return;
    }
    this.flushText(); // keep ordering: any buffered text precedes the next event
    this.buffer.push({ seq: this.seq++, type: event.type, payload: event });
    if (IMMEDIATE_FLUSH.has(event.type) || this.buffer.length >= FLUSH_SIZE) {
      void this.flushNow();
    } else {
      this.schedule();
    }
  }

  /** Emit accumulated llm_text as a single (coalesced) event row. */
  private flushText(): void {
    if (!this.textBuf) return;
    this.buffer.push({ seq: this.seq++, type: "llm_text", payload: { type: "llm_text", text: this.textBuf } });
    this.textBuf = "";
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flushNow(), FLUSH_INTERVAL_MS);
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flushText();
    if (this.buffer.length === 0) return;
    const rows = this.buffer.splice(0);
    const db = getClient();
    if (!db) return;
    const { error } = await db.from("events").insert(
      rows.map((r) => ({ conversation_id: this.conversationId, seq: r.seq, type: r.type, payload: r.payload })),
    );
    if (error) console.error("[store] insert events:", error.message);
  }
}

const batchers = new Map<string, EventBatcher>();

export function recordEvent(conversationId: string, event: PiEvent): void {
  if (!storeEnabled()) return;
  let b = batchers.get(conversationId);
  if (!b) {
    b = new EventBatcher(conversationId);
    batchers.set(conversationId, b);
  }
  b.add(event);
}

/** Flush remaining buffered events and drop the batcher (call when a job ends). */
export async function finalizeConversation(conversationId: string): Promise<void> {
  const b = batchers.get(conversationId);
  if (!b) return;
  await b.flushNow();
  batchers.delete(conversationId);
}
