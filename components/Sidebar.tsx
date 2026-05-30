"use client";

import { ACTIVE_STATUSES, STATUS_META, type JobSummary } from "./types";

function repoShort(url: string): string {
  return url.replace(/^https?:\/\/(www\.)?github\.com\//, "").replace(/\.git$/, "");
}

function StatusDot({ status }: { status: JobSummary["status"] }) {
  const meta = STATUS_META[status];
  const live = ACTIVE_STATUSES.has(status);
  return (
    <span
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${live ? "dot-live" : ""}`}
      style={{ background: meta.color, boxShadow: `0 0 6px ${meta.color}` }}
      title={meta.label}
    />
  );
}

export function Sidebar({
  jobs,
  selectedId,
  onSelect,
  onNew,
}: {
  jobs: JobSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-line bg-panel/60">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
        <span className="grid h-7 w-7 place-items-center bg-amber text-black text-sm font-black">⚙</span>
        <div className="leading-tight">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink">PR Factory</div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-faint">agent control</div>
        </div>
      </div>

      <button
        onClick={onNew}
        className="m-3 flex items-center justify-center gap-2 border border-amber/40 bg-amber/10 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-amber hover:bg-amber/20 transition-colors"
      >
        + New dispatch
      </button>

      <div className="px-3 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-faint">
        Conversations · {jobs.length}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {jobs.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-faint">No dispatches yet.</p>
        )}
        {jobs.map((j) => {
          const active = j.id === selectedId;
          return (
            <button
              key={j.id}
              onClick={() => onSelect(j.id)}
              className={`mb-1 flex w-full flex-col gap-1 border-l-2 px-3 py-2.5 text-left transition-colors ${
                active
                  ? "border-amber bg-panel-2"
                  : "border-transparent hover:border-line-bright hover:bg-panel-2/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <StatusDot status={j.status} />
                <span className="truncate font-mono text-xs font-bold text-ink">{j.issue_id}</span>
                {j.pr_url && <span className="ml-auto text-[10px] text-ok">PR</span>}
              </div>
              <span className="truncate pl-3.5 font-mono text-[10px] text-muted">{repoShort(j.repo)}</span>
              <span className="pl-3.5 text-[9px] uppercase tracking-wider text-faint">
                {STATUS_META[j.status].label}
                {j.sandbox_state === "destroyed" ? " · sandbox gone" : j.sandbox_state === "stopped" ? " · sandbox idle" : ""}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-2.5 font-mono text-[9px] uppercase tracking-wider text-faint">
        sandboxes auto-stop when idle
      </div>
    </aside>
  );
}
