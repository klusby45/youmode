-- ─────────────────────────────────────────────────────────────────────────
-- Three things, one paste.
--
-- 1. THE 'note' PROOF KIND
--    requirements_kind_check predates it, so a note item cannot be saved at
--    all until this widens.
--
-- 2. GROUPING
--    group_label already exists and already holds a real grouping for meals
--    ("Fuel"). It also holds "Custom" on 34 rows, which means nothing: it is
--    what the coach writes when an item is not food. Clearing it lets any
--    remaining label be treated as a real group the member chose, so four
--    supplements can share one tile instead of taking four.
--
-- 3. SLEEP PROOF
--    sleep_by / wake_by, minutes after midnight, on a photo item. Both set
--    means "this photo is a sleep screenshot": read the bedtime and the wake
--    time off it and check them against these. 60 = 1:00am, 540 = 9:00am.
--    Two columns rather than reusing due_by because a night has two ends.
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

-- 1 ── allow note items
alter table requirements drop constraint if exists requirements_kind_check;
alter table requirements
  add constraint requirements_kind_check
  check (kind in ('photo', 'check', 'timer', 'note'));

-- 2 ── "Custom" is not a group, it is the absence of one
update requirements set group_label = null where group_label = 'Custom';

-- 3 ── sleep targets
alter table requirements add column if not exists sleep_by smallint;
alter table requirements add column if not exists wake_by  smallint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'requirements_sleep_range') then
    alter table requirements add constraint requirements_sleep_range
      check ((sleep_by is null or (sleep_by >= 0 and sleep_by < 1440))
         and (wake_by  is null or (wake_by  >= 0 and wake_by  < 1440)));
  end if;
end $$;

comment on column requirements.group_label is
  'Optional group. Items sharing one render as a single tile. Null = ungrouped.';
comment on column requirements.sleep_by is
  'Minutes after midnight to be asleep by. With wake_by, marks a sleep-screenshot photo item.';
comment on column requirements.wake_by is
  'Minutes after midnight to be up by.';
