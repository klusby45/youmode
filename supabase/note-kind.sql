-- ─────────────────────────────────────────────────────────────────────────
-- Allow the 'note' proof kind.
--
-- Photo, check and timer were the whole world when requirements_kind_check
-- was written. A note item stores the member's writing in log_entries.caption
-- and needs no new column, but the kind itself is rejected by the constraint
-- until this runs, so a note item cannot be saved at all.
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

alter table requirements drop constraint if exists requirements_kind_check;
alter table requirements
  add constraint requirements_kind_check
  check (kind in ('photo', 'check', 'timer', 'note'));

comment on column requirements.kind is
  'photo | check | timer | note. note = the member writes an answer; the text lives in log_entries.caption.';
