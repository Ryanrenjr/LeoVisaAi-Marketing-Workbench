-- LeoVisaAi 营销工作台 — Digital Employee Handbook
-- Live user instruction: every digital employee's "job manual" (system
-- prompt) should be viewable and editable by ADMIN at any time, from a
-- dedicated page ("数字员工手册"), not just in source code.
--
-- Design: each employee's prompt has a fixed, code-level CORE (the
-- load-bearing safety rules — evidence boundary, no fabricated sources,
-- no individualized legal advice, no "compliant" verdict, never guess a
-- number off a screenshot, etc.) that this table does NOT let anyone
-- override — those stay hardcoded in src/lib/ai/*.ts, same as before.
-- What this table stores is an ADDENDUM appended after that core, for
-- tone/style/extra-guidance customization. See
-- src/lib/ai/prompt-addendum.ts.
create table public.employee_instructions (
  employee_id text primary key
    check (employee_id in (
      'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
      'image-designer', 'wechat-editor', 'compliance', 'analyst'
    )),
  custom_instructions text not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.employee_instructions enable row level security;

create policy "employee_instructions are readable by any signed-in staff member"
  on public.employee_instructions for select to authenticated using (true);

create policy "employee_instructions are writable by ADMIN only"
  on public.employee_instructions for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
