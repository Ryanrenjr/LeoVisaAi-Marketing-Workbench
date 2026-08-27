-- LeoVisaAi 营销工作台 — B｜政策研究员六项打分
-- Live user instruction: 政策研究员的研究结果需要展示"从哪几个方面打分、每
-- 一个方面打几分"，明明白白地展示出来。见 docs/digital-employee-skills.md
-- "B｜政策研究员" §10（六项评分：官方来源可靠度/事实准确度/政策状态与时间线/
-- 适用范围与例外/数据与数字可信度/对外表达安全度，共 100 分）。
--
-- 跟 topics.score_breakdown 是完全不同的两个概念——那个是 A 选题策划员在
-- 选题阶段打的"值不值得做"分，这个是 B 政策研究员完成研究后打的"研究质量"
-- 分——所以用同一种存储方式（jsonb 明细 + 整数总分），但是新增独立的列，
-- 不复用 topics 表的列。
alter table public.research_packs
  add column score_total integer not null default 0,
  add column score_breakdown jsonb not null default '{}'::jsonb;

alter table public.research_packs
  add constraint research_packs_score_total_range check (score_total >= 0 and score_total <= 100);
