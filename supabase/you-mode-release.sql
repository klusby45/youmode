-- ════════════════════════════════════════════════════════════════════════
-- YOU MODE release — paste this whole file once in the Supabase SQL editor.
-- Idempotent: safe to re-run. Safe to run BEFORE the app deploy (the live
-- app selects * and ignores new columns; the new join_challenge and RLS are
-- backward-compatible).
-- ════════════════════════════════════════════════════════════════════════

-- 1) profiles: colorway (pending from the theme release), voice, photo privacy
alter table profiles add column if not exists theme text;
alter table profiles add column if not exists tone text;           -- 'monk'|'coach'|'hardcore'; app treats null as 'hardcore'
alter table profiles add column if not exists photo_sharing text;  -- 'all'|'icons'; app treats null as 'icons'
update profiles set tone = 'hardcore' where tone is null;          -- existing users keep today's voice
update profiles set photo_sharing = 'all'                          -- grandfather Kyle & Dylen: photos stay mutual
  where username in ('kyle','dylen') and photo_sharing is distinct from 'all';

-- 2) requirements: per-item privacy override (others see icon + caption only)
alter table requirements add column if not exists is_private boolean not null default false;

-- 3) challenges: format ('solo'|'versus'|'accountability'|'community'; app derives when null)
alter table challenges add column if not exists format text;
update challenges set format = 'versus' where join_code = 'MOHAWK' and format is null;

-- 4) join_challenge: cap by format (community 12, others 4); accent colors
--    wrap past 4 members; checklist clone now carries multi/min_minutes/optional
--    (previously dropped for joiners); is_private deliberately NOT copied —
--    privacy is personal.
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
    insert into requirements (challenge_id, user_id, key, label, hint, group_label, icon, kind, sort, multi, min_minutes, optional)
    select challenge_id, auth.uid(), key, label, hint, group_label, icon, kind, sort, multi, min_minutes, optional
    from requirements where challenge_id = c.id and user_id = c.owner_id
    on conflict do nothing;
  end if;
  return c.id;
end $$;

-- 5) close the privacy hole: body plans + weigh-ins were readable by EVERY
--    authenticated user; now self-or-challenge-mate only. (Netlify functions
--    use the service key and bypass RLS — unaffected.)
drop policy if exists "read plans" on body_plans;
create policy "read plans" on body_plans for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from members m1 join members m2 on m1.challenge_id = m2.challenge_id
    where m1.user_id = auth.uid() and m2.user_id = body_plans.user_id));

drop policy if exists "read weighins" on weigh_ins;
create policy "read weighins" on weigh_ins for select to authenticated
  using (user_id = auth.uid() or exists (
    select 1 from members m1 join members m2 on m1.challenge_id = m2.challenge_id
    where m1.user_id = auth.uid() and m2.user_id = weigh_ins.user_id));
