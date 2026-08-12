-- ─────────────────────────────────────────────────────────────────────────
-- Two things, one paste.
--
-- 1. YOUR DAY, ON YOUR CLOCK (this did not land the first time round)
--    timezone      null = follow the challenge's timezone, which is every
--                  existing member, so nothing changes until they set it.
--    day_end_hour  0 = midnight. 1..5 pushes the rollover into the small
--                  hours so "in bed by 1am" can be ticked at 12:45am against
--                  the day it belongs to. Capped at 5: past that it stops
--                  being a late night and becomes a way to log yesterday
--                  over breakfast.
--
-- 2. DEADLINES
--    due_by     minutes after midnight, so 720 is noon. Null = no deadline,
--               which is every item that exists today.
--    logged_at  when proof FIRST landed. updated_at already existed but it
--               moves every time a caption is edited or a macro estimate is
--               written back, so it cannot answer "was this on time".
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ── the member's own clock
alter table profiles add column if not exists timezone text;
alter table profiles add column if not exists day_end_hour smallint not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_day_end_hour_range') then
    alter table profiles
      add constraint profiles_day_end_hour_range
      check (day_end_hour >= 0 and day_end_hour <= 5);
  end if;
end $$;

-- 2 ── per-item deadlines
alter table requirements add column if not exists due_by smallint;
alter table log_entries  add column if not exists logged_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'requirements_due_by_range') then
    alter table requirements
      add constraint requirements_due_by_range
      check (due_by is null or (due_by >= 0 and due_by < 1440));
  end if;
end $$;

-- Existing proof gets a best-effort stamp so history is not blank. updated_at
-- overstates it for anything edited later, which is why new rows stop relying
-- on it, but it beats pretending nothing was ever logged.
update log_entries
   set logged_at = updated_at
 where logged_at is null
   and (photo_path is not null or checked is true);

comment on column profiles.timezone     is 'Member''s own timezone. Null follows the challenge timezone.';
comment on column profiles.day_end_hour is 'Hour the member''s day rolls over, 0-5. 0 = midnight.';
comment on column requirements.due_by   is 'Minutes after midnight this item is due. Null = no deadline.';
comment on column log_entries.logged_at is 'When proof first landed, for on-time checks.';
