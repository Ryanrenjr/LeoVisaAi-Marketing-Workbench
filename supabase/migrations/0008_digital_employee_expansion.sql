-- LeoVisaAi 营销工作台 — Digital Employee Expansion
-- Live, explicit user instruction (see CLAUDE.md history) authorized three
-- things this migration supports, each overriding an earlier "not this
-- phase" note in this codebase:
--   1. Custom names for digital employees (employee_names).
--   2. Employee D — Compliance — going live for real (compliance_reviews).
--   3. A new "analyst" employee reading post-publish performance data,
--      including a narrow, explicit exception to "no upload feature
--      anywhere in this app" (docs/security-boundaries.md) — screenshots
--      of a platform's own public post-performance numbers only, never a
--      client document. See docs/security-boundaries.md for the updated
--      boundary text.

-- 1. Digital employee custom names ------------------------------------------
-- One row per employee that has been renamed; absence of a row means "use
-- the default name in boss-language.ts". Read by any signed-in staff
-- member, written by ADMIN only — same pattern as model_routing_config.
create table public.employee_names (
  employee_id text primary key
    check (employee_id in ('planner', 'researcher', 'editor', 'compliance', 'analyst')),
  custom_name text not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.employee_names enable row level security;

create policy "employee_names are readable by any signed-in staff member"
  on public.employee_names for select to authenticated using (true);

create policy "employee_names are writable by ADMIN only"
  on public.employee_names for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

-- 2. Compliance reviews -------------------------------------------------------
-- One row per compliance pass over one content_asset. Advisory only — see
-- compliance-schemas.ts. Never a "content is compliant" certification;
-- findings are flags for a human, same evidentiary posture as
-- expert_review_notes on content_assets.
create table public.compliance_reviews (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  content_asset_id uuid not null references public.content_assets (id) on delete cascade,
  overall_risk text not null check (overall_risk in ('LOW', 'MEDIUM', 'HIGH')),
  findings jsonb not null default '[]'::jsonb,
  model_alias text,
  provider text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index compliance_reviews_topic_id_idx on public.compliance_reviews (topic_id);
create index compliance_reviews_content_asset_id_idx on public.compliance_reviews (content_asset_id);

alter table public.compliance_reviews enable row level security;

create policy "compliance_reviews are readable by any signed-in staff member"
  on public.compliance_reviews for select to authenticated using (true);

create policy "compliance_reviews are insertable by ADMIN only"
  on public.compliance_reviews for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

-- 3. Post-publish performance data (analyst) ---------------------------------
-- One row per screenshot Leo uploads after publishing. screenshot_path
-- points into the private 'publish-screenshots' storage bucket below —
-- never a public URL. extracted_metrics is whatever the vision model read
-- off the screenshot (views/likes/comments/saves as available) — a
-- best-effort structured read of a screenshot Leo already chose to upload,
-- not OCR run against arbitrary documents. This table and its bucket exist
-- ONLY for a platform's own public post-performance numbers; see
-- docs/security-boundaries.md "Post-publish performance data" for the
-- exact boundary (never a client document, never case data).
create table public.publish_performance (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  platform public.content_platform not null,
  screenshot_path text not null,
  extracted_metrics jsonb not null default '{}'::jsonb,
  analysis_note text not null default '',
  model_alias text,
  provider text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index publish_performance_topic_id_idx on public.publish_performance (topic_id);

alter table public.publish_performance enable row level security;

create policy "publish_performance is readable by any signed-in staff member"
  on public.publish_performance for select to authenticated using (true);

create policy "publish_performance is insertable by any signed-in staff member"
  on public.publish_performance for insert to authenticated with check (true);

-- Private bucket — screenshots are never public. Only server-side code
-- (Server Actions, using the caller's own session) reads/writes it.
insert into storage.buckets (id, name, public)
values ('publish-screenshots', 'publish-screenshots', false)
on conflict (id) do nothing;

create policy "publish-screenshots are readable by any signed-in staff member"
  on storage.objects for select to authenticated
  using (bucket_id = 'publish-screenshots');

create policy "publish-screenshots are uploadable by any signed-in staff member"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'publish-screenshots');
