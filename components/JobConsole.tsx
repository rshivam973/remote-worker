"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ACTIVE_STATUSES, STATUS_META, type JobDetail, type PiEvent, type SandboxState } from "./types";

const TONES: Record<string, string> = {
  dim: "text-faint",
  text: "text-ink",
  tool: "text-sky",
  accent: "text-amber",
  phase: "text-amber font-bold mt-3 tracking-[0.15em]",
  ok: "text-ok",
  warn: "text-warn",
  err: "text-err",
  usermsg: "text-amber font-medium",
};

export function JobConsole({
  jobId,
  onChange,
  onNew,
}: {
  jobId: string;
  onChange: () => void;
  onNew: () => void;
}) {
  const [events, setEvents] = useState<PiEvent[]>([]);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [connected, setConnected] = useState(false);
  const [chat, setChat] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  const refreshDetail = useCallback(async () => {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (res.ok) setDetail(await res.json());
  }, [jobId]);

  // Subscribe to the event stream; reset on job switch.
  useEffect(() => {
    setEvents([]);
    setDetail(null);
    void refreshDetail();
    const es = new EventSource(`/api/jobs/${jobId}/events`);
    es.onopen = () => setConnected(true);
    es.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as PiEvent;
        setEvents((prev) => [...prev, e]);
        if (e.type === "done") {
          es.close();
          setConnected(false);
          void refreshDetail();
          onChange();
        }
      } catch {
        /* ignore */
      }
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, [jobId, refreshDetail, onChange]);

  // Poll status for active jobs (covers status transitions before `done`).
  useEffect(() => {
    if (!detail || !ACTIVE_STATUSES.has(detail.status)) return;
    const t = setInterval(refreshDetail, 4000);
    return () => clearInterval(t);
  }, [detail, refreshDetail]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [events]);

  // Append a client-only note to the log (e.g. delivery failures).
  const note = (message: string, level: "info" | "error" = "info") =>
    setEvents((prev) => [...prev, { type: "platform", level, message }]);

  const SLASH = new Set(["status", "interrupt", "resume", "stop"]);

  async function send() {
    const raw = chat.trim();
    if (!raw) return;
    if (detail && (detail.sandbox_state === "destroyed" || !detail.live)) {
      note("This conversation is historical. Create a new dispatch to continue work.", "error");
      return;
    }
    setChat("");

    const slash = raw.startsWith("/") ? raw.slice(1).split(/\s+/)[0]?.toLowerCase() : null;
    if (slash === "help") {
      note("commands: /status · /interrupt · /resume · /stop · or just type to steer the agent");
      return;
    }
    const body = slash && SLASH.has(slash) ? { type: slash } : { type: "chat", text: raw };

    try {
      const res = await fetch(`/api/jobs/${jobId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        note(d.error || "couldn't reach the agent (it isn't running)", "error");
      } else if (body.type === "stop") {
        void refreshDetail();
        onChange();
      }
    } catch {
      note("network error sending message", "error");
    }
  }

  async function sandbox(action: "stop" | "start" | "destroy") {
    if (action === "destroy" && !confirm("Destroy this sandbox permanently?")) return;
    setBusy(action);
    try {
      const res = await fetch(`/api/jobs/${jobId}/sandbox`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        const data = await res.json();
        setDetail((d) =>
          d
            ? {
                ...d,
                sandbox_state: data.sandbox_state as SandboxState,
                sandbox_details: data.sandbox_details ?? d.sandbox_details,
              }
            : d,
        );
        onChange();
      }
    } finally {
      setBusy(null);
    }
  }

  const prUrl = detail?.pr_url ?? findPr(events);
  const status = detail?.status ?? "provisioning";
  const sbState = detail?.sandbox_state ?? "pending";
  const isRunning = ACTIVE_STATUSES.has(status);
  const sandboxGone = sbState === "destroyed";
  const readOnlyHistory = !!detail && !detail.live;
  const hasSandbox = !!detail?.live && !!detail?.sandbox_id && !sandboxGone;
  const chatDisabled = sandboxGone || readOnlyHistory;

  return (
    <div className="flex h-screen flex-1 flex-col">
      {/* Header */}
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel/40 px-5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="font-mono text-sm font-bold text-ink">{detail?.title ?? detail?.issue_id ?? "…"}</h1>
            <StatusPill status={status} live={isRunning} />
          </div>
          <div className="truncate font-mono text-[11px] text-muted">
            {detail?.title ? `${detail.issue_id} · ` : ""}
            {detail?.repo}
          </div>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <SandboxChip state={sbState} sandboxId={detail?.sandbox_id ?? null} />
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="bg-ok/15 border border-ok/40 px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-ok hover:bg-ok/25"
            >
              View PR ↗
            </a>
          )}
        </div>
      </header>

      {/* Sandbox controls */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-2">
        <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-faint">Sandbox</span>
        <SbButton label="Resume" disabled={!hasSandbox || sbState === "active" || !!busy} busy={busy === "start"} onClick={() => sandbox("start")} />
        <SbButton label="Stop" disabled={!hasSandbox || sbState === "stopped" || !!busy} busy={busy === "stop"} onClick={() => sandbox("stop")} />
        <SbButton label="Destroy" danger disabled={!hasSandbox || !!busy} busy={busy === "destroy"} onClick={() => sandbox("destroy")} />
        <span className="ml-auto font-mono text-[10px] text-faint">
          <span className={connected ? "text-ok" : "text-faint"}>●</span> {connected ? "stream live" : "stream idle"}
        </span>
      </div>

      {(sandboxGone || readOnlyHistory) && detail && (
        <SandboxNotice detail={detail} onNew={onNew} />
      )}

      {/* Event log */}
      <div ref={logRef} className="flex-1 overflow-y-auto px-5 py-4 font-mono text-[12.5px] leading-relaxed">
        {events.length === 0 && <p className="text-faint">Awaiting telemetry…</p>}
        {coalesce(events).map((e, i) => (
          <EventLine key={i} e={e} />
        ))}
      </div>

      {/* Chat — the single, always-on interface to the agent */}
      <div className="border-t border-line bg-panel/40 px-5 py-3">
        <div className="flex items-center gap-2">
          <input
            value={chat}
            onChange={(e) => setChat(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            disabled={chatDisabled}
            placeholder={
              chatDisabled
                ? "This conversation is read-only. Start a new dispatch to continue."
                : "Message the agent — type to steer, or /status /interrupt /resume /stop"
            }
            className="min-w-[200px] flex-1 rounded-sm border border-line bg-bg/60 px-3 py-2 text-sm placeholder:text-faint focus:border-amber focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <button
            onClick={send}
            disabled={chatDisabled}
            className="bg-amber px-4 py-2 text-xs font-bold uppercase tracking-wider text-black hover:bg-amber-deep disabled:cursor-not-allowed disabled:opacity-40 transition-colors"
          >
            Send
          </button>
        </div>
        <p className="mt-1.5 font-mono text-[10px] text-faint">
          <span className="text-muted">/status</span> · <span className="text-muted">/interrupt</span> ·{" "}
          <span className="text-muted">/resume</span> · <span className="text-muted">/stop</span> · or just type to steer
        </p>
      </div>
    </div>
  );
}

// --- small presentational pieces ------------------------------------------

function SandboxNotice({ detail, onNew }: { detail: JobDetail; onNew: () => void }) {
  const checkedAt = detail.sandbox_details?.checked_at
    ? new Date(detail.sandbox_details.checked_at).toLocaleString()
    : null;
  const destroyed = detail.sandbox_state === "destroyed";
  return (
    <div className="border-b border-err/30 bg-err/10 px-5 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-err">
            {destroyed ? "Sandbox destroyed" : "Read-only history"}
          </div>
          <p className="mt-1 text-sm text-ink">
            {destroyed
              ? "The sandbox for this conversation no longer exists. The timeline is preserved, but the agent cannot continue from here."
              : "This conversation was loaded from persisted history, so this server no longer has the live agent runner attached."}
          </p>
          <p className="mt-1 font-mono text-[10px] text-faint">
            {detail.sandbox_id ? `sandbox=${detail.sandbox_id}` : "sandbox=none"}
            {detail.sandbox_details?.raw_state ? ` · daytona=${detail.sandbox_details.raw_state}` : ""}
            {checkedAt ? ` · checked=${checkedAt}` : ""}
          </p>
        </div>
        <button
          onClick={onNew}
          className="border border-amber/40 bg-amber/10 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.14em] text-amber hover:bg-amber/20"
        >
          New dispatch
        </button>
      </div>
    </div>
  );
}

function StatusPill({ status, live }: { status: JobDetail["status"]; live: boolean }) {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider" style={{ borderColor: `${meta.color}55`, color: meta.color }}>
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "dot-live" : ""}`} style={{ background: meta.color }} />
      {meta.label}
    </span>
  );
}

function SandboxChip({ state, sandboxId }: { state: SandboxState; sandboxId: string | null }) {
  const map: Record<SandboxState, { c: string; t: string }> = {
    pending: { c: "var(--faint)", t: "no sandbox" },
    active: { c: "var(--ok)", t: "active" },
    stopped: { c: "var(--warn)", t: "stopped" },
    destroyed: { c: "var(--err)", t: "destroyed" },
  };
  const m = map[state];
  return (
    <span className="inline-flex items-center gap-1.5 border border-line px-2 py-1 font-mono text-[10px] text-muted" title={sandboxId ?? undefined}>
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: m.c }} />
      sandbox: {m.t}
    </span>
  );
}

