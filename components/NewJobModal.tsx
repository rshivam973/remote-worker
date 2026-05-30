"use client";

import { useEffect, useState } from "react";

const FIELD =
  "w-full rounded-sm bg-bg/60 border border-line px-3 py-2 text-sm text-ink placeholder:text-faint focus:outline-none focus:border-amber transition-colors";
const LABEL = "block text-[10px] font-bold uppercase tracking-[0.18em] text-muted mb-1.5";

export function NewJobModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const f = new FormData(e.currentTarget);
    const payload = {
      repo: String(f.get("repo") || ""),
      base_ref: String(f.get("base_ref") || "main"),
      issue_id: String(f.get("issue_id") || "") || undefined,
      instructions: String(f.get("instructions") || ""),
      acceptance_criteria: String(f.get("acceptance_criteria") || "") || undefined,
      allow_write: String(f.get("allow_write") || ".").split(",").map((s) => s.trim()).filter(Boolean),
      provider: { name: String(f.get("provider") || "openrouter"), model: String(f.get("model") || "") },
      provider_api_key: String(f.get("provider_api_key") || ""),
      github_pat: String(f.get("github_pat") || ""),
    };
    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.issues?.join("; ") || data.error || "request failed");
      onCreated(data.job_id);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 fade-in p-4 sm:p-8" onClick={onClose}>
      <div
        className="pop-in mt-4 w-full max-w-xl border border-line-bright bg-panel shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Title bar */}
        <div className="flex items-center justify-between border-b border-line bg-panel-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 bg-amber" />
            <h2 className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-ink">New Dispatch</h2>
          </div>
          <button onClick={onClose} className="text-faint hover:text-ink text-lg leading-none">×</button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4 p-5">
          <div>
            <label className={LABEL}>Repository</label>
            <input name="repo" required placeholder="https://github.com/org/repo.git" className={`${FIELD} font-mono`} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Base branch</label>
              <input name="base_ref" defaultValue="main" className={`${FIELD} font-mono`} />
            </div>
            <div>
              <label className={LABEL}>Issue ID · optional</label>
              <input name="issue_id" placeholder="auto-named if blank" className={`${FIELD} font-mono`} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Task</label>
            <textarea name="instructions" required rows={3} placeholder="Fix the off-by-one in pagination; add a regression test." className={FIELD} />
          </div>
          <div>
            <label className={LABEL}>Acceptance criteria · optional</label>
            <textarea name="acceptance_criteria" rows={2} placeholder="Tests pass; new test covers the boundary." className={FIELD} />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>Provider</label>
              <select name="provider" defaultValue="openrouter" className={FIELD}>
                <option value="openrouter">OpenRouter</option>
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>
            <div className="col-span-2">
              <label className={LABEL}>Model</label>
              <input name="model" required placeholder="anthropic/claude-sonnet-4" className={`${FIELD} font-mono`} />
            </div>
          </div>
          <div>
            <label className={LABEL}>Writable paths · comma-separated</label>
            <input name="allow_write" defaultValue="." className={`${FIELD} font-mono`} />
          </div>

          <div className="border border-line bg-bg/40 p-3.5 space-y-3">
            <p className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-faint">
              <span className="text-amber">🔒</span> injected as sandbox env · never stored or echoed
            </p>
            <div>
              <label className={LABEL}>LLM API key</label>
              <input name="provider_api_key" type="password" required placeholder="sk-or-…" className={`${FIELD} font-mono`} />
            </div>
            <div>
              <label className={LABEL}>GitHub PAT · repo scope</label>
              <input name="github_pat" type="password" required placeholder="ghp_…" className={`${FIELD} font-mono`} />
            </div>
          </div>

          {error && <p className="border-l-2 border-err pl-2 text-xs text-err">{error}</p>}

          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3 py-2 text-xs uppercase tracking-wider text-muted hover:text-ink">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="group flex items-center gap-2 bg-amber px-4 py-2 text-xs font-bold uppercase tracking-[0.15em] text-black hover:bg-amber-deep disabled:opacity-50 transition-colors"
            >
              {submitting ? "Dispatching…" : "Dispatch agent ▸"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
