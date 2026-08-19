-- Demo pipeline data for local/dev use only. Contains no real client
-- information — see docs/security-boundaries.md. All topics below are
-- synthetic examples of the kind of question LeoVisa content answers, not
-- real client cases.

-- Topic Library seed rows (status IDEA / RESEARCHING).
insert into public.topics (title, question, business, audience, content_pillar, priority, status) values
  (
    '老永居离境超过2年，身份还在吗？',
    '老永居离境超过2年，身份还在吗？',
    '永居 / ILR',
    '持老式永居（ILR）并长期离境的申请人',
    'myth_busting',
    'HIGH',
    'IDEA'
  ),
  (
    '工签被裁员后还有多少时间？',
    '工签被裁员后还有多少时间？',
    '工作签证 / Skilled Worker',
    '被担保雇主裁员的工签持有人',
    'how_to',
    'HIGH',
    'IDEA'
  ),
  (
    '英国出生的小孩自动是英国籍吗？',
    '英国出生的小孩自动是英国籍吗？',
    '国籍 / British Citizenship',
    '在英生育或计划生育的父母',
    'myth_busting',
    'MEDIUM',
    'IDEA'
  ),
  (
    '老永居换eVisa前，先查这3件事',
    '老永居换eVisa前，先查这3件事',
    'eVisa',
    '持老式永居、尚未换领 eVisa 的申请人',
    'how_to',
    'HIGH',
    'RESEARCH_READY'
  ),
  (
    '10年永居中间断过一次怎么办？',
    '10年永居中间断过一次怎么办？',
    '永居 / Long Residence',
    '走10年长期居留路径、有离境记录的申请人',
    'myth_busting',
    'MEDIUM',
    'RESEARCH_READY'
  ),
  (
    'Sponsor Licence真正容易出问题的环节',
    'Sponsor Licence真正容易出问题的环节',
    '担保牌照 / Sponsor Licence',
    '持有或申请担保牌照的雇主',
    'case_study',
    'MEDIUM',
    'IDEA'
  );

-- Recompute topic_score for the seeded rows using the same weights as
-- src/lib/scoring.ts, so demo data reflects a realistic score.
update public.topics set
  topic_score = case priority when 'HIGH' then 60 when 'MEDIUM' then 35 else 15 end
    + (case when trim(business) <> '' then 10 else 0 end)
    + (case when trim(audience) <> '' then 10 else 0 end)
    + (case when content_pillar is not null then 10 else 0 end)
    + (case when trim(question) <> '' then 10 else 0 end),
  score_breakdown = jsonb_build_object(
    'priority', case priority when 'HIGH' then 60 when 'MEDIUM' then 35 else 15 end,
    'completeness',
      (case when trim(business) <> '' then 10 else 0 end)
      + (case when trim(audience) <> '' then 10 else 0 end)
      + (case when content_pillar is not null then 10 else 0 end)
      + (case when trim(question) <> '' then 10 else 0 end)
  )
where status in ('IDEA', 'RESEARCHING', 'RESEARCH_READY');

-- Existing Phase 1/2 pipeline demo rows (research approved / ready to shoot / published).
insert into public.topics (title, question, status, published_at) values
  ('打工度假签证误区盘点', '打工度假签证有哪些常见误区？', 'RESEARCH_APPROVED', null),
  ('雇主担保签证经验分享', '雇主担保签证申请流程是怎样的？', 'RESEARCH_APPROVED', null),
  ('雇主担保签证案例解读', '雇主担保签证成功案例有哪些经验？', 'READY_TO_SHOOT', null),
  ('技术移民打分变化解读', '本季度技术移民打分政策有什么变化？', 'PUBLISHED', now() - interval '2 days'),
  ('留学转技术移民路径图', '留学生转技术移民有哪些常见路径？', 'PUBLISHED', now() - interval '10 days');

-- Demo research pack for one RESEARCHING topic, so the Research Pack UI
-- has something to look at before a real ANTHROPIC_API_KEY is connected.
-- These "sources" are placeholder text, not real URLs — do not treat them
-- as verified. A real run replaces this with actually-searched sources.
with run as (
  insert into public.research_runs (topic_id, status, model_alias, started_at, completed_at)
  select id, 'completed', 'claude-opus-5', now() - interval '1 hour', now() - interval '58 minutes'
  from public.topics
  where title = '老永居换eVisa前，先查这3件事'
  returning id, topic_id
),
pack as (
  insert into public.research_packs (research_run_id, topic_id, summary, key_findings, warnings, confidence)
  select
    run.id,
    run.topic_id,
    '（示例）英国内政部已逐步以 eVisa 取代实体/生物识别居留卡（BRP），老永居持有人需在规定时间内完成账号关联，否则可能影响出行与身份核验。',
    '["示例发现：官方过渡时间表分阶段推进，不同证件类型的截止日期不同", "示例发现：账号关联需要护照或旅行证件信息，若证件已过期需先更新", "示例发现：出行前建议保留旧证件与 eVisa 关联凭证的双重证明"]'::jsonb,
    '（示例）以下来源与摘要为占位演示数据，非真实网络搜索结果；请在正式使用前通过“运行研究”生成真实来源。',
    'MEDIUM'
  from run
  returning id
)
insert into public.research_sources (research_pack_id, title, url, note, page_age)
select pack.id, v.title, v.url, v.note, v.page_age
from pack, (values
  ('示例来源：GOV.UK — eVisa 说明（占位）', 'https://www.gov.uk/example-evisa', '示例摘要：官方 eVisa 概览与过渡时间表（占位内容，非真实抓取）。', '3 个月前更新（占位）'),
  ('示例来源：UKVI 账号关联指引（占位）', 'https://www.gov.uk/example-evisa-account', '示例摘要：如何将旧证件关联到 UKVI 账号（占位内容，非真实抓取）。', null)
) as v(title, url, note, page_age);

-- A second demo pack showing the LOW-confidence / thin-sources case, so
-- Leo can preview that styling too without a real run producing one.
with run2 as (
  insert into public.research_runs (topic_id, status, model_alias, started_at, completed_at)
  select id, 'completed', 'claude-opus-5', now() - interval '2 hours', now() - interval '119 minutes'
  from public.topics
  where title = '10年永居中间断过一次怎么办？'
  returning id, topic_id
)
insert into public.research_packs (research_run_id, topic_id, summary, key_findings, warnings, confidence)
select
  run2.id,
  run2.topic_id,
  '（示例）关于10年长期居留期间中断一次的具体宽限规则，公开来源信息较少且表述不一致，建议人工进一步核实官方最新指引后再决定是否采用。',
  '["示例发现：不同来源对“单次中断的可接受时长”表述不一致，需以官方指引为准"]'::jsonb,
  '（示例）本次演示数据模拟“来源薄弱、置信度低”的情况，用于预览低置信度提示样式，非真实搜索结果。',
  'LOW'
from run2;
