-- ════════════════════════════════════════════════════════════════════════
-- 75 HARD v2 — self-serve multi-tenant schema + migration of the live
-- Kyle-vs-Dylen challenge. Run this whole file ONCE in the steve-crm SQL
-- editor. It only ADDS tables and COPIES data; the old tables stay untouched
-- so the currently-deployed app keeps working until the new one ships.
--
-- ALSO REQUIRED (dashboard, one toggle):
--   Authentication → Sign In / Providers → Email → turn OFF "Confirm email"
--   (accounts sign up with username-based emails; no confirmation emails)
-- ════════════════════════════════════════════════════════════════════════

-- ── profiles: add self-serve identity fields ─────────────────────────────
alter table profiles add column if not exists username text;
alter table profiles add column if not exists email text;
update profiles set username = lower(display_name) where username is null;
create unique index if not exists profiles_username_idx on profiles (username);

-- ── challenges ────────────────────────────────────────────────────────────
create table if not exists challenges (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  join_code   text not null unique,
  owner_id    uuid not null references profiles(id),
  start_date  date not null,
  timezone    text not null default 'America/Los_Angeles',
  total_days  int  not null default 75,
  created_at  timestamptz not null default now()
);

-- ── members (participant or referee; stakes + optional goal live here) ────
create table if not exists members (
  id                 uuid primary key default gen_random_uuid(),
  challenge_id       uuid not null references challenges(id) on delete cascade,
  user_id            uuid not null references profiles(id) on delete cascade,
  role               text not null default 'participant' check (role in ('participant','referee')),
  stake_text         text,
  stake_image        text,
  accent             text,
  goal_label         text,
  goal_target_count  int,
  goal_count_label   text,
  goal_launched      boolean not null default false,
  goal_launched_at   date,
  goal_current_count int not null default 0,
  joined_at          timestamptz not null default now(),
  unique (challenge_id, user_id)
);

-- ── requirements (per member, per challenge — fully custom checklists) ────
create table if not exists requirements (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  key          text not null,
  label        text not null,
  hint         text,
  group_label  text,
  icon         text,
  kind         text not null check (kind in ('photo','check')),
  sort         int not null default 0,
  unique (challenge_id, user_id, key)
);

-- ── day_logs (one per member per date) + log_entries (one per item) ──────
create table if not exists day_logs (
  id           uuid primary key default gen_random_uuid(),
  challenge_id uuid not null references challenges(id) on delete cascade,
  user_id      uuid not null references profiles(id) on delete cascade,
  log_date     date not null,
  status       day_status not null default 'pending',
  judge_note   text,
  reviewed_by  uuid references profiles(id),
  reviewed_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (challenge_id, user_id, log_date)
);
create index if not exists day_logs_cid_date_idx on day_logs (challenge_id, log_date);

create table if not exists log_entries (
  id             uuid primary key default gen_random_uuid(),
  day_log_id     uuid not null references day_logs(id) on delete cascade,
  requirement_id uuid not null references requirements(id) on delete cascade,
  challenge_id   uuid not null references challenges(id) on delete cascade,
  user_id        uuid not null references profiles(id) on delete cascade,
  photo_path     text,
  checked        boolean not null default false,
  ai_flag        boolean,
  ai_note        text,
  ai_dismissed   boolean not null default false,
  updated_at     timestamptz not null default now(),
  unique (day_log_id, requirement_id)
);
create index if not exists log_entries_cid_idx on log_entries (challenge_id);

-- ── membership helpers ────────────────────────────────────────────────────
create or replace function is_member(cid uuid) returns boolean
  language sql security definer set search_path = public stable
as $$ select exists (select 1 from members where challenge_id = cid and user_id = auth.uid()); $$;

create or replace function is_referee_of(cid uuid) returns boolean
  language sql security definer set search_path = public stable
as $$ select exists (select 1 from members where challenge_id = cid and user_id = auth.uid() and role = 'referee'); $$;

-- ── username → auth email (login with username) ───────────────────────────
create or replace function email_for_username(u text) returns text
  language sql security definer set search_path = public stable
as $$
  select au.email from profiles p join auth.users au on au.id = p.id
  where p.username = lower(trim(u)) limit 1;
$$;

