-- LeoVisaAi 营销工作台 — 原子 claim，解决一键生成的并发重复收费
-- Live audit finding (P0): the since-based idempotency built up over the
-- last several rounds ("SELECT, decide in JS, then act") has a race
-- window — two tabs, or a stale in-flight request plus a fresh one after
-- a refresh, can both read "not generated yet" before either writes,
-- and both go on to call a paid AI provider for the exact same subtask.
-- This table + the claim_generation_run_task() function below close that
-- window: every billable subtask must win an atomic claim here before a
-- provider call is allowed. since-based checks stay in place as a second
-- layer (they still catch "the AI succeeded but this ledger write failed").

-- Defensive dedupe before the UNIQUE constraint below — the table is
-- currently empty in production, but a migration must not assume that;
-- keep the newest row per topic_id and drop the rest so the constraint
-- can never fail to apply.
delete from public.generation_runs a
using public.generation_runs b
where a.topic_id = b.topic_id
  and a.created_at < b.created_at;

alter table public.generation_runs
  add constraint generation_runs_topic_id_key unique (topic_id);

create table public.generation_run_tasks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.generation_runs (id) on delete cascade,
  task_key text not null,
  status text not null default 'running' check (status in ('pending', 'running', 'completed', 'failed')),
  claimed_at timestamptz,
  lease_until timestamptz,
  completed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (run_id, task_key)
);

alter table public.generation_run_tasks enable row level security;

-- ADMIN-only, not `to authenticated using(true)` — this table only ever
-- needs to be touched by the one fixed operator account (same posture as
-- leo_portraits, see 0017_leo_portraits.sql).
create policy "generation_run_tasks are usable by ADMIN only"
  on public.generation_run_tasks for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

-- Atomic claim: acquires the task if it doesn't exist yet, or if it's
-- `failed` (an explicit human retry is always allowed to reclaim), or if
-- it's `running` with an expired lease (crash recovery — the original
-- claimant never finished within its lease). A `completed` task, or a
-- `running` task with a still-valid lease, is left untouched and the
-- caller did NOT acquire it.
--
-- No `security definer` — deliberately: this runs as the calling
-- (already-authenticated ADMIN operator) role, subject to the RLS policy
-- above like any other query. There is no need for, and this does not
-- introduce, any elevated-privilege bypass of RLS.
--
-- Atomicity comes from Postgres's own guarantee for a single
-- `insert ... on conflict ... do update ... where <cond>` statement: two
-- concurrent callers racing the same (run_id, task_key) conflict are
-- serialized by the row's conflict lock, and the second one to run
-- re-evaluates the WHERE clause against whatever the first one just
-- committed — they cannot both believe they acquired it.
create function public.claim_generation_run_task(
  p_run_id uuid,
  p_task_key text,
  p_lease_seconds int default 120
) returns table (
  id uuid,
  status text,
  claimed_at timestamptz,
  lease_until timestamptz,
  completed_at timestamptz,
  error text,
  acquired boolean
)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_lease_until timestamptz := v_now + make_interval(secs => p_lease_seconds);
  v_rows int;
begin
  insert into public.generation_run_tasks (run_id, task_key, status, claimed_at, lease_until, error, updated_at)
  values (p_run_id, p_task_key, 'running', v_now, v_lease_until, null, v_now)
  on conflict (run_id, task_key) do update
    set status = 'running',
        claimed_at = v_now,
        lease_until = v_lease_until,
        error = null,
        updated_at = v_now
    where public.generation_run_tasks.status = 'failed'
       or (public.generation_run_tasks.status = 'running' and public.generation_run_tasks.lease_until < v_now);

  get diagnostics v_rows = row_count;

  return query
  select t.id, t.status, t.claimed_at, t.lease_until, t.completed_at, t.error, (v_rows > 0)
  from public.generation_run_tasks t
  where t.run_id = p_run_id and t.task_key = p_task_key;
end;
$$;
