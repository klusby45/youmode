-- ─────────────────────────────────────────────────────────────────────────
-- Your day, on your clock.
--
-- Both of these belong to the PERSON, not the challenge. Miska is running
-- hers from Paris, then Tunisia, then Albania, while the challenge was
-- created in New York. Dylen is a night owl in the same timezone as everyone
-- else and still needs a later boundary. A challenge-level setting cannot
-- express either one.
--
-- timezone      null = follow the challenge's timezone (every existing
--               member, so nothing changes for anyone until they set it).
-- day_end_hour  0 = midnight, the old and default behaviour. 1..5 pushes the
--               rollover into the small hours, so "in bed by 1am" can still
--               be ticked at 12:45am against the day it belongs to.
--
-- Capped at 5. Past that it stops being a late night and starts being a way
-- to log yesterday over breakfast, which is a different thing and not one
-- an accountability app should quietly allow.
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

alter table profiles add column if not exists timezone text;
alter table profiles add column if not exists day_end_hour smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'profiles_day_end_hour_range'
  ) then
    alter table profiles
      add constraint profiles_day_end_hour_range
      check (day_end_hour >= 0 and day_end_hour <= 5);
  end if;
end $$;

comment on column profiles.timezone is
  'Member''s own timezone. Null follows the challenge timezone.';
comment on column profiles.day_end_hour is
  'Hour the member''s day rolls over, 0-5. 0 = midnight.';
