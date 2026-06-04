"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { JobConsole } from "./JobConsole";
import { NewJobModal } from "./NewJobModal";
import type { JobSummary } from "./types";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function Dashboard({ initialJobId }: { initialJobId?: string }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialJobId ?? null);
  const [modalOpen, setModalOpen] = useState(false);
  const [archiveView, setArchiveView] = useState(false);
  const [renameTarget, setRenameTarget] = useState<JobSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<JobSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/jobs?archived=${archiveView ? "true" : "false"}`);
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs as JobSummary[]);
      }
    } catch {
      /* transient */
    }
  }, [archiveView]);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Default selection to the most recent job once the list loads.
  useEffect(() => {
    if (!selectedId && jobs.length > 0) setSelectedId(jobs[0].id);
  }, [jobs, selectedId]);

  useEffect(() => {
    if (selectedId && jobs.length > 0 && !jobs.some((j) => j.id === selectedId)) {
      setSelectedId(jobs[0].id);
    }
    if (selectedId && jobs.length === 0) setSelectedId(null);
  }, [jobs, selectedId]);

  useEffect(() => {
    setRenameValue(renameTarget?.title ?? renameTarget?.issue_id ?? "");
    setDialogError(null);
  }, [renameTarget]);

  useEffect(() => {
    setDialogError(null);
  }, [deleteTarget]);

  async function updateConversation(id: string, body: { title?: string; archived?: boolean }) {
    const res = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "conversation update failed");
    }
    await refresh();
  }

  async function submitRename(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!renameTarget || !renameValue.trim()) return;
    setRenameBusy(true);
    try {
      await updateConversation(renameTarget.id, { title: renameValue.trim() });
      setRenameTarget(null);
    } catch (err) {
      setDialogError((err as Error).message);
    } finally {
      setRenameBusy(false);
    }
  }

  async function archiveConversation(job: JobSummary) {
    await updateConversation(job.id, { archived: !archiveView });
    if (job.id === selectedId) setSelectedId(null);
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/jobs/${deleteTarget.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "conversation delete failed");
      }
      if (deleteTarget.id === selectedId) setSelectedId(null);
      await refresh();
      setDeleteTarget(null);
    } catch (err) {
      setDialogError((err as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="flex">
      <Sidebar
        jobs={jobs}
        selectedId={selectedId}
        archiveView={archiveView}
        onArchiveViewChange={setArchiveView}
        onSelect={setSelectedId}
        onNew={() => setModalOpen(true)}
        onRename={setRenameTarget}
        onArchive={archiveConversation}
        onDelete={setDeleteTarget}
      />

      <main className="flex-1">
        {selectedId ? (
          <JobConsole key={selectedId} jobId={selectedId} onChange={refresh} onNew={() => setModalOpen(true)} />
        ) : (
          <EmptyState archiveView={archiveView} onNew={() => setModalOpen(true)} />
        )}
      </main>

      {modalOpen && (
        <NewJobModal
          onClose={() => setModalOpen(false)}
          onCreated={(id) => {
            setModalOpen(false);
            setSelectedId(id);
            void refresh();
          }}
        />
      )}

      <Dialog open={!!renameTarget} onOpenChange={(open) => !open && setRenameTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename conversation</DialogTitle>
            <DialogDescription>
              Set a concise label for this dispatch. The issue id remains visible in the details.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={submitRename}>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={120}
              autoFocus
              className="w-full rounded-sm border border-line bg-bg/60 px-3 py-2 font-mono text-sm text-ink placeholder:text-faint focus:border-amber focus:outline-none"
              placeholder="Conversation title"
            />
            {dialogError && <p className="mt-3 border-l-2 border-err pl-2 text-xs text-err">{dialogError}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenameTarget(null)}>
                Cancel
              </Button>
              <Button type="submit" disabled={renameBusy || !renameValue.trim()}>
                {renameBusy ? "Saving..." : "Save"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete conversation</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteTarget?.title ?? deleteTarget?.issue_id}" permanently. This removes its event history and
              best-effort destroys its sandbox if one still exists.
            </AlertDialogDescription>
            {dialogError && <p className="mt-3 border-l-2 border-err pl-2 text-xs text-err">{dialogError}</p>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={deleteBusy} onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}>
              {deleteBusy ? "Deleting..." : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function EmptyState({ archiveView, onNew }: { archiveView: boolean; onNew: () => void }) {
  return (
    <div className="grid h-screen place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center border border-amber/40 bg-amber/10 text-2xl text-amber">⚙</div>
        <h2 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-ink">
          {archiveView ? "No archived dispatches" : "No dispatch selected"}
        </h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
          {archiveView
            ? "Archived conversations stay out of the active queue until you restore them."
            : "Point an agent at a repository and a task. It provisions a sandbox, implements the change, and opens a pull request — live."}
        </p>
        {!archiveView && (
          <button
            onClick={onNew}
            className="mt-6 bg-amber px-5 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-black hover:bg-amber-deep transition-colors"
          >
            + New dispatch
          </button>
        )}
      </div>
    </div>
  );
}
