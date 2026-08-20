-- LeoVisaAi 营销工作台 — Search Router (Brave Search external-evidence Research path)
-- See docs/search-router.md before changing this file.

-- One row per search execution (one Research run may issue several
-- queries, logged as separate calls but usually recorded once per
-- Research run — see docs/search-router.md "Search usage logging" for
-- why this is a separate table rather than an ai_usage_log extension:
-- a search call has no model/tokens/pricing-per-call semantics, its unit
-- of "usage" is queries, not tokens.
create table public.search_usage_log (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  digital_employee text not null,
  task_type text not null,
  topic_id uuid references public.topics (id) on delete set null,
  query_count integer not null,
  result_count integer not null,
  latency_ms integer not null,
  success boolean not null,
  error text,
  created_at timestamptz not null default now()
);

create index search_usage_log_topic_id_idx on public.search_usage_log (topic_id);
create index search_usage_log_provider_idx on public.search_usage_log (provider);

alter table public.search_usage_log enable row level security;

create policy "search_usage_log is readable by any signed-in staff member"
  on public.search_usage_log for select to authenticated using (true);

create policy "search_usage_log is insertable by any signed-in staff member"
  on public.search_usage_log for insert to authenticated with check (true);
