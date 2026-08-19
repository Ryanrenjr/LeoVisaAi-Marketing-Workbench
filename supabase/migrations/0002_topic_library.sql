-- LeoVisaAi 营销工作台 — Topic Library (选题库)
-- Evolves the Phase 1 placeholder `topics` table into the real topic
-- model. See docs/data-model.md and docs/security-boundaries.md before
-- changing this file.

-- ---------------------------------------------------------------------
-- Rename existing status values to the topic-library vocabulary.
-- Phase 1 only ever held demo/seed rows, so this is a free rename.
-- ---------------------------------------------------------------------

alter type public.topic_status rename value 'draft' to 'IDEA';
alter type public.topic_status rename value 'research_completed' to 'RESEARCH_COMPLETED';
alter type public.topic_status rename value 'ready_to_shoot' to 'READY_TO_SHOOT';
alter type public.topic_status rename value 'published' to 'PUBLISHED';

-- New stages used by this milestone. Additional stages (content draft,
-- Leo review, approved) are intentionally NOT added here — nothing in
-- this milestone transitions into them; add them with their own
-- migration when that work is scoped.
alter type public.topic_status add value 'RESEARCHING' after 'IDEA';
alter type public.topic_status add value 'ARCHIVED';

-- ---------------------------------------------------------------------
-- New topic fields
-- ---------------------------------------------------------------------

create type public.content_pillar as enum (
  'policy_update',
  'myth_busting',
  'how_to',
  'case_study',
  'news'
);

create type public.topic_priority as enum ('LOW', 'MEDIUM', 'HIGH');

create sequence public.topic_code_seq;

alter table public.topics
  add column code text
    not null
    default ('T-' || lpad(nextval('public.topic_code_seq')::text, 4, '0')),
  add column question text not null default '',
  add column business text not null default '',
  add column audience text not null default '',
  add column content_pillar public.content_pillar,
  add column priority public.topic_priority not null default 'MEDIUM',
  add column topic_score integer not null default 0,
  add column score_breakdown jsonb not null default '{}'::jsonb,
  drop column brief;

alter table public.topics
  add constraint topics_code_unique unique (code);

alter table public.topics
  add constraint topics_topic_score_range check (topic_score >= 0 and topic_score <= 100);

-- ---------------------------------------------------------------------
-- Activity log — the Topic Detail page's activity history.
-- ---------------------------------------------------------------------

create type public.topic_activity_type as enum (
  'topic_created',
  'topic_edited',
  'topic_scored',
  'score_manually_changed',
  'research_requested',
  'topic_archived'
);

create table public.topic_activity_log (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  activity_type public.topic_activity_type not null,
  actor_id uuid not null references public.profiles (id),
  detail jsonb,
  created_at timestamptz not null default now()
);

create index topic_activity_log_topic_id_idx on public.topic_activity_log (topic_id);

alter table public.topic_activity_log enable row level security;

create policy "activity log is readable by any signed-in staff member"
  on public.topic_activity_log for select
  to authenticated
  using (true);

create policy "activity log is insertable as self-attribution only"
  on public.topic_activity_log for insert
  to authenticated
  with check (actor_id = auth.uid());
