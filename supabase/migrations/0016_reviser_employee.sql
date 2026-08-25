-- LeoVisaAi 营销工作台 — Employee H：终审修改员
-- Live user instruction: after 合规审核员 (G) flags an issue in generated
-- content, someone needs to actually fix it before Leo does his final
-- review. Adds a ninth digital employee ("reviser") whose job is exactly
-- that — see src/lib/boss-language.ts DIGITAL_EMPLOYEES and
-- src/app/topics/revision-actions.ts. No new tables: a revision is just
-- another content_assets version, same versioning system every other
-- draft already uses. Only the two employee-id allowlists need widening.
alter table public.employee_names drop constraint employee_names_employee_id_check;
alter table public.employee_names add constraint employee_names_employee_id_check
  check (employee_id in (
    'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'analyst'
  ));

alter table public.employee_instructions drop constraint employee_instructions_employee_id_check;
alter table public.employee_instructions add constraint employee_instructions_employee_id_check
  check (employee_id in (
    'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
    'image-designer', 'wechat-editor', 'compliance', 'reviser', 'analyst'
  ));
