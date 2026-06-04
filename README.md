# Agentic PR Factory — Platform

The web app for the Agentic PR Factory. You point it at a GitHub repo and a task; it provisions a **Daytona
sandbox**, installs and runs the **pi-coder** agent inside it, and streams the agent's work back to your browser
in real time — with a chat you can use to steer the agent, ask questions, and control the sandbox. When the
agent finishes it opens a Pull Request, then stays alive so you can chat about the changes.

> This is **sub-project 2**. The agent itself lives in [`../pi-coding-agent`](../pi-coding-agent) (published at
> `github.com/rshivam973/pi-coder`). This repo is pure orchestration + UI — it does not change the agent.

---

## Table of contents
- [Architecture](#architecture)
- [How a dispatch flows](#how-a-dispatch-flows)
- [Tech stack](#tech-stack)
- [Setup](#setup)
- [Environment variables](#environment-variables)
- [Supabase persistence](#supabase-persistence)
- [Running](#running)
- [API](#api)
- [UI](#ui)
- [Sandbox lifecycle](#sandbox-lifecycle)
- [Security](#security)
- [Project structure](#project-structure)
- [Limitations](#limitations)

---

## Architecture

```
Browser                      Next.js server (Node)                       Daytona sandbox
┌──────────────┐  POST /api/jobs   ┌─────────────────────┐   SDK    ┌────────────────────────┐
│ Dashboard    │──────────────────▶│ JobManager (memory) │─────────▶│ node:22-bookworm        │
│  - sidebar   │  GET .../events    │  + DaytonaRunner    │  create  │  + bun, git, ripgrep    │
│  - console   │◀────── SSE ────────│  (live cache)       │  exec    │  + pi-coder (installed) │
│  - chat      │  POST .../control  │         │           │  stream  │                         │
│  - sandbox   │──────────────────▶│         ▼           │◀── logs ─│  pi-coder run            │
│    controls  │                    │  Supabase (store)   │  stdin   │   (NDJSON stdout/stdin)  │
└──────────────┘                    │  durable truth      │─────────▶│                         │
                                     └─────────────────────┘          └────────────────────────┘
```

- **JobManager** (`lib/job-manager.ts`) — in-memory registry of live jobs: holds the sandbox runner, fans events
  out to SSE subscribers, and **writes through** to Supabase.
- **DaytonaRunner** (`lib/daytona-runner.ts`) — wraps `@daytonaio/sdk`: create sandbox → bootstrap toolchain →
  install pi-coder → run it as an async session command → stream stdout / relay stdin → lifecycle controls.
- **Supabase store** (`lib/store.ts`) — durable source of truth for conversations + their event log.

### The key trick: stdin/stdout over the SDK
Daytona's TS SDK exposes `getSessionCommandLogs(…, onStdout, onStderr)` (streaming) and
`sendSessionCommandInput(…)`. pi-coder reads control on **stdin** and writes events on **stdout** — so we run it
as an async session command, stream its NDJSON stdout to SSE, and relay control commands straight to its stdin.
No file hacks, no changes to pi-coder.

---

## How a dispatch flows

1. **Submit** — the form posts a `JobRequest` (repo, task, provider/model, LLM key, GitHub PAT).
2. **Provision** — create a `node:22-bookworm` sandbox with the secrets injected as env vars.
3. **Bootstrap** — install `git`, `ripgrep`, `bun`.
4. **Install pi-coder** — upload the local source (or `git clone`), `bun install`, expose a `pi-coder` launcher.
5. **Run** — start `pi-coder run` async; stream its events to the browser; relay your chat to its stdin.
6. **PR** — pi-coder commits, pushes, and opens the PR (the link appears live).
7. **Discuss** — the agent stays alive; chat about the changes until you stop it (or it idles out).

Throughout, conversation metadata + the event log are persisted to Supabase.

---

## Tech stack

- **Next.js (App Router)**, TypeScript, run via `next start` (Node runtime — needed for in-memory live state +
  long-lived SSE).
- **`@daytonaio/sdk`** for sandboxes.
- **`@supabase/supabase-js`** for persistence.
- **Tailwind CSS**, Chivo + JetBrains Mono (industrial control-room theme).
- **SSE** (server→browser events) + **POST** endpoints (browser→server control).

---

## Setup

```bash
npm install
cp .env.example .env     # fill in Clerk + DAYTONA_API_KEY (+ optionally Supabase)
```

You need a **Clerk** application for authentication and a **Daytona** account/API key for sandboxing. The LLM
key and GitHub PAT are **not** set here — users enter them per dispatch in the form, and they're injected into
each sandbox as env vars.

---

## Environment variables

See `.env.example` for the documented list. Summary:

| Var | Required | Purpose |
|-----|----------|---------|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` / `CLERK_SECRET_KEY` | ✅ | User auth, sessions, and route protection. |
| `NEXT_PUBLIC_CLERK_SIGN_IN_URL` / `NEXT_PUBLIC_CLERK_SIGN_UP_URL` | ✅ | Local Clerk auth pages (`/sign-in`, `/sign-up`). |
| `DAYTONA_API_KEY` | ✅ | Provision/control sandboxes. |
| `PI_CODER_SOURCE` | – | `upload` (tar+upload local `../pi-coding-agent`) or `git` (clone `PI_CODER_REPO_URL`). |
| `PI_CODER_REPO_URL` / `PI_CODER_LOCAL_PATH` | – | Source location for the chosen mode. |
| `SANDBOX_IMAGE` / `SANDBOX_CPU` / `SANDBOX_MEMORY` / `SANDBOX_DISK` | – | Sandbox image + sizing. |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | – | Conversation persistence. Unset = memory-only. |

---

## Supabase persistence

Optional but recommended — without it, conversations live only in server memory and vanish on restart.

1. Run [`supabase/schema.sql`](supabase/schema.sql) in the Supabase SQL editor (creates `conversations` +
   `events`, including `conversations.owner_id` for the Clerk user id, `title` for rename, `archived_at` for
   archive state, and `sandbox_details` for Daytona status snapshots; RLS on with no policies — server-only via
   the service-role key).
2. Add `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` to `.env`.

**Design** — DB is the durable source of truth; the in-memory layer is the live cache and writes through:
- **Conversations:** inserted on create with `owner_id = Clerk userId`; status / sandbox state / sandbox details /
  title / archive state / PR / error patched as they change. `sandbox_details` stores the last known Daytona
  snapshot (id, raw state, resources, timestamps, error reason, last check time).
- **Event log:** `llm_text` deltas are **coalesced**, writes are **batched** (every 750 ms / 25 events, immediate
  on `pr_created`/`done`/`error`/`user_msg`), each event carries a per-conversation `seq` for replay ordering.
  Persistence runs behind the live stream and never blocks it.
- **Reads:** the sidebar list, job detail, and SSE *replay* come from the DB, filtered by the signed-in Clerk
  user. Opening a job detail refreshes the saved Daytona sandbox status when a sandbox id exists; if Daytona
  reports it missing/deleted, the conversation is marked `destroyed`. **Live** jobs still stream raw deltas from
  memory. Control/sandbox actions require the live runner in this process.

---

## Running

```bash
npm run dev        # http://localhost:3000
npm run build && npm run start
npm run typecheck
```

> Every dispatch provisions a **real, billable** Daytona sandbox that is kept alive for the discussion phase.
> Use the **Stop** / **Destroy** controls (or let Daytona's idle auto-stop reclaim it) when you're done.

---

## API

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/jobs` | `POST` | Create a dispatch (validates `JobRequest`, launches orchestration). |
| `/api/jobs?archived=false` | `GET` | List active or archived conversations (from DB; falls back to memory). |
| `/api/jobs/:id` | `GET` | Conversation detail + status (live from memory, else DB). |
| `/api/jobs/:id` | `PATCH` | Rename or archive/unarchive a conversation (`{title?, archived?}`). |
| `/api/jobs/:id` | `DELETE` | Permanently delete a conversation and event history; best-effort destroys its sandbox. |
| `/api/jobs/:id/events` | `GET` (SSE) | Replay history + stream live events. |
| `/api/jobs/:id/control` | `POST` | `{type: chat|status|interrupt|resume|stop, text?}` → relayed to pi-coder's stdin. |
| `/api/jobs/:id/sandbox` | `POST` | `{action: stop|start|destroy}` → sandbox lifecycle. |

The `JobRequest`'s `issue_id` is optional — when blank the server derives a label from the task
(e.g. `feature-add-dark-mode`) so the branch/PR still get a sensible name.

All job APIs require a Clerk session. Users can list, rename, archive, delete, inspect, stream, chat with,
stop/start, or destroy only jobs whose `owner_id` matches their Clerk `userId`.

---

## UI

- **`/`** — dashboard: a sidebar of conversations (status dots, sandbox state) + a **New dispatch** modal + the
  live console for the selected job. Clerk's user menu lives in the sidebar. The sidebar includes active/archived
  views and selected-conversation actions for Rename, Archive/Restore, and Delete.
- **`/sign-in` / `/sign-up`** — Clerk-hosted authentication components styled for the control-room shell.
- **Console** — a color-coded event timeline (phases, tool calls, streamed text, tests, review, PR link) with an
  **always-on chat**. Plain text steers/asks the agent; slash commands `/status` `/interrupt` `/resume` `/stop`
  replace buttons. A separate **Sandbox** row has Resume / Stop / Destroy.
- **`/jobs/:id`** — deep link to a conversation (renders the dashboard with it preselected).

---

## Sandbox lifecycle

Sandboxes are **kept alive** after a run (so you can inspect/resume/destroy and chat with the agent). Daytona
`autoStopInterval` stops idle sandboxes and `autoDeleteInterval` is the backstop. The **Resume** control revives a
stopped sandbox (Daytona auto-stops free sandboxes); **Destroy** removes it permanently.

When a user reopens an older conversation, `/api/jobs/:id` refreshes the stored Daytona sandbox snapshot. If the
sandbox has been destroyed or auto-deleted, the dashboard shows a read-only warning and asks the user to create a
new dispatch. The old event timeline and PR link remain visible as history.

---

## Security

- Secrets (LLM key, GitHub PAT) exist only: in the POST body over HTTPS, injected as sandbox env vars, and
  transiently in server memory while creating the sandbox. They are **never** logged, returned to the browser, or
  written to `task.json` / the DB.
- Clerk handles authentication, sessions, sign-in, sign-up, and user management. The platform stores only the
  Clerk `userId` as `conversations.owner_id`.
- Every job route checks ownership before returning history, opening an SSE stream, relaying control, or changing
  sandbox state.
- The Supabase **service-role** key is server-side only (RLS on, no policies — nothing else can touch the tables).
- Per-job sandboxes give data-plane isolation; Stop/Destroy + Daytona TTLs guarantee cleanup.

---

## Project structure

```
app/
  page.tsx                       # authenticated dashboard (renders <Dashboard/>)
  sign-in/[[...sign-in]]/page.tsx # Clerk sign-in
  sign-up/[[...sign-up]]/page.tsx # Clerk sign-up
  jobs/[id]/page.tsx             # deep link
  api/jobs/route.ts              # POST create / GET list
  api/jobs/[id]/route.ts         # GET detail / PATCH rename-archive / DELETE
  api/jobs/[id]/events/route.ts  # SSE
  api/jobs/[id]/control/route.ts # chat/status/interrupt/resume/stop
  api/jobs/[id]/sandbox/route.ts # stop/start/destroy
components/                      # Dashboard, Sidebar, JobConsole, NewJobModal
lib/
  auth.ts          job-manager.ts      daytona-runner.ts   orchestrate.ts
  task-builder.ts  store.ts            contracts.ts
middleware.ts                       # Clerk route protection
supabase/schema.sql
```

---

## Limitations (MVP)

- **Live control is still process-local.** A restarted server can view the signed-in user's conversation history
  from the DB, but can't re-drive a previously live sandbox.
- No queueing, retries, or cost dashboards yet.
- pi-coder install via `upload` works today; `git` mode clones the published repo.
