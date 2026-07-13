-- ════════════════════════════════════════════════════════════════════════
-- Account deletion support (App Store requirement). Paste once in the
-- Supabase SQL editor. Idempotent.
--
-- day_logs.reviewed_by points at the referee who ruled the day, with no
-- on-delete rule — so deleting a referee's profile is blocked by that FK.
-- Switch it to ON DELETE SET NULL: when a user is deleted, any days they
-- refereed simply lose the reviewer pointer (the verdict record stays).
-- The verdict-guard trigger prevents editing reviewed_by through the app, so
-- this cascade is the only path that ever nulls it — safe.
-- ════════════════════════════════════════════════════════════════════════

alter table day_logs drop constraint if exists day_logs_reviewed_by_fkey;
alter table day_logs
  add constraint day_logs_reviewed_by_fkey
  foreign key (reviewed_by) references profiles(id) on delete set null;

-- The verdict-guard trigger fires on EVERY update to day_logs — including the
-- FK's automatic reviewed_by → null when a referee's account is deleted, which
-- has no user context. Let those system/cascade updates through; authenticated
-- participants are still guarded (they always have a non-null auth.uid()).
create or replace function guard_day_log_update() returns trigger
  language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then return new; end if;           -- system/cascade/service op
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
