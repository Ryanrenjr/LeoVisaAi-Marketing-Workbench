-- LeoVisaAi 营销工作台 — 去掉有列级越权风险的 profiles 自更新策略
-- Live audit finding (P0): "users can update their own display name"
-- (0001_init.sql) is gated by `using (auth.uid() = id)`, which restricts
-- WHICH ROW can be updated, not WHICH COLUMN — Postgres RLS is row-level,
-- not column-level, so any authenticated user with UPDATE privilege on
-- profiles could, in a multi-account model, have used this policy to
-- change their own `role` column, not just display_name. Now that the
-- app has exactly one fixed operator account (already ADMIN, already
-- covered by "admins can update any profile"), this policy has no
-- remaining legitimate use — dropping it removes the risk outright rather
-- than trying to rewrite it as column-scoped.

drop policy if exists "users can update their own display name" on public.profiles;