function SbButton({ label, onClick, disabled, busy, danger }: { label: string; onClick: () => void; disabled?: boolean; busy?: boolean; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`border px-2.5 py-1 text-[11px] uppercase tracking-wider transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
        danger ? "border-err/40 text-err hover:bg-err/10" : "border-line text-muted hover:border-line-bright hover:text-ink"
      }`}
    >
      {busy ? "…" : label}
    </button>
  );
}

function coalesce(events: PiEvent[]): PiEvent[] {
  const out: PiEvent[] = [];
  for (const e of events) {
    const last = out[out.length - 1];
    if (e.type === "llm_text" && last?.type === "llm_text") {
      last.text = String(last.text ?? "") + String(e.text ?? "");
    } else {
      out.push({ ...e });
    }
  }
  return out;
}

function findPr(events: PiEvent[]): string | null {
  const e = [...events].reverse().find((x) => x.type === "pr_created" && typeof x.url === "string");
  return e ? String(e.url) : null;
}

function EventLine({ e }: { e: PiEvent }) {
  const node = render(e);
  return <div className={`line-in whitespace-pre-wrap break-words ${TONES[node.tone] ?? "text-ink"}`}>{node.content}</div>;
}

function render(e: PiEvent): { tone: string; content: React.ReactNode } {
  switch (e.type) {
    case "user_msg":
      return { tone: "usermsg", content: `› ${String(e.text)}` };
    case "platform":
      return { tone: e.level === "error" ? "err" : "dim", content: `» ${String(e.message)}` };
    case "phase":
      return { tone: "phase", content: `── ${String(e.phase).toUpperCase()} ──` };
    case "skill_loaded":
      return { tone: "accent", content: `📖 skill loaded: ${String(e.name)}` };
    case "llm_text":
      return { tone: "text", content: String(e.text) };
    case "tool_call":
      return { tone: "tool", content: `→ ${String(e.tool)}(${preview(e.args)})` };
    case "tool_result":
      return { tone: e.ok ? "dim" : "err", content: `← ${String(e.tool)}: ${String(e.summary)}` };
    case "test_run":
      return { tone: e.exit_code === 0 ? "ok" : "err", content: `🧪 ${String(e.command)} → exit ${String(e.exit_code)}` };
    case "review":
      return {
        tone: e.passed ? "ok" : "warn",
        content: `🔎 review #${String(e.iteration)}: ${e.passed ? "passed" : "needs work"}${Array.isArray(e.findings) && e.findings.length ? ` — ${(e.findings as string[]).join("; ")}` : ""}`,
      };
    case "git":
      return { tone: "accent", content: `⎇ git ${String(e.action)}: ${String(e.detail)}` };
    case "pr_created":
      return { tone: "ok", content: `✅ PR #${String(e.number)} opened` };
    case "status_report":
      return { tone: "dim", content: `ⓘ phase=${String(e.phase)} skill=${String(e.current_skill)} files=${Array.isArray(e.changed_files) ? e.changed_files.length : 0} ${String(e.elapsed_sec)}s` };
    case "interrupted":
      return { tone: "warn", content: "⏸ interrupted" };
    case "resumed":
      return { tone: "accent", content: "▶ resumed" };
    case "stopping":
      return { tone: "warn", content: "⏹ stopping…" };
    case "done":
      return { tone: "ok", content: `■ run finished: ${String(e.status)}` };
    case "error":
      return { tone: "err", content: `✗ ${String(e.error_type)}: ${String(e.message)}` };
    default:
      return { tone: "dim", content: e.type };
  }
}

function preview(args: unknown): string {
  try {
    const s = JSON.stringify(args);
    return s.length > 80 ? s.slice(0, 80) + "…" : s;
  } catch {
    return "";
  }
}
