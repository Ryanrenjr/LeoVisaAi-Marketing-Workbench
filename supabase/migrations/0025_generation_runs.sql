-- LeoVisaAi 营销工作台 — 一键生成流程的断点续跑记录
-- Live audit finding (P0): GenerationRunner's progress lived entirely in
-- React state — a page refresh, dropped connection, or crashed tab mid-
-- pipeline meant the client component remounted and started every step
-- over from scratch on the next `?generating=<topicId>` load, re-running
-- (and re-billing) AI calls that had already succeeded. This table lets
-- the client ask "what's already done for this topic" before starting
-- any work — see getOrCreateGenerationRun/markGenerationRunStep in
-- src/app/topics/pipeline-actions.ts.
--
-- Cascades with the topic (on delete cascade) — a topic only ever has one
-- meaningful run in this one-shot model, and when the topic is discarded
-- or the session completes, this row disappears with it. No cleanup code
-- needed, consistent with every other child table under topics.

create table public.generation_runs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  platforms text[] not null,
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  completed_steps text[] not null default '{}',
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index generation_runs_topic_id_idx on public.generation_runs (topic_id, created_at desc);

alter table public.generation_runs enable row level security;

create policy "generation_runs are readable by any signed-in staff member"
  on public.generation_runs for select
  to authenticated
  using (true);

create policy "generation_runs are writable by any signed-in staff member"
  on public.generation_runs for all
  to authenticated
  using (true)
  with check (true);
