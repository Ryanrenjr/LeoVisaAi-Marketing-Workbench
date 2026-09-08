-- LeoVisaAi 营销工作台 — model_routing_config 的可复现 bootstrap 默认值
-- Live audit finding: model_routing_config (0006_model_router.sql) has no
-- seed data at all — the currently-operating defaults (13 task types, all
-- read directly from the live table before writing this migration) exist
-- only in this one Supabase project's database, not in the repo. A fresh
-- environment (a new Supabase project, or restoring from a bare schema)
-- would start with an empty table and every task falling back to
-- Development Mode's free-first routing until an ADMIN manually re-picks
-- each one in /admin/ai-models.
--
-- `on conflict (task_type) do nothing` — never `do update` — is the whole
-- point: this is a bootstrap default for an environment that doesn't have
-- one yet, not a forced reset. An ADMIN's own choice, made after this
-- migration runs, must never be silently overwritten by a later re-run or
-- a fresh deploy of this same migration file.
--
-- XIAOHONGSHU_PAGES_PLANNING and XIAOHONGSHU_PAGES_REVISION are not seeded
-- here because the live table genuinely has no configured default for
-- them right now either — they currently fall back to Development Mode,
-- which is the real, working current state, not a gap to paper over with
-- an invented value.
insert into public.model_routing_config (task_type, provider, model_id) values
  ('COMPLIANCE', 'OPENAI', 'gpt-5-mini'),
  ('IMAGE_GENERATION', 'OPENAI', 'gpt-image-2'),
  ('RESEARCH', 'OPENAI', 'gpt-5.6-sol'),
  ('TOPIC_DISCOVERY', 'OPENAI', 'gpt-5.6-terra'),
  ('TOPIC_PLANNING', 'OPENAI', 'gpt-5-mini'),
  ('VIDEO_REVISION', 'OPENAI', 'gpt-5-mini'),
  ('VIDEO_WRITING', 'OPENAI', 'gpt-5-mini'),
  ('WECHAT_ARTICLE_REVISION', 'OPENAI', 'gpt-5-mini'),
  ('WECHAT_ARTICLE_WRITING', 'OPENAI', 'gpt-5-mini'),
  ('WECHAT_FULL_ARTICLE', 'OPENAI', 'gpt-5-mini'),
  ('WECHAT_WRITING', 'OPENAI', 'gpt-5-mini'),
  ('XIAOHONGSHU_REVISION', 'OPENAI', 'gpt-5-mini'),
  ('XIAOHONGSHU_WRITING', 'OPENAI', 'gpt-5-mini')
on conflict (task_type) do nothing;
