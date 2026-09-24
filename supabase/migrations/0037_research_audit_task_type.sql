-- LeoVisaAi 营销工作台 — RESEARCH_AUDIT 独立复核评分任务
-- Live audit finding: 研究优化 (research-optimization.ts) originally let the
-- SAME model call that rewrote a research pack also re-score it — with the
-- previous round's score and reasons sitting right there in its own
-- context. That is not independent scoring; a model asked to "fix a 46"
-- can trivially decide the fix is done and hand back a 75 without the new
-- evidence actually supporting it. RESEARCH_AUDIT is a new, narrow task
-- type used only for the final six-dimension re-score: it is shown the
-- NEW research content and NEW grounded evidence only — never the
-- previous score_total, previous score_breakdown, or previous reasons —
-- see runResearchOptimizationTask's second (audit) model call in router.ts.
--
-- Default provider deliberately differs from RESEARCH's own default
-- (OPENAI gpt-5.6-sol, see 0034) — same "reduce same-model blind spots"
-- reasoning 0034 already established for COMPLIANCE (authored on OpenAI,
-- reviewed by Anthropic). This is a default, not an enforced constraint —
-- an ADMIN can still point both at the same model if they choose to.
insert into public.model_routing_config (task_type, provider, model_id) values
  ('RESEARCH_AUDIT', 'ANTHROPIC', 'claude-sonnet-5')
on conflict (task_type) do update
  set provider = excluded.provider, model_id = excluded.model_id;