-- ── join a challenge by code (copies the owner's checklist for participants)
create or replace function join_challenge(p_code text, p_role text default 'participant')
  returns uuid language plpgsql security definer set search_path = public
as $$
declare c challenges; n_participants int; has_ref boolean; my_accent text;
begin
  select * into c from challenges where join_code = upper(trim(p_code));
  if c.id is null then raise exception 'No challenge found for that code'; end if;
  if exists (select 1 from members where challenge_id = c.id and user_id = auth.uid()) then
    raise exception 'You are already in this challenge';
  end if;
  if p_role not in ('participant','referee') then raise exception 'Invalid role'; end if;
  select count(*) filter (where role = 'participant'), bool_or(role = 'referee')
    into n_participants, has_ref from members where challenge_id = c.id;
  if p_role = 'participant' and n_participants >= 4 then
    raise exception 'This challenge is full (4 participants max)';
  end if;
  if p_role = 'referee' and coalesce(has_ref, false) then
    raise exception 'This challenge already has a referee';
  end if;
  my_accent := (array['#FF3B30','#34C759','#0A84FF','#FF9F0A'])[least(n_participants + 1, 4)];
  if p_role = 'referee' then my_accent := '#FFD60A'; end if;
  insert into members (challenge_id, user_id, role, accent) values (c.id, auth.uid(), p_role, my_accent);
  if p_role = 'participant' then
    insert into requirements (challenge_id, user_id, key, label, hint, group_label, icon, kind, sort)
    select challenge_id, auth.uid(), key, label, hint, group_label, icon, kind, sort
    from requirements where challenge_id = c.id and user_id = c.owner_id
    on conflict do nothing;
  end if;
  return c.id;
end $$;

-- ── referee verdict (v2) ──────────────────────────────────────────────────
create or replace function review_day2(p_log_id uuid, p_verdict day_status, p_note text default null)
  returns day_logs language plpgsql security definer set search_path = public
as $$
declare r day_logs;
begin
  select * into r from day_logs where id = p_log_id;
  if r.id is null then raise exception 'log not found'; end if;
  if not is_referee_of(r.challenge_id) then raise exception 'only the referee may review days'; end if;
  if p_verdict not in ('approved','rejected') then raise exception 'verdict must be approved or rejected'; end if;
  update day_logs set status = p_verdict, judge_note = p_note,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_log_id returning * into r;
  return r;
end $$;

-- ── guard: participants cannot touch verdict fields on day_logs ───────────
create or replace function guard_day_log_update() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if is_referee_of(new.challenge_id) then return new; end if;
  if new.status is distinct from old.status
     or new.judge_note is distinct from old.judge_note
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'only the referee can set a verdict';
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_guard_day_log on day_logs;
create trigger trg_guard_day_log before update on day_logs
  for each row execute function guard_day_log_update();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table challenges enable row level security;
alter table members enable row level security;
alter table requirements enable row level security;
alter table day_logs enable row level security;
alter table log_entries enable row level security;

-- profiles: replace the "everyone reads everyone" policy with challenge-scoped
drop policy if exists "read profiles" on profiles;
create policy "read own or challenge-mate profiles" on profiles for select to authenticated
  using (id = auth.uid() or exists (
    select 1 from members m1 join members m2 on m1.challenge_id = m2.challenge_id
    where m1.user_id = auth.uid() and m2.user_id = profiles.id));
drop policy if exists "insert own profile" on profiles;
create policy "insert own profile" on profiles for insert to authenticated
  with check (id = auth.uid());

create policy "read my challenges" on challenges for select to authenticated
  using (is_member(id) or owner_id = auth.uid());
create policy "create challenge" on challenges for insert to authenticated
  with check (owner_id = auth.uid());
create policy "owner updates challenge" on challenges for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "read members" on members for select to authenticated using (is_member(challenge_id));
create policy "creator adds self" on members for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from challenges c where c.id = challenge_id and c.owner_id = auth.uid()));
create policy "update own member" on members for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read requirements" on requirements for select to authenticated using (is_member(challenge_id));
create policy "write own requirements" on requirements for insert to authenticated
  with check (user_id = auth.uid() and is_member(challenge_id));
create policy "update own requirements" on requirements for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "delete own requirements" on requirements for delete to authenticated
  using (user_id = auth.uid());

create policy "read day_logs" on day_logs for select to authenticated using (is_member(challenge_id));
create policy "insert own day_log" on day_logs for insert to authenticated
  with check (user_id = auth.uid() and is_member(challenge_id));
create policy "update own day_log" on day_logs for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "read entries" on log_entries for select to authenticated using (is_member(challenge_id));
create policy "insert own entries" on log_entries for insert to authenticated
  with check (user_id = auth.uid() and is_member(challenge_id));
create policy "update own entries" on log_entries for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── realtime ──────────────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table day_logs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table log_entries;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table members;
exception when duplicate_object then null; end $$;

-- ════════════════════════════════════════════════════════════════════════
-- MIGRATION — copy the live Kyle-vs-Dylen challenge into v2 (idempotent)
-- ════════════════════════════════════════════════════════════════════════
do $$
declare
  cid uuid; k uuid; d uuid; m uuid; r record; dl uuid; rq uuid;
