-- LeoVisaAi 营销工作台 — Multi-provider AI Model Router
-- See docs/model-router.md before changing this file.

-- ai_usage_log already exists (0003, extended in 0005). Extend it so every
-- logged call also records which provider/model actually ran it, which
-- task/digital-employee it was for, and whether that model was priced as
-- free/paid/mixed AT THE TIME of execution (pricing changes over time —
-- this column is a snapshot, not a live lookup).
alter table public.ai_usage_log add column provider text;
alter table public.ai_usage_log add column task_type text;
alter table public.ai_usage_log add column digital_employee text;
alter table public.ai_usage_log add column pricing_type_at_execution text;

create index ai_usage_log_task_type_idx on public.ai_usage_log (task_type);
create index ai_usage_log_provider_idx on public.ai_usage_log (provider);

-- One row per task type — ADMIN's persisted default provider/model choice
-- for that task, set from the "AI 模型配置" settings section. Absence of a
-- row means "no explicit default yet" — the Router then falls back to its
-- Development Mode free-first logic (see src/lib/ai/model-selection.ts).
create table public.model_routing_config (
  task_type text primary key,
  provider text not null,
  model_id text not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.model_routing_config enable row level security;

create policy "model_routing_config is readable by any signed-in staff member"
  on public.model_routing_config for select to authenticated using (true);

create policy "model_routing_config is writable by ADMIN only"
  on public.model_routing_config for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
