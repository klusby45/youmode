-- Re-paste join_challenge so a participant who JOINS via invite code inherits
-- the owner's weekly cadence too. Without frequency/times_per_week in the clone,
-- a joined "soccer 2x/week" becomes a DAILY item and fails the joiner 5 of 7
-- days. Idempotent (create or replace). Safe to run anytime after the
-- requirements.frequency / times_per_week columns exist.

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
    insert into requirements (challenge_id, user_id, key, label, hint, group_label, icon, kind, sort, multi, min_minutes, optional, frequency, times_per_week)
    select challenge_id, auth.uid(), key, label, hint, group_label, icon, kind, sort, multi, min_minutes, optional, frequency, times_per_week
    from requirements where challenge_id = c.id and user_id = c.owner_id
    on conflict do nothing;
  end if;
  return c.id;
end $$;