begin
  if exists (select 1 from challenges where join_code = 'MOHAWK') then
    raise notice 'migration already done, skipping';
    return;
  end if;
  select id into k from profiles where display_name = 'Kyle';
  select id into d from profiles where display_name = 'Dylen';
  select id into m from profiles where display_name = 'Marcus';
  if k is null or d is null or m is null then raise exception 'seed profiles missing'; end if;

  insert into challenges (name, join_code, owner_id, start_date, timezone, total_days)
  values ('Kyle vs Dylen', 'MOHAWK', k, '2026-06-30', 'America/Los_Angeles', 75)
  returning id into cid;

  insert into members (challenge_id, user_id, role, stake_text, stake_image, accent,
                        goal_label, goal_target_count, goal_count_label,
                        goal_launched, goal_launched_at, goal_current_count)
  select cid, p.id,
         case when p.display_name = 'Marcus' then 'referee' else 'participant' end,
         p.forfeit_text,
         case p.display_name when 'Kyle' then '/forfeit-kyle.png'
                             when 'Dylen' then '/forfeit-dylen.png'
                             when 'Marcus' then '/marcus.png' end,
         p.accent, p.goal_label, p.goal_target_count, p.goal_count_label,
         p.goal_launched, p.goal_launched_at, p.goal_current_count
  from profiles p where p.id in (k, d, m);

  -- Kyle's checklist (photos + 2 checks)
  insert into requirements (challenge_id, user_id, key, label, hint, group_label, icon, kind, sort) values
    (cid, k, 'workout_indoor',  'Indoor Workout',    '45 min · Apple Watch', 'Train',     'dumbbell', 'photo', 1),
    (cid, k, 'workout_outdoor', 'Outdoor Workout',   '45 min · Apple Watch', 'Train',     'run',      'photo', 2),
    (cid, k, 'meal_1',          'Meal 1',            'On plan',              'Fuel',      'plate',    'photo', 3),
    (cid, k, 'meal_2',          'Meal 2',            'On plan',              'Fuel',      'plate',    'photo', 4),
    (cid, k, 'meal_3',          'Meal 3',            'On plan',              'Fuel',      'plate',    'photo', 5),
    (cid, k, 'progress',        'Progress Photo',    'Mirror shot',          'Progress',  'camera',   'photo', 6),
    (cid, k, 'reading',         'Read 10 Pages',     'Just check it',        'Check off', 'book',     'check', 7),
    (cid, k, 'water',           '1 Gallon of Water', 'Just check it',        'Check off', 'drop',     'check', 8);

  -- Dylen's checklist (MyFitnessPal instead of 3 meals)
  insert into requirements (challenge_id, user_id, key, label, hint, group_label, icon, kind, sort) values
    (cid, d, 'workout_indoor',  'Indoor Workout',    '45 min · Apple Watch',              'Train',     'dumbbell', 'photo', 1),
    (cid, d, 'workout_outdoor', 'Outdoor Workout',   '45 min · Apple Watch',              'Train',     'run',      'photo', 2),
    (cid, d, 'meal_1',          'MyFitnessPal',      'Daily summary · on calorie goal',   'Fuel',      'target',   'photo', 3),
    (cid, d, 'progress',        'Progress Photo',    'Mirror shot',                       'Progress',  'camera',   'photo', 4),
    (cid, d, 'reading',         'Read 10 Pages',     'Just check it',                     'Check off', 'book',     'check', 5),
    (cid, d, 'water',           '1 Gallon of Water', 'Just check it',                     'Check off', 'drop',     'check', 6);

  -- migrate existing logs (from the real start date on)
  for r in select * from daily_logs where log_date >= '2026-06-30' and user_id in (k, d) loop
    insert into day_logs (challenge_id, user_id, log_date, status, judge_note, reviewed_by, reviewed_at, created_at, updated_at)
    values (cid, r.user_id, r.log_date, r.status, r.judge_note, r.reviewed_by, r.reviewed_at, r.created_at, r.updated_at)
    returning id into dl;

    -- photo slots → entries
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'workout_indoor' loop
      if r.workout_indoor_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, photo_path) values (dl, rq, cid, r.user_id, r.workout_indoor_path); end if; end loop;
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'workout_outdoor' loop
      if r.workout_outdoor_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, photo_path) values (dl, rq, cid, r.user_id, r.workout_outdoor_path); end if; end loop;
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'meal_1' loop
      if r.meal_1_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, photo_path) values (dl, rq, cid, r.user_id, r.meal_1_path); end if; end loop;
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'meal_2' loop
      if r.meal_2_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, photo_path) values (dl, rq, cid, r.user_id, r.meal_2_path); end if; end loop;
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'meal_3' loop
      if r.meal_3_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, photo_path) values (dl, rq, cid, r.user_id, r.meal_3_path); end if; end loop;
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'progress' loop
      if r.progress_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, photo_path) values (dl, rq, cid, r.user_id, r.progress_path); end if; end loop;
    -- checks → entries
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'reading' loop
      if r.reading_path is not null then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, checked) values (dl, rq, cid, r.user_id, true); end if; end loop;
    for rq in select id from requirements where challenge_id = cid and user_id = r.user_id and key = 'water' loop
      if r.water then
        insert into log_entries (day_log_id, requirement_id, challenge_id, user_id, checked) values (dl, rq, cid, r.user_id, true); end if; end loop;
  end loop;

  raise notice 'migration complete: challenge %', cid;
end $$;
