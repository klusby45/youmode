-- ─────────────────────────────────────────────────────────────────────────
-- One-time redemption ("your one save").
--
-- Each member gets exactly ONE save per challenge. Spending it on a date
-- lifts that day out of the automatic fail: in a refereed challenge it goes
-- to the referee's queue to decide, and in an honor challenge it becomes
-- "excused" (no fail, streak survives, but it is NOT counted as a day passed).
--
-- One nullable column IS the whole feature: null = unused, a date = spent on
-- that day. The single column can't be double-spent because every write
-- guards on `redemption_date is null`.
--
-- Idempotent — safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

alter table members add column if not exists redemption_date date;

-- Spend the save. Returns the updated member row, or raises if it's already
-- been used. SECURITY DEFINER so the guard can't be bypassed from the client:
-- the "only once" rule lives here, not in the UI.
create or replace function use_redemption(p_member_id uuid, p_date date)
returns members
language plpgsql
security definer
set search_path = public
as $$
declare
  m members;
begin
  select * into m from members where id = p_member_id;
  if not found then
    raise exception 'No such member';
  end if;
  if m.user_id <> auth.uid() then
    raise exception 'You can only use your own save';
  end if;
  if m.redemption_date is not null then
    raise exception 'Your one save has already been used';
  end if;

  update members set redemption_date = p_date
   where id = p_member_id and redemption_date is null
   returning * into m;

  if not found then
    raise exception 'Your one save has already been used';
  end if;

  -- Make sure there is a day_log for that date so a referee has something to
  -- open. Left 'pending' — the referee's verdict (or honor mode) takes it
  -- from there.
  insert into day_logs (challenge_id, user_id, log_date, status)
  values (m.challenge_id, m.user_id, p_date, 'pending')
  on conflict (challenge_id, user_id, log_date) do nothing;

  return m;
end;
$$;

grant execute on function use_redemption(uuid, date) to authenticated;
