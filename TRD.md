# Technical Requirements Document (TRD)
## Component: Agentic PR Factory — Platform (Orchestrator + Frontend)
### Version: 1.0
### Date: May 30, 2026
### Status: In implementation
### Related: [../PRD.md](../PRD.md), [../TRD.md](../TRD.md) (pi-coder), `pi-coding-agent/`

---

## 1. Purpose & Scope

This is **sub-project 2** of the Agentic PR Factory: the web application a user interacts with. It collects a
GitHub repo + task + credentials, provisions a **Daytona sandbox**, installs and runs **pi-coder** inside it,
and streams the agent's live progress back to the browser — with controls to chat, ask status, interrupt, and
stop.

pi-coder (sub-project 1, `pi-coding-agent/`) is already built and is transport-agnostic: it reads `task.json`
+ env vars, emits NDJSON events on stdout, and reads NDJSON control commands on stdin. This platform's job is
purely orchestration + UI; it does not change pi-coder.

### In scope
Submit form, Daytona sandbox lifecycle, pi-coder install + run, live event streaming to the browser (SSE),
control relay (chat/status/interrupt/stop), PR-link surfacing, basic job list. Single-user / single-org MVP.

### Out of scope (MVP)
Auth/RBAC, durable job persistence (DB), multi-tenant isolation, queueing, cost dashboards, retries. Job state
is in-memory; the server runs as a long-lived Node process (not serverless/edge).

---

## 2. Technology Stack

