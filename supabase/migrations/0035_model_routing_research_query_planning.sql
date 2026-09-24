-- LeoVisaAi 营销工作台 — 新增 RESEARCH_QUERY_PLANNING 的正式生产默认值
-- Round 4C: a new, narrow AI call (RESEARCH_QUERY_PLANNING) sits between
-- Search and the formal RESEARCH analysis call — it only rewrites the
-- topic into English retrieval queries, never researches or answers
-- anything. This task type did not exist before this round, so there is
-- no existing row to preserve; `do update` (matching 0034's pattern for
-- an intentional, explicit production default) is used for idempotency
-- if this migration is ever re-applied, not because a prior value needs
-- overwriting.
--
-- Not applied to the live database this round — see the Round 4C report.
insert into public.model_routing_config (task_type, provider, model_id) values
  ('RESEARCH_QUERY_PLANNING', 'OPENAI', 'gpt-5.6-terra')
on conflict (task_type) do update
  set provider = excluded.provider, model_id = excluded.model_id;
