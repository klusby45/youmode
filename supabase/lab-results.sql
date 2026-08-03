-- ─────────────────────────────────────────────────────────────────────────
-- Blood work, so the coach can anchor targets to real numbers instead of
-- whatever the member remembered to type.
--
-- DELIBERATE: the uploaded file is NEVER stored. It is read once, in flight,
-- and discarded. Only the extracted markers the member reviews and confirms
-- are saved. A full lab PDF is a medical record with a name, a date of birth
-- and dozens of results the app has no use for; the six numbers that inform a
-- fiber target are not. Keeping the smallest thing that does the job means
-- there is no document to leak, subpoena, or explain to Apple.
--
-- markers shape (array, faithful to how a panel reads):
--   [{"name":"Apolipoprotein B","slug":"apob","value":101,"unit":"mg/dL",
--     "ref":"<90","flag":"high"}]
--
-- Idempotent, safe to paste more than once.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists lab_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references profiles(id) on delete cascade,
  drawn_on   date not null,
  panel_name text,
  markers    jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lab_results_user_idx on lab_results (user_id, drawn_on desc);

-- One panel per user per draw date; re-uploading the same draw replaces it
-- rather than stacking duplicates.
create unique index if not exists lab_results_user_date_uq on lab_results (user_id, drawn_on);

alter table lab_results enable row level security;

-- Strictly own-user. No referee exception, no challenge-mate exception: a
-- lipid panel is not proof of a workout and nobody else in a challenge has
-- any business reading it.
drop policy if exists lab_results_select_own on lab_results;
create policy lab_results_select_own on lab_results
  for select using (user_id = auth.uid());

drop policy if exists lab_results_insert_own on lab_results;
create policy lab_results_insert_own on lab_results
  for insert with check (user_id = auth.uid());

drop policy if exists lab_results_update_own on lab_results;
create policy lab_results_update_own on lab_results
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists lab_results_delete_own on lab_results;
create policy lab_results_delete_own on lab_results
  for delete using (user_id = auth.uid());

comment on table lab_results is
  'Member-confirmed lab markers. The source document is never stored: it is read in flight and discarded.';
