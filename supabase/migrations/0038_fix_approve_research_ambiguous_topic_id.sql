-- The function returns a column named topic_id, so the unqualified
-- research_packs predicate was ambiguous inside PL/pgSQL and every approval
-- failed before inserting an approval or advancing the topic.
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
  select topics.status into v_status from public.topics where topics.id = p_topic_id for update;
  if v_status is null then
    raise exception 'topic % not found', p_topic_id;
  end if;
  if v_status <> 'RESEARCH_READY' then
    raise exception 'topic % is not RESEARCH_READY (current status: %)', p_topic_id, v_status;
  end if;

  select research_packs.topic_id, research_packs.score_total
    into v_pack_topic_id, v_pack_score_total
    from public.research_packs where research_packs.id = p_research_pack_id;
  if v_pack_topic_id is null or v_pack_topic_id <> p_topic_id then
    raise exception 'research pack % does not belong to topic %', p_research_pack_id, p_topic_id;
  end if;

  select research_packs.id into v_latest_pack_id
    from public.research_packs
    where research_packs.topic_id = p_topic_id
    order by research_packs.created_at desc
    limit 1;
  if v_latest_pack_id <> p_research_pack_id then
    raise exception '当前研究结果已经有更新，请刷新后审核最新版本。';
  end if;

  if v_pack_score_total < 80 then
    raise exception 'research pack % scores % / 100, below the 80-point approval threshold', p_research_pack_id, v_pack_score_total;
  end if;

  insert into public.research_approvals (topic_id, research_pack_id, decision, decided_by)
  values (p_topic_id, p_research_pack_id, 'approved', p_decided_by);

  update public.topics
    set status = 'RESEARCH_APPROVED'
    where topics.id = p_topic_id and topics.status = 'RESEARCH_READY';
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'failed to advance topic % status (expected exactly one row updated, got %)', p_topic_id, v_rows;
  end if;

  insert into public.topic_status_events (topic_id, from_status, to_status, approved_by)
  values (p_topic_id, 'RESEARCH_READY', 'RESEARCH_APPROVED', p_decided_by);

  return query select p_topic_id;
end;
$$;
