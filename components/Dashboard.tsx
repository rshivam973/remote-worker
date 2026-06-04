"use client";

import { useCallback, useEffect, useState } from "react";
import { Sidebar } from "./Sidebar";
import { JobConsole } from "./JobConsole";
import { NewJobModal } from "./NewJobModal";
import type { JobSummary } from "./types";

export function Dashboard({ initialJobId }: { initialJobId?: string }) {
  const [jobs, setJobs] = useState<JobSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialJobId ?? null);
  const [modalOpen, setModalOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/jobs");
      if (res.ok) {
        const data = await res.json();
        setJobs(data.jobs as JobSummary[]);
      }
    } catch {
      /* transient */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(refresh, 4000);
    return () => clearInterval(t);
  }, [refresh]);

  // Default selection to the most recent job once the list loads.
  useEffect(() => {
    if (!selectedId && jobs.length > 0) setSelectedId(jobs[0].id);
  }, [jobs, selectedId]);

  return (
    <div className="flex">
      <Sidebar jobs={jobs} selectedId={selectedId} onSelect={setSelectedId} onNew={() => setModalOpen(true)} />

      <main className="flex-1">
        {selectedId ? (
          <JobConsole key={selectedId} jobId={selectedId} onChange={refresh} onNew={() => setModalOpen(true)} />
        ) : (
          <EmptyState onNew={() => setModalOpen(true)} />
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
    </div>
  );
}

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="grid h-screen place-items-center">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-5 grid h-14 w-14 place-items-center border border-amber/40 bg-amber/10 text-2xl text-amber">⚙</div>
        <h2 className="font-mono text-sm font-bold uppercase tracking-[0.2em] text-ink">No dispatch selected</h2>
        <p className="mx-auto mt-2 max-w-xs text-sm text-muted">
          Point an agent at a repository and a task. It provisions a sandbox, implements the change, and opens a pull request — live.
        </p>
        <button
          onClick={onNew}
          className="mt-6 bg-amber px-5 py-2.5 text-xs font-bold uppercase tracking-[0.15em] text-black hover:bg-amber-deep transition-colors"
        >
          + New dispatch
        </button>
      </div>
    </div>
  );
}
