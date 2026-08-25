-- LeoVisaAi 营销工作台 — Employee I：内容整合员
-- Live user instruction: 每个平台的文字和配图分别由不同员工在不同页面完成，
-- Leo 最终确认前需要一个地方能一次性看到"这个平台真正要发布的东西长什么样"
-- ——文字和配图放在一起。Adds a tenth digital employee ("integrator") whose
-- job is exactly that — see src/lib/boss-language.ts DIGITAL_EMPLOYEES and
-- src/app/team/integrator/page.tsx. Purely a read-only assembly view: no
-- new tables, no AI task, no new content — it only reads content_assets/
-- content_images that already exist. Only the two employee-id allowlists
-- need widening (same pattern as migration 0016_reviser_employee.sql).
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
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'integrator', 'analyst'
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
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'integrator', 'analyst'
  ));
