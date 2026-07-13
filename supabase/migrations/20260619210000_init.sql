-- 75 HARD — initial schema (tables, RLS, judge RPC, storage policies, bucket, config)
-- Profile rows are seeded by scripts/setup-accounts.mjs after the 3 auth users exist.

-- ── Enums ────────────────────────────────────────────────────────────────
do $$ begin
  create type user_role as enum ('participant', 'judge');
exception when duplicate_object then null; end $$;

do $$ begin
  create type day_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

-- ── profiles ─────────────────────────────────────────────────────────────
create table if not exists profiles (
  id                 uuid primary key references auth.users(id) on delete cascade,
  display_name       text not null,
  role               user_role not null,
  forfeit_text       text,
  accent             text,
  goal_label         text,
  goal_target_count  int,
  goal_count_label   text,
  goal_launched      boolean not null default false,
  goal_launched_at   date,
  goal_current_count int not null default 0,
  created_at         timestamptz not null default now()
);

-- ── challenge_config (singleton) ─────────────────────────────────────────
create table if not exists challenge_config (
  id          int primary key default 1 check (id = 1),
  start_date  date not null,
  total_days  int not null default 75,
  timezone    text not null default 'America/Denver'
);

-- ── daily_logs ───────────────────────────────────────────────────────────
create table if not exists daily_logs (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references profiles(id) on delete cascade,
  log_date             date not null,
  workout_indoor_path  text,
  workout_outdoor_path text,
  meal_1_path          text,
  meal_2_path          text,
  meal_3_path          text,
  reading_path         text,
  progress_path        text,
  water                boolean not null default false,
  status               day_status not null default 'pending',
  judge_note           text,
  reviewed_by          uuid references profiles(id),
  reviewed_at          timestamptz,
  is_complete boolean generated always as (
    workout_indoor_path is not null and workout_outdoor_path is not null and
    meal_1_path is not null and meal_2_path is not null and meal_3_path is not null and
    reading_path is not null and progress_path is not null and water = true
  ) stored,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, log_date)
);
create index if not exists daily_logs_log_date_idx on daily_logs (log_date);
create index if not exists daily_logs_user_date_idx on daily_logs (user_id, log_date);

-- ── role helper ──────────────────────────────────────────────────────────
create or replace function is_judge()
  returns boolean language sql security definer set search_path = public stable
as $$ select exists (select 1 from profiles where id = auth.uid() and role = 'judge'); $$;

-- ── judge verdict RPC ────────────────────────────────────────────────────
create or replace function review_day(p_log_id uuid, p_verdict day_status, p_note text default null)
  returns daily_logs language plpgsql security definer set search_path = public
as $$
declare r daily_logs;
begin
  if not is_judge() then raise exception 'only the judge may review days'; end if;
  if p_verdict not in ('approved', 'rejected') then raise exception 'verdict must be approved or rejected'; end if;
  update daily_logs
     set status = p_verdict, judge_note = p_note,
         reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where id = p_log_id returning * into r;
  return r;
end $$;

-- ── guard: participants can't touch verdict fields ───────────────────────
create or replace function guard_log_update()
  returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if is_judge() then return new; end if;
  if new.status is distinct from old.status
     or new.judge_note is distinct from old.judge_note
     or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at then
    raise exception 'participants cannot modify the judge verdict';
  end if;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_guard_log_update on daily_logs;
create trigger trg_guard_log_update before update on daily_logs
  for each row execute function guard_log_update();

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table profiles enable row level security;
alter table challenge_config enable row level security;
alter table daily_logs enable row level security;

drop policy if exists "read profiles" on profiles;
create policy "read profiles" on profiles for select to authenticated using (true);
drop policy if exists "update own profile" on profiles;
create policy "update own profile" on profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

drop policy if exists "read config" on challenge_config;
create policy "read config" on challenge_config for select to authenticated using (true);

drop policy if exists "read all logs" on daily_logs;
create policy "read all logs" on daily_logs for select to authenticated using (true);
drop policy if exists "insert own log" on daily_logs;
create policy "insert own log" on daily_logs for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own log" on daily_logs;
create policy "update own log" on daily_logs for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ── storage bucket + policies ────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('proof', 'proof', false)
  on conflict (id) do nothing;

drop policy if exists "read proof" on storage.objects;
create policy "read proof" on storage.objects for select to authenticated using (bucket_id = 'proof');
drop policy if exists "write own proof" on storage.objects;
create policy "write own proof" on storage.objects for insert to authenticated
  with check (bucket_id = 'proof' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "update own proof" on storage.objects;
create policy "update own proof" on storage.objects for update to authenticated
  using (bucket_id = 'proof' and (storage.foldername(name))[1] = auth.uid()::text);

-- ── challenge config: starts today ───────────────────────────────────────
insert into challenge_config (id, start_date, total_days, timezone)
values (1, '2026-06-30', 75, 'America/Denver')
on conflict (id) do update
  set start_date = excluded.start_date, total_days = excluded.total_days, timezone = excluded.timezone;

-- ── Realtime: stream log + profile changes to the scoreboard/queue ───────
do $$ begin
  alter publication supabase_realtime add table daily_logs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table profiles;
exception when duplicate_object then null; end $$;
