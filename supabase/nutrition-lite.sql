-- ─────────────────────────────────────────────────────────────────────────
-- Nutrition, unbundled from the weight goal.
--
-- Seeing what you ate used to require a body_plans row, which meant declaring
-- a target weight and a rate of loss. Those are different wants: Miska asked
-- for fiber and fat numbers, not a weight program. After this, a body_plans
-- row can carry nutrition preferences alone, with every weight field null.
--
-- Two more estimator fields (sodium, sugar) and the optional targets the
-- onboarding question writes when someone asks for targets rather than plain
-- numbers.
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

-- ── per-meal estimates ───────────────────────────────────────────────────
alter table log_entries add column if not exists est_sodium int;
alter table log_entries add column if not exists est_sugar  int;

alter table log_entries drop constraint if exists log_entries_macro_sane2;
alter table log_entries add constraint log_entries_macro_sane2 check (
  (est_sodium is null or est_sodium between 0 and 20000) and
  (est_sugar  is null or est_sugar  between 0 and 400)
);

-- ── nutrition preferences + optional targets ─────────────────────────────
-- 'aware'   = show the numbers, no targets, no judgment
-- 'targets' = show progress against the goals below
-- null      = never asked (treated as 'aware' once they log a meal)
alter table body_plans add column if not exists nutrition_mode text;
alter table body_plans drop constraint if exists body_plans_nutrition_mode_ck;
alter table body_plans add constraint body_plans_nutrition_mode_ck check (
  nutrition_mode is null or nutrition_mode in ('aware', 'targets', 'off')
);

alter table body_plans add column if not exists fiber_target  int;
alter table body_plans add column if not exists sat_fat_max   int;
alter table body_plans add column if not exists sodium_max    int;
alter table body_plans add column if not exists sugar_max     int;

alter table body_plans drop constraint if exists body_plans_targets_sane;
alter table body_plans add constraint body_plans_targets_sane check (
  (fiber_target is null or fiber_target between 5  and 100)   and
  (sat_fat_max  is null or sat_fat_max  between 5  and 100)   and
  (sodium_max   is null or sodium_max   between 500 and 10000) and
  (sugar_max    is null or sugar_max    between 5  and 200)
);

-- Weight fields were already nullable; this makes the intent explicit so a
-- nutrition-only row is obviously legitimate rather than looking half-filled.
comment on column body_plans.target_weight is
  'Optional. Null means nutrition tracking without a body-composition goal.';