| Concern | Choice |
|---------|--------|
| Framework | **Next.js (App Router)**, TypeScript, run via `next start` (Node runtime — needed for in-memory job state + long-lived SSE). |
| Sandbox | **`@daytonaio/sdk`** (v0.183.x). |
| Styling | Tailwind CSS. |
| Validation | zod (shared shape with pi-coder's task contract). |
| Streaming | Server-Sent Events (one-way server→browser) + POST endpoints for control (browser→server). |

**Why SSE + POST, not WebSocket:** Next.js App Router has no first-class WebSocket server. Progress is
one-way (sandbox→browser) — SSE fits. Control is low-frequency (chat/stop) — a POST per command is simpler and
avoids a custom WS server. This matches the working Daytona reference, which drives sandboxes with discrete
commands, not a persistent socket.

---

## 3. Architecture

```
Browser                         Next.js server (Node)                    Daytona sandbox
┌──────────────┐   POST /api/jobs    ┌────────────────────┐   SDK    ┌────────────────────────┐
│ Submit form  │───────────────────▶│  JobManager        │─────────▶│ node:22-bookworm        │
│              │                     │  (in-memory Map)   │  create  │  + bun, git, ripgrep    │
│ Live view    │  GET .../events SSE │  ┌──────────────┐  │  exec    │  + pi-coder (installed) │
│  - events    │◀───────────────────│  │ Job          │  │          │                         │
│  - chat box  │  POST .../control   │  │  sandbox ref │  │  upload  │  /tmp/pi-coder/         │
│  - stop btn  │───────────────────▶│  │  event buffer│  │          │   task.json             │
└──────────────┘                     │  │  subscribers │  │          │   control.log (tail -f) │
                                      │  └──────────────┘  │  stream  │   events.ndjson         │
                                      └────────────────────┘◀─────────│   result.json           │
                                                                       └────────────────────────┘
```

### Logical components
1. **Frontend** — submit form (`/`) and live job view (`/jobs/[id]`).
2. **API routes** — create job, fetch status, SSE events, control relay.
3. **JobManager** — in-memory registry of jobs and their lifecycle, event buffers, and SSE subscribers.
4. **DaytonaRunner** — wraps the SDK: create sandbox, bootstrap, install pi-coder, upload task, start pi-coder,
   stream events, send control, teardown.

---

## 4. Sandbox execution model (the key design)

The Daytona TS SDK supports interactive session commands directly, which maps perfectly onto pi-coder's
stdin (control) / stdout (events) contract — no file hacks needed:

- `process.createSession(sessionId)` — one session per job.
- `process.executeSessionCommand(sessionId, { command, runAsync: true })` → `{ cmdId }` — starts pi-coder
  async: `pi-coder run --task /tmp/pi-coder/task.json --output /tmp/pi-coder/result.json`.
- `process.getSessionCommandLogs(sessionId, cmdId, onStdout, onStderr)` — **streaming callbacks**. `onStdout`
  receives pi-coder's NDJSON events as they're produced → the runner splits on newlines, parses each as a
  `PiEvent`, and pushes to SSE subscribers. `onStderr` is captured as the human log.
- `process.sendSessionCommandInput(sessionId, cmdId, line + "\n")` — writes a control command directly to
  pi-coder's **stdin**. Chat/status/interrupt/resume/stop each send one NDJSON line.

On completion, `result.json` is read from the sandbox (`fs.downloadFile` / `cat`) for the final summary + PR
URL — also surfaced live via the `pr_created`/`done` events.

This requires **no change to pi-coder** — its stdin/stdout contract is honored exactly, over the SDK.

> A chunk from `onStdout` may contain partial lines; the runner buffers a trailing partial line and only emits
> complete NDJSON lines (the same discipline pi-coder uses when writing them).

---

## 5. Sandbox provisioning & pi-coder install

1. **Create** sandbox from image `node:22-bookworm` with `Resources(cpu=2, memory=4, disk=10)`,
   `autoStopInterval` per TTL policy, labels `{app: "pr-factory"}`, and `envVars` = the run secrets
   (`OPENROUTER_API_KEY`/provider key + `GITHUB_TOKEN`) so the pi-coder process inherits them.
2. **Bootstrap** (one-shot exec, ~once per sandbox):
   - `apt-get update -qq && apt-get install -y git ripgrep` (Node is preinstalled on the image).
   - Install bun: `curl -fsSL https://bun.sh/install | bash` and add `~/.bun/bin` to PATH for subsequent execs.
3. **Install pi-coder** — two supported modes (config `PI_CODER_SOURCE`):
   - **`git`** (preferred once published): `git clone <PI_CODER_REPO_URL> /opt/pi-coder && cd /opt/pi-coder && bun install`.
   - **`upload`** (works today, repo not yet published): the orchestrator tars the local `pi-coding-agent`
     source (excluding `node_modules`/`dist`/`.git`), uploads it via the SDK, extracts to `/opt/pi-coder`, and
     runs `bun install`.
   - Expose pi-coder as `pi-coder` on PATH (symlink to `bun /opt/pi-coder/src/cli.ts` or the compiled binary).
4. **Verify**: run `pi-coder init` and assert the readiness report is ok before accepting the task.

> Note: pi-coder loads skills from `<install>/skills`. The `upload`/`git` install keeps the `skills/` dir next
> to `src/`, so `defaultSkillsDir()` resolves correctly. (A future compiled-binary install would set a
> `PI_CODER_SKILLS_DIR` override — deferred.)

---

## 6. Data model (in-memory)

```ts
type JobStatus = "provisioning" | "bootstrapping" | "running" | "completed" | "failed" | "stopped";

interface Job {
  id: string;                 // uuid
  status: JobStatus;
  request: JobRequest;        // sanitized — NO secrets retained after sandbox env injection
  sandboxId: string | null;
  events: PiEvent[];          // ring buffer (cap N) for replay to late subscribers
  eventOffset: number;        // byte offset read so far from events.ndjson
  subscribers: Set<(e: PiEvent) => void>;
  prUrl: string | null;
  resultStatus: string | null;
  createdAt: string;
  error: string | null;
}
```
Secrets (provider key, GitHub PAT) are used to create the sandbox env and then **dropped** from the in-memory
request; they are never written to logs or sent to the browser.

---

## 7. API surface

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/jobs` | POST | Validate `JobRequest`; create Job; launch orchestration async; return `{ job_id }`. |
| `/api/jobs/:id` | GET | Job metadata + current status + prUrl. |
| `/api/jobs/:id/events` | GET (SSE) | Replays buffered events, then streams live ones until `done`/terminal. |
| `/api/jobs/:id/control` | POST | Body `{type:"chat"|"status"|"interrupt"|"resume"|"stop", text?}` → append to sandbox `control.log`. |

`JobRequest` (form payload): `repo`, `base_ref`, `issue_id`, `instructions`, `acceptance_criteria`,
`allow_write[]`, `provider {name, model}`, `provider_api_key`, `github_pat`. The server assembles `task.json`
from this (generating `task_id`, mapping keys to `*_env` references) and injects the two secrets as sandbox
env vars.

---

## 8. Frontend

- **`/` — Submit:** a form for the `JobRequest` fields. Provider dropdown (openrouter/anthropic/openai) + model
  text. Secret fields (provider key, PAT) are password inputs, sent once over HTTPS, never echoed back. On
  submit → POST `/api/jobs` → redirect to `/jobs/:id`.
- **`/jobs/:id` — Live view:**
  - Subscribes to the SSE event stream; renders a timeline grouped by phase, with tool calls, streamed
    `llm_text`, test results, the review outcome, and a prominent **PR link** on `pr_created`.
  - A **chat box** (POST control `chat`), **Status**, **Interrupt/Resume**, and **Stop** buttons (POST control).
  - Connection + job status indicator; terminal state shows the final result summary.
- Built with the frontend-design skill for a clean, legible operator console (not generic AI aesthetic).

---

## 9. Lifecycle & states

`provisioning → bootstrapping → running → (completed | failed | stopped)`. The orchestration runs as an async
task kicked off by POST `/api/jobs`; it advances Job.status and pushes synthetic platform events
(`provisioning`, `bootstrapping`) plus all pi-coder events. TTL: idle sandboxes auto-stop; a completed job's
sandbox is deleted after the result + PR are captured (configurable to keep for debugging).

---

## 10. Security

- Secrets only ever live: (a) in the POST body over HTTPS, (b) injected as sandbox env vars, (c) transiently in
  server memory during creation. Never logged, never returned to the browser, never written to `task.json`.
- The GitHub PAT is scoped by the user (repo scope). The sandbox is the only place it's used (clone/push/PR).
- Daytona signed preview URLs are NOT exposed for pi-coder (no web server in the sandbox); only the orchestrator
  talks to the sandbox via the SDK.
- Per-job sandboxes give data-plane isolation; teardown guarantees cleanup.

---

## 11. Error handling

| Failure | Handling |
|---------|----------|
| Daytona create fails | Job → failed; surface error event; no sandbox to clean. |
| Bootstrap/install fails | Job → failed; capture stderr; delete sandbox. |
| `pi-coder init` not ok | Job → failed with the readiness report. |
| Event stream gap / sandbox dies | Mark job failed if the process exits without `done`; flush `session.err`. |
| Browser disconnect | SSE subscriber removed; job keeps running; reconnect replays from buffer. |

---

## 12. Project structure (Next.js App Router)

```
platform/
  app/
    page.tsx                     # submit form
    jobs/[id]/page.tsx           # live view (client component, SSE)
    api/jobs/route.ts            # POST create
    api/jobs/[id]/route.ts       # GET status
    api/jobs/[id]/events/route.ts# GET SSE
    api/jobs/[id]/control/route.ts# POST control
  lib/
    job-manager.ts               # in-memory registry + lifecycle
    daytona-runner.ts            # SDK wrapper: create/bootstrap/install/run/stream/control/teardown
    task-builder.ts              # JobRequest → task.json + env mapping
    contracts.ts                 # zod for JobRequest; re-use pi-coder event types
    orchestrate.ts               # the async provision→run→finalize flow
  components/                    # form, event timeline, controls
  .env.example                  # DAYTONA_API_KEY, PI_CODER_SOURCE, PI_CODER_REPO_URL
```

---

## 13. Acceptance criteria (platform MVP)

1. Submitting the form for an accessible repo provisions a sandbox, installs pi-coder, and starts a run.
2. The live view streams pi-coder's events in near-real-time (phases, tool calls, llm_text, tests, review).
3. Chat, Status, Interrupt/Resume, and Stop from the UI reach the agent and visibly affect the stream.
4. On success, the PR link appears in the UI and the final result summary is shown.
5. Secrets never appear in any event, log, or response body.
6. A failed/stopped run shows a clear terminal state; sandboxes are cleaned up.

---

## 14. Open questions / deferred
1. Publish pi-coder to a GitHub repo (enables `git` install mode) vs. keep `upload` mode.
2. Durable persistence (DB) for jobs across server restarts.
3. Auth + multi-user, and per-repo allowlists (PRD scope).
4. Reusing a warm sandbox/snapshot with pi-coder pre-baked (PRD Option A) to cut bootstrap time.
