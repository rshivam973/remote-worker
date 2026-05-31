-- Agentic PR Factory — conversation persistence (run in the Supabase SQL editor)
--
-- Two tables: conversations (one row per dispatch) and events (the telemetry +
-- chat log). The server uses the SERVICE ROLE key, which bypasses RLS, so RLS
-- is enabled with no policies — nothing else can read/write these tables.

create table if not exists conversations (
  id             uuid primary key,
  status         text not null,
  issue_id       text,
  repo           text not null,
  base_ref       text,
  instructions   text,
  provider       jsonb,
  sandbox_id     text,
  sandbox_state  text not null default 'pending',
  pr_url         text,
  result_status  text,
  error          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists events (
  id              bigint generated always as identity primary key,
  conversation_id uuid not null references conversations(id) on delete cascade,
  seq             integer not null,           -- per-conversation ordering for replay
  type            text not null,
  payload         jsonb not null,             -- the full event object
  created_at      timestamptz not null default now()
);

create index if not exists events_conversation_seq_idx
  on events (conversation_id, seq);

create index if not exists conversations_created_at_idx
  on conversations (created_at desc);

alter table conversations enable row level security;
alter table events enable row level security;
-- Intentionally NO policies: only the server's service-role key may access these.
