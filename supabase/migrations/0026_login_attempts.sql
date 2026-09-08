-- LeoVisaAi 营销工作台 — 共享密码登录的失败次数限流
-- Live audit finding (P0): the SITE_PASSWORD check in src/app/login/
-- actions.ts had no rate limiting at all — once the URL is public,
-- someone could try passwords indefinitely. This table is only ever
-- touched via the service-role client (createAdminClient) from login(),
-- never exposed to any client-side code or the anon key — RLS is enabled
-- with no policies at all, so even a misused anon-key query gets nothing.

create table public.login_attempts (
  ip text primary key,
  fail_count int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.login_attempts enable row level security;
