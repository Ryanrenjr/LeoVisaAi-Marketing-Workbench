-- LeoVisaAi 营销工作台 — 下线 J｜数据分析员
-- Live user instruction: "把数据分析员直接去掉，不要了" — connected data
-- goes too (confirmed via clarifying question: delete the table and the
-- uploaded screenshots, not just the UI). Removes the employee_id from the
-- employee_names/employee_instructions allowlists (same "drop+recreate the
-- check constraint" pattern already used in
-- 0016_reviser_employee.sql / 0018_integrator_employee.sql /
-- 0019_xiaohongshu_image_planner_employee.sql), then drops the
-- publish_performance table and empties+drops its private storage bucket.

delete from public.employee_instructions where employee_id = 'analyst';
delete from public.employee_names where employee_id = 'analyst';

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.employee_names'::regclass and contype = 'c';
  if cname is not null then
    execute format('alter table public.employee_names drop constraint %I', cname);
  end if;
end $$;

alter table public.employee_names add constraint employee_names_employee_id_check
  check (employee_id in (
    'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'integrator',
    'xiaohongshu-image-planner'
  ));

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.employee_instructions'::regclass and contype = 'c';
  if cname is not null then
    execute format('alter table public.employee_instructions drop constraint %I', cname);
  end if;
end $$;

alter table public.employee_instructions add constraint employee_instructions_employee_id_check
  check (employee_id in (
    'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'integrator',
    'xiaohongshu-image-planner'
  ));

delete from public.model_routing_config where task_type = 'PERFORMANCE_ANALYSIS';

drop table if exists public.publish_performance;

-- The 'publish-screenshots' storage bucket is emptied and dropped
-- separately via the Storage API (scripts/run-migrations.mjs runs raw SQL
-- over a direct Postgres connection, but Supabase blocks direct deletion
-- from storage.objects/storage.buckets — "Direct deletion from storage
-- tables is not allowed. Use the Storage API instead.").
