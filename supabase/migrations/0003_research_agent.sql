-- LeoVisaAi 营销工作台 — Research Agent
-- See docs/data-model.md, docs/security-boundaries.md, and docs/phase-3-plan.md
-- before changing this file.

-- "Research completed" now formally means "research has been approved by
-- an Expert" — see docs/phase-3-plan.md for the reasoning.
alter type public.topic_status rename value 'RESEARCH_COMPLETED' to 'RESEARCH_APPROVED';

-- New activity types for the research workflow.
alter type public.topic_activity_type add value 'research_run_started';
alter type public.topic_activity_type add value 'research_run_completed';
alter type public.topic_activity_type add value 'research_run_failed';
alter type public.topic_activity_type add value 'research_edited';
alter type public.topic_activity_type add value 'research_approved';
alter type public.topic_activity_type add value 'research_changes_requested';

-- ---------------------------------------------------------------------
-- research_runs — one row per "运行研究" invocation. ADMIN-only.
-- ---------------------------------------------------------------------

create type public.research_run_status as enum ('running', 'completed', 'failed');

create table public.research_runs (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  status public.research_run_status not null default 'running',
  model_alias text not null,
  requested_by uuid references public.profiles (id),
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);

create index research_runs_topic_id_idx on public.research_runs (topic_id);

-- ---------------------------------------------------------------------
-- research_packs — the saved output of a completed run. General
-- marketing research only — never individualized legal advice, never
-- real client information. See docs/security-boundaries.md.
-- ---------------------------------------------------------------------

create table public.research_packs (
  id uuid primary key default gen_random_uuid(),
  research_run_id uuid not null unique references public.research_runs (id) on delete cascade,
  topic_id uuid not null references public.topics (id) on delete cascade,
  summary text not null,
  key_findings jsonb not null default '[]'::jsonb,
  warnings text not null default '',
  edited_by uuid references public.profiles (id),
  edited_at timestamptz,
  created_at timestamptz not null default now()
);

create index research_packs_topic_id_idx on public.research_packs (topic_id);

create table public.research_sources (
  id uuid primary key default gen_random_uuid(),
  research_pack_id uuid not null references public.research_packs (id) on delete cascade,
  title text not null,
  url text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);

create index research_sources_pack_id_idx on public.research_sources (research_pack_id);

-- ---------------------------------------------------------------------
-- research_approvals — the mandatory human-approval-gate record for the
-- research stage. EXPERT-only (not ADMIN — a second person must review
-- the research an ADMIN ran before it can move forward).
-- ---------------------------------------------------------------------

create type public.research_approval_decision as enum ('approved', 'changes_requested');

create table public.research_approvals (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  research_pack_id uuid not null references public.research_packs (id) on delete cascade,
  decision public.research_approval_decision not null,
  decided_by uuid not null references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index research_approvals_topic_id_idx on public.research_approvals (topic_id);

-- ---------------------------------------------------------------------
-- ai_usage_log — one row per model call, for every workflow that ever
-- calls a model. Written regardless of success/failure.
-- ---------------------------------------------------------------------

create table public.ai_usage_log (
  id uuid primary key default gen_random_uuid(),
  workflow_type text not null,
  model_alias text not null,
  topic_id uuid references public.topics (id) on delete set null,
  input_tokens integer,
  output_tokens integer,
  latency_ms integer not null,
  success boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index ai_usage_log_topic_id_idx on public.ai_usage_log (topic_id);
create index ai_usage_log_workflow_type_idx on public.ai_usage_log (workflow_type);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.research_runs enable row level security;
alter table public.research_packs enable row level security;
alter table public.research_sources enable row level security;
alter table public.research_approvals enable row level security;
alter table public.ai_usage_log enable row level security;

create policy "research_runs are readable by any signed-in staff member"
  on public.research_runs for select to authenticated using (true);

create policy "research_runs are insertable/updatable by ADMIN only"
  on public.research_runs for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "research_runs are updatable by ADMIN only"
  on public.research_runs for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "research_packs are readable by any signed-in staff member"
  on public.research_packs for select to authenticated using (true);

create policy "research_packs are insertable/editable by ADMIN only"
  on public.research_packs for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "research_packs are updatable by ADMIN only"
  on public.research_packs for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "research_sources are readable by any signed-in staff member"
  on public.research_sources for select to authenticated using (true);

create policy "research_sources are insertable/editable by ADMIN only"
  on public.research_sources for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "research_sources are deletable by ADMIN only"
  on public.research_sources for delete to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

create policy "research_approvals are readable by any signed-in staff member"
  on public.research_approvals for select to authenticated using (true);

create policy "research_approvals are insertable by EXPERT only, as self-attribution"
  on public.research_approvals for insert to authenticated
  with check (
    decided_by = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'EXPERT')
  );

create policy "ai_usage_log is readable by any signed-in staff member"
  on public.ai_usage_log for select to authenticated using (true);

create policy "ai_usage_log is insertable by any signed-in staff member"
  on public.ai_usage_log for insert to authenticated with check (true);
