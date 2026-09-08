-- LeoVisaAi 营销工作台 — 共享密码登录限流的原子化
-- Live audit finding (P0): login()'s rate limiting was
-- "SELECT fail_count -> JS +1 -> UPSERT", a classic lost-update race —
-- concurrent wrong-password requests for the same IP could read the same
-- fail_count and each write back count+1, losing attempts instead of
-- accumulating them. Worse, none of the SELECT/UPSERT/DELETE calls checked
-- their own error, so a transient DB failure made `attempt` come back
-- `undefined` and got silently treated as "no failure record" — fail-open
-- on a security control.
--
-- record_login_attempt() does the whole "check lock, then record this
-- attempt" sequence as one function call: `select ... for update` locks
-- this IP's row for the duration of the call, so concurrent requests for
-- the same IP serialize instead of racing a lost update. A lockout is
-- never bypassable by finally guessing the right password before it
-- expires — checked before p_success is even consulted. No `security
-- definer` — called via the same service-role admin client
-- (createAdminClient()) login() already uses for this table, which
-- bypasses RLS on its own; this function runs with that same privilege,
-- nothing new needed.
create function public.record_login_attempt(
  p_ip text,
  p_success boolean,
  p_max_attempts int default 5,
  p_lockout_seconds int default 900
) returns table (
  locked boolean,
  locked_until timestamptz,
  fail_count int
)
language plpgsql
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_row public.login_attempts%rowtype;
  v_new_count int;
  v_new_locked_until timestamptz;
begin
  insert into public.login_attempts (ip, fail_count, locked_until, updated_at)
  values (p_ip, 0, null, v_now)
  on conflict (ip) do nothing;

  select * into v_row from public.login_attempts where ip = p_ip for update;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    -- Currently locked — refuse regardless of whether this attempt's
    -- password was actually correct, and don't re-increment (a locked-out
    -- IP retrying shouldn't keep pushing the lock further into the
    -- future). A lockout must not be bypassable by finally guessing right
    -- before it expires.
    return query select true, v_row.locked_until, v_row.fail_count;
    return;
  end if;

  if p_success then
    delete from public.login_attempts where ip = p_ip;
    return query select false, null::timestamptz, 0;
    return;
  end if;

  v_new_count := v_row.fail_count + 1;
  v_new_locked_until := case when v_new_count >= p_max_attempts then v_now + make_interval(secs => p_lockout_seconds) else null end;
  update public.login_attempts
    set fail_count = v_new_count, locked_until = v_new_locked_until, updated_at = v_now
    where ip = p_ip;

  return query select (v_new_locked_until is not null), v_new_locked_until, v_new_count;
end;
$$;
