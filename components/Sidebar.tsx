"use client";

import { UserButton } from "@clerk/nextjs";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
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
  archiveView,
  onArchiveViewChange,
  onSelect,
  onNew,
  onRename,
  onArchive,
  onDelete,
}: {
  jobs: JobSummary[];
  selectedId: string | null;
  archiveView: boolean;
  onArchiveViewChange: (archived: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (job: JobSummary) => void;
  onArchive: (job: JobSummary) => void;
  onDelete: (job: JobSummary) => void;
}) {
  return (
    <aside className="flex h-screen w-72 shrink-0 flex-col border-r border-line bg-panel/60">
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-4">
        <span className="grid h-7 w-7 place-items-center bg-amber text-black text-sm font-black">⚙</span>
        <div className="leading-tight">
          <div className="font-mono text-[11px] font-bold uppercase tracking-[0.2em] text-ink">PR Factory</div>
          <div className="text-[9px] uppercase tracking-[0.2em] text-faint">agent control</div>
        </div>
        <div className="ml-auto">
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-7 w-7 rounded-sm",
                userButtonPopoverCard: "rounded-sm border border-line-bright bg-panel",
              },
            }}
          />
        </div>
      </div>

      <button
        onClick={onNew}
        className="m-3 flex items-center justify-center gap-2 border border-amber/40 bg-amber/10 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-amber hover:bg-amber/20 transition-colors"
      >
        + New dispatch
      </button>

      <div className="mx-3 mb-3 grid grid-cols-2 border border-line bg-bg/30 p-0.5">
        <button
          onClick={() => onArchiveViewChange(false)}
          className={`py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors ${
            !archiveView ? "bg-panel-2 text-ink" : "text-faint hover:text-muted"
          }`}
        >
          Active
        </button>
        <button
          onClick={() => onArchiveViewChange(true)}
          className={`py-1.5 text-[10px] font-bold uppercase tracking-[0.16em] transition-colors ${
            archiveView ? "bg-panel-2 text-ink" : "text-faint hover:text-muted"
          }`}
        >
          Archived
        </button>
      </div>

      <div className="px-3 pb-1 text-[9px] font-bold uppercase tracking-[0.2em] text-faint">
        {archiveView ? "Archived" : "Conversations"} · {jobs.length}
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-3">
        {jobs.length === 0 && <p className="px-2 py-6 text-center text-xs text-faint">No dispatches here.</p>}
        {jobs.map((j) => {
          const active = j.id === selectedId;
          return (
            <div
              key={j.id}
              className={`relative mb-1 border-l-2 transition-colors ${
                active
                  ? "border-amber bg-panel-2"
                  : "border-transparent hover:border-line-bright hover:bg-panel-2/50"
              }`}
            >
              <button onClick={() => onSelect(j.id)} className="flex w-full flex-col gap-1 px-3 py-2.5 pr-9 text-left">
                <div className="flex items-center gap-2">
                  <StatusDot status={j.status} />
                  <span className="truncate font-mono text-xs font-bold text-ink">{j.title ?? j.issue_id}</span>
                  {j.pr_url && <span className="ml-auto text-[10px] text-ok">PR</span>}
                </div>
                {j.title && <span className="truncate pl-3.5 font-mono text-[9px] text-faint">{j.issue_id}</span>}
                <span className="truncate pl-3.5 font-mono text-[10px] text-muted">{repoShort(j.repo)}</span>
                <span className="pl-3.5 text-[9px] uppercase tracking-wider text-faint">
                  {STATUS_META[j.status].label}
                  {j.sandbox_state === "destroyed" ? " · sandbox gone" : j.sandbox_state === "stopped" ? " · sandbox idle" : ""}
                </span>
              </button>
              <ConversationMenu
                job={j}
                archiveView={archiveView}
                onRename={() => onRename(j)}
                onArchive={() => onArchive(j)}
                onDelete={() => onDelete(j)}
              />
            </div>
          );
        })}
      </nav>

      <div className="border-t border-line px-4 py-2.5 font-mono text-[9px] uppercase tracking-wider text-faint">
        sandboxes auto-stop when idle
      </div>
    </aside>
  );
}

function ConversationMenu({
  job,
  archiveView,
  onRename,
  onArchive,
  onDelete,
}: {
  job: JobSummary;
  archiveView: boolean;
  onRename: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-1.5 top-1.5 h-7 w-7 border border-transparent p-0 text-faint hover:border-line hover:bg-bg/60 hover:text-ink"
          aria-label={`Open actions for ${job.title ?? job.issue_id}`}
          title="Conversation actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={onRename}>Rename</DropdownMenuItem>
        <DropdownMenuItem onSelect={onArchive}>{archiveView ? "Restore" : "Archive"}</DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem danger onSelect={onDelete}>Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
