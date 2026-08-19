-- LeoVisaAi 营销工作台 — Content Agent
-- See docs/phase-4-plan.md before changing this file.

alter type public.topic_activity_type add value 'content_generation_started';
alter type public.topic_activity_type add value 'content_generated';
alter type public.topic_activity_type add value 'content_generation_failed';
alter type public.topic_activity_type add value 'content_regenerated';
alter type public.topic_activity_type add value 'content_edited';
alter type public.topic_activity_type add value 'full_article_generated';

create type public.content_platform as enum (
  'VIDEO_CHANNEL',
  'XIAOHONGSHU',
  'WECHAT_OFFICIAL_ACCOUNT'
);

create type public.content_asset_status as enum ('DRAFT', 'APPROVED', 'ARCHIVED');

-- ai_usage_log already exists (0003); Content Agent calls are per-platform,
-- so every content-workflow row records which one. Null for research calls.
alter table public.ai_usage_log add column platform public.content_platform;

-- One row per generated (or edited) draft, per platform, per version.
-- Never overwritten — regenerating or editing always inserts a new row
-- with version = previous max + 1 for the same (topic_id, platform,
-- content_type) lineage. research_pack_id is intentionally `on delete
-- restrict`: a content asset must always be able to point back to the
-- exact research it was generated from.
create table public.content_assets (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  research_pack_id uuid not null references public.research_packs (id) on delete restrict,
  platform public.content_platform not null,
  content_type text not null
    check (content_type in ('video_script', 'xiaohongshu_post', 'wechat_outline', 'wechat_full_article')),
  title text not null default '',
  content text not null default '',
  structured_content jsonb not null default '{}'::jsonb,
  version integer not null default 1,
  status public.content_asset_status not null default 'DRAFT',
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger content_assets_set_updated_at
before update on public.content_assets
for each row execute function public.set_updated_at();

create index content_assets_topic_id_idx on public.content_assets (topic_id);
create index content_assets_lineage_idx on public.content_assets (topic_id, platform, content_type);

alter table public.content_assets enable row level security;

create policy "content_assets are readable by any signed-in staff member"
  on public.content_assets for select to authenticated using (true);

create policy "content_assets are insertable by ADMIN only"
  on public.content_assets for insert to authenticated
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'ADMIN'));
