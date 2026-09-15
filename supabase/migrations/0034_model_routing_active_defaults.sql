-- LeoVisaAi 营销工作台 — 生产路由更新为 Round 2 确认的 ACTIVE 默认值
-- Unlike 0032 (a one-time bootstrap default using `on conflict do
-- nothing`), this migration is an EXPLICIT, INTENTIONAL change to
-- already-configured production values — confirmed against official
-- provider docs (OpenAI GPT-5.6 family, Anthropic Claude Sonnet 5) before
-- writing this file, not guessed from repo comments. `do update`, not `do
-- nothing`, is the whole point here.
--
-- What changes for existing rows: every gpt-5-mini content/revision task
-- moves to gpt-5.6-terra; COMPLIANCE moves from gpt-5-mini (OPENAI) to
-- claude-sonnet-5 (ANTHROPIC) — cross-model independent review, content
-- is authored on OpenAI, reviewed by a different provider (Anthropic) to
-- reduce same-model blind spots, not because one model "understands UK
-- law better." RESEARCH/TOPIC_DISCOVERY/IMAGE_GENERATION are included for
-- explicitness even though their values are unchanged (gpt-5.6-sol /
-- gpt-5.6-terra / gpt-image-2 already).
--
-- What's new: XIAOHONGSHU_PAGES_PLANNING and XIAOHONGSHU_PAGES_REVISION
-- (小红书图文规划员 K) had no configured default at all until now — they
-- fell back to Development Mode. This migration gives them an explicit
-- production default (gpt-5.6-terra) for the first time.
--
-- Deliberately absent (left exactly as-is, not touched by this
-- migration): TOPIC_PLANNING (no formal caller yet), WECHAT_WRITING and
-- WECHAT_FULL_ARTICLE (legacy pre-XIAOHONGSHU_PAGES_PLANNING task types,
-- not part of the current live pipeline).
insert into public.model_routing_config (task_type, provider, model_id) values
  ('TOPIC_DISCOVERY', 'OPENAI', 'gpt-5.6-terra'),
  ('RESEARCH', 'OPENAI', 'gpt-5.6-sol'),
  ('VIDEO_WRITING', 'OPENAI', 'gpt-5.6-terra'),
  ('XIAOHONGSHU_WRITING', 'OPENAI', 'gpt-5.6-terra'),
  ('XIAOHONGSHU_PAGES_PLANNING', 'OPENAI', 'gpt-5.6-terra'),
  ('WECHAT_ARTICLE_WRITING', 'OPENAI', 'gpt-5.6-terra'),
  ('COMPLIANCE', 'ANTHROPIC', 'claude-sonnet-5'),
  ('VIDEO_REVISION', 'OPENAI', 'gpt-5.6-terra'),
  ('XIAOHONGSHU_REVISION', 'OPENAI', 'gpt-5.6-terra'),
  ('XIAOHONGSHU_PAGES_REVISION', 'OPENAI', 'gpt-5.6-terra'),
  ('WECHAT_ARTICLE_REVISION', 'OPENAI', 'gpt-5.6-terra'),
  ('IMAGE_GENERATION', 'OPENAI', 'gpt-image-2')
on conflict (task_type) do update
  set provider = excluded.provider, model_id = excluded.model_id;
