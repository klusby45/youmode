-- Phase 1: body goals — plans, weigh-ins, meal captions/estimates, optional items
create table if not exists body_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade unique,
  goal_text text,
  start_weight numeric,
  target_weight numeric,
  target_date date,
  protein_min int,
  protein_max int,
  calorie_target int,
  rate_target numeric,
  created_at timestamptz not null default now()
);
create table if not exists weigh_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  weigh_date date not null,
  weight numeric not null,
  created_at timestamptz not null default now(),
  unique (user_id, weigh_date)
);
alter table log_entries add column if not exists caption text;
alter table log_entries add column if not exists est_protein int;
alter table log_entries add column if not exists est_calories int;
alter table requirements add column if not exists optional boolean not null default false;

alter table body_plans enable row level security;
alter table weigh_ins enable row level security;
drop policy if exists "read plans" on body_plans;
create policy "read plans" on body_plans for select to authenticated using (true);
drop policy if exists "insert own plan" on body_plans;
create policy "insert own plan" on body_plans for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own plan" on body_plans;
create policy "update own plan" on body_plans for update to authenticated using (user_id = auth.uid());
drop policy if exists "delete own plan" on body_plans;
create policy "delete own plan" on body_plans for delete to authenticated using (user_id = auth.uid());
drop policy if exists "read weighins" on weigh_ins;
create policy "read weighins" on weigh_ins for select to authenticated using (true);
drop policy if exists "insert own weighin" on weigh_ins;
create policy "insert own weighin" on weigh_ins for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "update own weighin" on weigh_ins;
create policy "update own weighin" on weigh_ins for update to authenticated using (user_id = auth.uid());
drop policy if exists "delete own weighin" on weigh_ins;
create policy "delete own weighin" on weigh_ins for delete to authenticated using (user_id = auth.uid());
