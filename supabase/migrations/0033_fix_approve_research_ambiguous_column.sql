-- LeoVisaAi 营销工作台 — 修复 approve_research() 的列名歧义 bug
-- Live audit finding (P0, discovered via a real end-to-end browser
-- walkthrough — the first time this function's actual success path was
-- ever exercised through real RLS/PostgREST rather than direct service-
-- role SQL): `approve_research()` (0029_approve_research_rpc.sql) declares
-- `returns table (topic_id uuid)`, which makes PL/pgSQL implicitly create
-- a variable named `topic_id` scoped to the whole function body. The line
--   select topic_id into v_pack_topic_id from public.research_packs ...
-- references the bare column `topic_id` — which research_packs also has —
-- and Postgres cannot tell whether that means the table column or the
-- implicit `topic_id` OUT variable, so every real call raised:
--   ERROR: column reference "topic_id" is ambiguous (SQLSTATE 42702)
-- approveResearchOnly() only checks `if (error) return false;` with no
-- error surfaced to the UI, so "通过，开始生成" has been silently doing
-- nothing (no navigation, no error message, topic stuck at RESEARCH_READY)
-- for every real approval attempt since round 7 — the single most
-- important action in the whole app.
--
-- Fix: qualify the column reference with the table name, which always
-- resolves in favor of the explicit table column over an implicit
-- PL/pgSQL variable. Everything else in the function (already correctly
-- qualified/parameterized) is unchanged.
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
  v_rows int;
begin
  select status into v_status from public.topics where id = p_topic_id for update;
  if v_status is null then
    raise exception 'topic % not found', p_topic_id;
  end if;
  if v_status <> 'RESEARCH_READY' then
    raise exception 'topic % is not RESEARCH_READY (current status: %)', p_topic_id, v_status;
  end if;

  select research_packs.topic_id into v_pack_topic_id from public.research_packs where id = p_research_pack_id;
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
