-- LeoVisaAi 营销工作台 — 研究优化 + 研究质量分数硬性 Gate
--
-- Live audit finding: B｜政策研究员 Skill (docs/digital-employee-skills.md
-- "11. 总分对应结果") has always defined 90-100 = APPROVED, 80-89 = APPROVED
-- WITH CAUTION, 70-79 = RESEARCH MORE, <70 = REJECT — but approve_research()
-- (0029/0033) never actually checked score_total before advancing a topic
-- to RESEARCH_APPROVED. A 46/100 research pack could be (and was) approved
-- exactly the same as a 95/100 one. This closes that gap at the one place
-- every approval path (approveResearchOnly, called from both the dedicated
-- review page and the full topic detail page) ultimately goes through, so
-- a client-side bypass can't skip it — the UI-level gate in
-- research-actions.ts is a fast-fail convenience, not the real boundary.
--
-- Also adds the minimal schema needed for "研究优化" (B's second-stage
-- mode — targeted follow-up research aimed at a low score's actual gaps,
-- see src/lib/ai/research-optimization.ts): research_runs/research_packs
-- already naturally support multiple rows per topic with "the latest one
-- wins" (getLatestResearchPack orders by created_at) — no new tables
-- needed. Just two columns and five new activity types.

alter type public.topic_activity_type add value 'research_optimization_started';
alter type public.topic_activity_type add value 'research_optimization_completed';
alter type public.topic_activity_type add value 'research_optimization_failed';
alter type public.topic_activity_type add value 'research_topic_revision_suggested';
alter type public.topic_activity_type add value 'research_topic_revision_accepted';

-- "initial" = a normal (first, or from-scratch re-run) research pass;
-- "optimization" = a research-optimization pass, including the re-research
-- triggered by accepting a suggested topic revision. Purely descriptive —
-- every run still produces its own fully independent pack and score, never
-- treated differently by any gate.
alter table public.research_runs
  add column run_type text not null default 'initial';

alter table public.research_runs
  add constraint research_runs_run_type_check check (run_type in ('initial', 'optimization'));

-- Non-null only when a research-optimization pass concluded the topic's
-- own title/question states something more certain than the evidence
-- supports (RESULT 2 in docs/ai-workflows.md "研究优化") — a suggestion a
-- human must explicitly accept (acceptSuggestedTopicRevision in
-- research-actions.ts), never applied automatically.
alter table public.research_packs
  add column suggested_topic_revision jsonb;

-- Two real Gates, both enforced inside the same atomic transaction that
-- already locks the topic row and verifies the pack belongs to it — not a
-- separate check that a race, a stale browser tab, or a direct RPC call
-- bypassing the UI could slip past:
--
-- 1. research_packs.score_total >= 80 is required to approve.
-- 2. p_research_pack_id must be the topic's CURRENT latest pack. A topic
--    can accumulate several packs over time (initial + N optimization
--    passes, see run_type above) — a stale browser tab holding an old,
--    already-superseded pack id (e.g. one that scored 85 before a later
--    optimization pass re-scored it at 72) must not be able to approve
--    that old id after the fact. Live audit finding: nothing previously
--    checked this at all.
--
-- Everything else in the function (already correctly qualified/
-- parameterized since 0033) is unchanged.
create or replace function public.approve_research(
  p_topic_id uuid,
  p_research_pack_id uuid,
  p_decided_by uuid
) returns table (topic_id uuid)
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_pack_topic_id uuid;
  v_pack_score_total integer;
  v_latest_pack_id uuid;
  v_rows int;
begin
  select status into v_status from public.topics where id = p_topic_id for update;
  if v_status is null then
    raise exception 'topic % not found', p_topic_id;
  end if;
  if v_status <> 'RESEARCH_READY' then
    raise exception 'topic % is not RESEARCH_READY (current status: %)', p_topic_id, v_status;
  end if;

  select research_packs.topic_id, research_packs.score_total
    into v_pack_topic_id, v_pack_score_total
    from public.research_packs where id = p_research_pack_id;
  if v_pack_topic_id is null or v_pack_topic_id <> p_topic_id then
    raise exception 'research pack % does not belong to topic %', p_research_pack_id, p_topic_id;
  end if;

  select id into v_latest_pack_id
    from public.research_packs
    where topic_id = p_topic_id
    order by created_at desc
    limit 1;
  if v_latest_pack_id <> p_research_pack_id then
    raise exception '当前研究结果已经有更新，请刷新后审核最新版本。';
  end if;

  if v_pack_score_total < 80 then
    raise exception 'research pack % scores % / 100, below the 80-point approval threshold — optimize the research or revise the topic before approving', p_research_pack_id, v_pack_score_total;
  end if;

  insert into public.research_approvals (topic_id, research_pack_id, decision, decided_by)
  values (p_topic_id, p_research_pack_id, 'approved', p_decided_by);

  update public.topics
    set status = 'RESEARCH_APPROVED'
    where id = p_topic_id and status = 'RESEARCH_READY';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'failed to advance topic % status (expected exactly one row updated, got %)', p_topic_id, v_rows;
  end if;

  insert into public.topic_status_events (topic_id, from_status, to_status, approved_by)
  values (p_topic_id, 'RESEARCH_READY', 'RESEARCH_APPROVED', p_decided_by);

  return query select p_topic_id;
end;
$$;
