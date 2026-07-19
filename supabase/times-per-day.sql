-- Checklist cadence + photo-source update (Mayssa feedback, 2026-07-17/18).
-- One idempotent paste covers it all:
--   1) requirements.times_per_day  — check items can need N completions/day
--   2) requirements.times_per_month — monthly cadence ("massage 1x a month")
--   3) log_entries.check_count      — per-day progress toward times_per_day
--   4) requirements.capture_only    — photo items: camera-only vs allow
--      uploads. Default (null/false) allows uploads; the original
--      Kyle-vs-Dylen challenge is backfilled to camera-only so the
--      no-cheating-on-Apple-Watch rule stays exactly as it was.
--   5) join_challenge re-paste so joiners inherit all of the above.
-- Paste the whole file once in the steve-crm SQL editor.

alter table requirements add column if not exists times_per_day int;
alter table requirements add column if not exists times_per_month int;
alter table requirements add column if not exists capture_only boolean;
alter table log_entries add column if not exists check_count int;

-- New proof kind: 'timer' — a built-in countdown (min_minutes = the target);
-- finishing the timer checks the item. Requires widening the kind constraint.
alter table requirements drop constraint if exists requirements_kind_check;
alter table requirements add constraint requirements_kind_check check (kind in ('photo','check','timer'));

-- Preserve the MOHAWK anti-cheat: photo proof stays camera-only for the OGs.
update requirements set capture_only = true
where kind = 'photo' and capture_only is null
  and challenge_id in (select id from challenges where join_code = 'MOHAWK');

create or replace function join_challenge(p_code text, p_role text default 'participant')
  returns uuid language plpgsql security definer set search_path = public
as $$
declare c challenges; n_participants int; has_ref boolean; my_accent text; cap int;
begin
  select * into c from challenges where join_code = upper(trim(p_code));
  if c.id is null then raise exception 'No challenge found for that code'; end if;
  if exists (select 1 from members where challenge_id = c.id and user_id = auth.uid()) then
    raise exception 'You are already in this challenge';
  end if;
  if p_role not in ('participant','referee') then raise exception 'Invalid role'; end if;
  select count(*) filter (where role = 'participant'), bool_or(role = 'referee')
    into n_participants, has_ref from members where challenge_id = c.id;
  cap := case when c.format = 'community' then 12 else 4 end;
  if p_role = 'participant' and n_participants >= cap then
    raise exception 'This challenge is full (% participants max)', cap;
  end if;
  if p_role = 'referee' and coalesce(has_ref, false) then
    raise exception 'This challenge already has a referee';
  end if;
  my_accent := (array['#FF3B30','#34C759','#0A84FF','#FF9F0A'])[(n_participants % 4) + 1];
  if p_role = 'referee' then my_accent := '#FFD60A'; end if;
  insert into members (challenge_id, user_id, role, accent) values (c.id, auth.uid(), p_role, my_accent);
  if p_role = 'participant' then
    insert into requirements (challenge_id, user_id, key, label, hint, group_label, icon, kind, sort, multi, min_minutes, optional, frequency, times_per_week, times_per_day, times_per_month, capture_only)
    select challenge_id, auth.uid(), key, label, hint, group_label, icon, kind, sort, multi, min_minutes, optional, frequency, times_per_week, times_per_day, times_per_month, capture_only
    from requirements where challenge_id = c.id and user_id = c.owner_id
    on conflict do nothing;
  end if;
  return c.id;
end $$;
