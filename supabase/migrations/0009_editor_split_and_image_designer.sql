-- LeoVisaAi 营销工作台 — Editor Split + Image Designer
-- Live, explicit user instruction: the single "内容编辑" (editor) digital
-- employee is split into three platform-specific employees (video-editor /
-- xiaohongshu-editor / wechat-editor), and a new image-designer employee is
-- added that generates real Xiaohongshu cover images (OpenAI gpt-image-1).
-- See src/lib/boss-language.ts DIGITAL_EMPLOYEES for the full roster.

-- 1. employee_names — widen the allowed employee_id set ---------------------
-- A single custom name for the old "editor" can't correctly apply to three
-- distinct new roles, so any existing row for it is dropped rather than
-- guessed at; each new employee falls back to its default name in
-- boss-language.ts until an ADMIN sets a new one.
delete from public.employee_names where employee_id = 'editor';

alter table public.employee_names drop constraint employee_names_employee_id_check;
alter table public.employee_names add constraint employee_names_employee_id_check
  check (employee_id in (
    'planner', 'researcher', 'video-editor', 'xiaohongshu-editor',
    'image-designer', 'wechat-editor', 'compliance', 'analyst'
  ));

-- 2. Generated Xiaohongshu cover images --------------------------------------
-- One row per generated image. content_asset_id points at the specific
-- xiaohongshu_post draft the image was generated from — `on delete set
-- null` (not cascade) because content_assets versions are never deleted in
-- normal operation, but an image should still survive even if that ever
-- changes; topic_id is the real cascade anchor, same as every other
-- topic-scoped table.
create table public.content_images (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  content_asset_id uuid references public.content_assets (id) on delete set null,
  prompt text not null,
  image_path text not null,
  model_alias text,
  provider text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);

create index content_images_topic_id_idx on public.content_images (topic_id);
create index content_images_content_asset_id_idx on public.content_images (content_asset_id);

alter table public.content_images enable row level security;

create policy "content_images are readable by any signed-in staff member"
  on public.content_images for select to authenticated using (true);

create policy "content_images are insertable by any signed-in staff member"
  on public.content_images for insert to authenticated with check (true);

-- Private bucket — generated images are staff-only until Leo actually
-- publishes one, same posture as publish-screenshots.
insert into storage.buckets (id, name, public)
values ('content-images', 'content-images', false)
on conflict (id) do nothing;

create policy "content-images are readable by any signed-in staff member"
  on storage.objects for select to authenticated
  using (bucket_id = 'content-images');

create policy "content-images are uploadable by any signed-in staff member"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'content-images');
