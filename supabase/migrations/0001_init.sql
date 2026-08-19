-- LeoVisaAi 营销工作台 — Phase 1 schema
-- See docs/data-model.md and docs/security-boundaries.md before changing this file.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Roles
-- ---------------------------------------------------------------------

create type public.user_role as enum ('ADMIN', 'EXPERT');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text not null,
  role public.user_role not null default 'EXPERT',
  created_at timestamptz not null default now()
);

-- Every new Supabase Auth user automatically gets a profile row, defaulted
-- to EXPERT. Promoting the first ADMIN is a manual step — see
-- docs/phase-1-plan.md "First-run setup".
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    'EXPERT'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Pipeline
-- ---------------------------------------------------------------------

create type public.topic_status as enum (
  'draft',
  'research_completed',
  'ready_to_shoot',
  'published'
);

create table public.topics (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  brief text not null default '',
  status public.topic_status not null default 'draft',
  created_by uuid references public.profiles (id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger topics_set_updated_at
before update on public.topics
for each row execute function public.set_updated_at();

-- Append-only audit trail. This table IS the mandatory human-approval-gate
-- record — see docs/security-boundaries.md "Human approval gates". No
-- application code may flip topics.status without also inserting a row
-- here in the same action.
create table public.topic_status_events (
  id uuid primary key default gen_random_uuid(),
  topic_id uuid not null references public.topics (id) on delete cascade,
  from_status public.topic_status,
  to_status public.topic_status not null,
  approved_by uuid not null references public.profiles (id),
  note text,
  created_at timestamptz not null default now()
);

create index topics_status_idx on public.topics (status);
create index topic_status_events_topic_id_idx on public.topic_status_events (topic_id);

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.topics enable row level security;
alter table public.topic_status_events enable row level security;

-- profiles ---------------------------------------------------------------

create policy "profiles are readable by any signed-in staff member"
  on public.profiles for select
  to authenticated
  using (true);

create policy "admins can update any profile"
  on public.profiles for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role = 'ADMIN'
    )
  );

create policy "users can update their own display name"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- topics -------------------------------------------------------------------

create policy "topics are readable by any signed-in staff member"
  on public.topics for select
  to authenticated
  using (true);

create policy "topics are insertable by any signed-in staff member"
  on public.topics for insert
  to authenticated
  with check (created_by = auth.uid());

create policy "topics are updatable by any signed-in staff member"
  on public.topics for update
  to authenticated
  using (true);

-- topic_status_events --------------------------------------------------

create policy "status events are readable by any signed-in staff member"
  on public.topic_status_events for select
  to authenticated
  using (true);

create policy "status events are insertable as self-approval only"
  on public.topic_status_events for insert
  to authenticated
  with check (approved_by = auth.uid());
