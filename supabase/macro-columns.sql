-- ─────────────────────────────────────────────────────────────────────────
-- Full macro estimates on meal entries.
--
-- est_protein and est_calories already existed. A lab/health AI reasoning
-- about ApoB asked for saturated fat and fiber specifically, because those
-- are the dietary levers that actually move it, so the estimator now returns
-- the full set and these four columns store it.
--
-- All nullable: every existing row stays valid, and rows estimated before the
-- backfill simply have nulls until they are re-run.
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

alter table log_entries add column if not exists est_carbs   int;
alter table log_entries add column if not exists est_fat     int;
alter table log_entries add column if not exists est_sat_fat int;
alter table log_entries add column if not exists est_fiber   int;

-- Sanity bounds. These are per-meal estimates, not daily totals, so the caps
-- are generous; they exist to catch a runaway model output, not to be precise.
alter table log_entries drop constraint if exists log_entries_macro_sane;
alter table log_entries add constraint log_entries_macro_sane check (
  (est_carbs   is null or est_carbs   between 0 and 600) and
  (est_fat     is null or est_fat     between 0 and 300) and
  (est_sat_fat is null or est_sat_fat between 0 and 200) and
  (est_fiber   is null or est_fiber   between 0 and 100) and
  (est_sat_fat is null or est_fat is null or est_sat_fat <= est_fat)
);
