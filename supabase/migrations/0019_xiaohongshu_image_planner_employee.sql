-- LeoVisaAi 营销工作台 — Employee K：小红书图文规划员
-- Live user instruction: 小红书需要区分两个员工——一个只负责规划图文每一页
-- 的内容并直接生成配图，另一个只负责写标题和发布文案。Adds the eleventh
-- digital employee ("xiaohongshu-image-planner") — see
-- src/lib/boss-language.ts DIGITAL_EMPLOYEES and
-- src/app/team/xiaohongshu-image-planner/page.tsx. Only the two employee-id
-- allowlists need widening (same pattern as migrations
-- 0016_reviser_employee.sql / 0018_integrator_employee.sql).
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
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'integrator', 'analyst',
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
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'integrator', 'analyst',
    'xiaohongshu-image-planner'
  ));
