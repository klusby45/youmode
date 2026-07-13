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
