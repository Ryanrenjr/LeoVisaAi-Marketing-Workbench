-- LeoVisaAi 营销工作台 — 研究批准原子化
-- Live audit finding (P0): approveResearchOnly() inserted research_approvals,
-- then updated topics.status without checking the error or the affected row
-- count, then unconditionally inserted a topic_status_events row and
-- returned true. A concurrent status change (or any transient DB error on
-- just that one statement) meant the update could silently match zero rows
-- while the function still recorded a status-change event and told its
-- caller (approveAndGoHome) that approval succeeded — which then redirects
-- straight into content generation for a topic that was never actually
-- marked RESEARCH_APPROVED.
--
-- approve_research() does the whole sequence as one atomic unit: lock the
-- topic row, assert its status, verify the research pack actually belongs
-- to it, insert the approval, advance the status (confirming exactly one
-- row changed), record the status event. Any failure raises an exception,
-- which aborts the whole transaction — nothing partial is ever left behind.
--
-- No `security definer` — same posture as claim_generation_run_task()
-- (0028_generation_run_tasks.sql): this runs as the calling EXPERT/ADMIN
-- operator, subject to the existing RLS on topics/research_packs/
-- research_approvals/topic_status_events. Those are the exact same
-- operations the previous sequential code was already permitted to do —
-- wrapping them in one function doesn't need any new grant or policy.
create function public.approve_research(
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
  v_rows int;
begin
  select status into v_status from public.topics where id = p_topic_id for update;
  if v_status is null then
    raise exception 'topic % not found', p_topic_id;
  end if;
  if v_status <> 'RESEARCH_READY' then
    raise exception 'topic % is not RESEARCH_READY (current status: %)', p_topic_id, v_status;
  end if;

  select topic_id into v_pack_topic_id from public.research_packs where id = p_research_pack_id;
  if v_pack_topic_id is null or v_pack_topic_id <> p_topic_id then
    raise exception 'research pack % does not belong to topic %', p_research_pack_id, p_topic_id;
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
