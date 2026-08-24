-- LeoVisaAi 营销工作台 — Skill Versioning + Brand Configuration
-- Live user instruction: formalise the 8 digital employees' Skills
-- (src/lib/ai/skills.ts — code-level, versioned via git, NOT this
-- migration) plus give the ADMIN-editable "补充说明" layer real version
-- history (never overwrite, always insert — same pattern this app already
-- uses for content_assets/content_images), and a small editable company
-- brand configuration used by the new deterministic brand-validation
-- checks (src/lib/brand-validation.ts).

-- 1. employee_instructions — from "one overwritten row per employee" to
-- an insert-only, versioned table ---------------------------------------
alter table public.employee_instructions rename to employee_instructions_old;

create table public.employee_instructions (
  id uuid primary key default gen_random_uuid(),
  employee_id text not null
    check (employee_id in (
      'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
      'image-designer', 'wechat-editor', 'compliance', 'analyst'
    )),
  version integer not null,
  custom_instructions text not null default '',
  change_note text,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  unique (employee_id, version)
);

-- Preserve any existing custom instructions as each employee's version 1.
insert into public.employee_instructions (employee_id, version, custom_instructions, updated_by, updated_at)
select employee_id, 1, custom_instructions, updated_by, updated_at
from public.employee_instructions_old;

drop table public.employee_instructions_old;

create index employee_instructions_employee_id_version_idx
  on public.employee_instructions (employee_id, version desc);

alter table public.employee_instructions enable row level security;

create policy "employee_instructions are readable by any signed-in staff member"
  on public.employee_instructions for select to authenticated using (true);

-- Insert-only now — no update/delete policy needed, "editing" is always a
-- new version, "restoring" is always a new version with old content.
create policy "employee_instructions are insertable by ADMIN only"
  on public.employee_instructions for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));

-- 2. brand_config — small ADMIN-editable key/value table -------------------
-- No versioning (unlike employee_instructions) — the live user spec only
-- asked for Skill versioning, not brand-config versioning. Code-level
-- defaults live in src/lib/brand-config.ts; a missing key here just means
-- "use the default."
create table public.brand_config (
  key text primary key,
  value text not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);

alter table public.brand_config enable row level security;

create policy "brand_config is readable by any signed-in staff member"
  on public.brand_config for select to authenticated using (true);

create policy "brand_config is writable by ADMIN only"
  on public.brand_config for all to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
