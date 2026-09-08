-- LeoVisaAi 营销工作台 — RLS 收紧到 fixed ADMIN operator 模型
-- Live audit finding: most tables' policies were written back when this
-- app had real multi-person accounts ("any signed-in staff member") — but
-- the product is now a single shared SITE_PASSWORD gating one fixed
-- OPERATOR_EMAIL account (ADMIN), see CLAUDE.md "Access model". "any
-- authenticated" and "ADMIN only" are practically equivalent today (no
-- other identity can ever hold a session), but the policies should say
-- what they actually mean, and this closes the gap for any future change
-- to who can authenticate.
--
-- What's intentionally NOT touched here (see the round-8 report for the
-- full per-table reasoning):
--   - public.profiles' own SELECT policy stays `using (true)` — every
--     other table's ADMIN check is a subquery against profiles; making
--     profiles' own read policy depend on the same check would be
--     self-referential.
--   - Policies that are already a real ownership/role check, not a blank
--     `using (true)` (topics insert: created_by=auth.uid(); topics
--     delete: ADMIN or EXPERT; topic_activity_log/topic_status_events
--     insert: self-attribution; research_approvals insert: ADMIN or
--     EXPERT + decided_by=auth.uid(); research_runs/research_packs/
--     research_sources/content_assets/compliance_reviews/
--     employee_instructions/employee_names/brand_config/
--     model_routing_config/leo_portraits/generation_run_tasks writes —
--     already ADMIN-gated from earlier migrations).
--   - public.login_attempts — RLS enabled with zero policies already
--     (service-role only).
--
-- Exact policy names below were read directly from live pg_policies, not
-- reconstructed from the original migration files — two of them
-- (employee_instructions' and research_approvals' old SELECT/INSERT
-- names) turned out to be silently truncated by Postgres at 63 bytes, so
-- `drop policy` has to use the truncated form that's actually stored.

drop policy "ai_usage_log is readable by any signed-in staff member" on public.ai_usage_log;
drop policy "ai_usage_log is insertable by any signed-in staff member" on public.ai_usage_log;
create policy "ai_usage_log is readable by ADMIN only"
  on public.ai_usage_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
create policy "ai_usage_log is insertable by ADMIN only"
  on public.ai_usage_log for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "brand_config is readable by any signed-in staff member" on public.brand_config;
create policy "brand_config is readable by ADMIN only"
  on public.brand_config for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "compliance_reviews are readable by any signed-in staff member" on public.compliance_reviews;
create policy "compliance_reviews are readable by ADMIN only"
  on public.compliance_reviews for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "content_assets are readable by any signed-in staff member" on public.content_assets;
create policy "content_assets are readable by ADMIN only"
  on public.content_assets for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "content_images are readable by any signed-in staff member" on public.content_images;
drop policy "content_images are insertable by any signed-in staff member" on public.content_images;
create policy "content_images are readable by ADMIN only"
  on public.content_images for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
create policy "content_images are insertable by ADMIN only"
  on public.content_images for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "employee_instructions are readable by any signed-in staff membe" on public.employee_instructions;
create policy "employee_instructions are readable by ADMIN only"
  on public.employee_instructions for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "employee_names are readable by any signed-in staff member" on public.employee_names;
create policy "employee_names are readable by ADMIN only"
  on public.employee_names for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "generation_runs are readable by any signed-in staff member" on public.generation_runs;
drop policy "generation_runs are writable by any signed-in staff member" on public.generation_runs;
create policy "generation_runs are readable by ADMIN only"
  on public.generation_runs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
create policy "generation_runs are writable by ADMIN only"
  on public.generation_runs for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "leo_portraits are readable by any signed-in staff member" on public.leo_portraits;
create policy "leo_portraits are readable by ADMIN only"
  on public.leo_portraits for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "model_routing_config is readable by any signed-in staff member" on public.model_routing_config;
create policy "model_routing_config is readable by ADMIN only"
  on public.model_routing_config for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "research_approvals are readable by any signed-in staff member" on public.research_approvals;
create policy "research_approvals are readable by ADMIN only"
  on public.research_approvals for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "research_packs are readable by any signed-in staff member" on public.research_packs;
create policy "research_packs are readable by ADMIN only"
  on public.research_packs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "research_runs are readable by any signed-in staff member" on public.research_runs;
create policy "research_runs are readable by ADMIN only"
  on public.research_runs for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "research_sources are readable by any signed-in staff member" on public.research_sources;
create policy "research_sources are readable by ADMIN only"
  on public.research_sources for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "search_usage_log is readable by any signed-in staff member" on public.search_usage_log;
drop policy "search_usage_log is insertable by any signed-in staff member" on public.search_usage_log;
create policy "search_usage_log is readable by ADMIN only"
  on public.search_usage_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
create policy "search_usage_log is insertable by ADMIN only"
  on public.search_usage_log for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "activity log is readable by any signed-in staff member" on public.topic_activity_log;
create policy "activity log is readable by ADMIN only"
  on public.topic_activity_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "status events are readable by any signed-in staff member" on public.topic_status_events;
create policy "status events are readable by ADMIN only"
  on public.topic_status_events for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "topics are readable by any signed-in staff member" on public.topics;
drop policy "topics are updatable by any signed-in staff member" on public.topics;
create policy "topics are readable by ADMIN only"
  on public.topics for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
create policy "topics are updatable by ADMIN only"
  on public.topics for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

-- storage.objects — same tightening for the two buckets still in use.
-- publish-screenshots (analyst employee, retired in
-- 0024_remove_analyst_employee.sql) has no bucket left at all, but its two
-- policies were still sitting in storage.objects — dead RLS surface,
-- dropped outright with no replacement.
drop policy "content-images are readable by any signed-in staff member" on storage.objects;
drop policy "content-images are uploadable by any signed-in staff member" on storage.objects;
create policy "content-images are readable by ADMIN only"
  on storage.objects for select to authenticated
  using (bucket_id = 'content-images' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
create policy "content-images are uploadable by ADMIN only"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'content-images' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "leo-portraits are readable by any signed-in staff member" on storage.objects;
create policy "leo-portraits are readable by ADMIN only"
  on storage.objects for select to authenticated
  using (bucket_id = 'leo-portraits' and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

drop policy "publish-screenshots are readable by any signed-in staff member" on storage.objects;
drop policy "publish-screenshots are uploadable by any signed-in staff membe" on storage.objects;
