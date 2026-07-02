-- ============================================================
-- QC Terminal — Supabase schema (Option A)
-- Run this in the Supabase SQL Editor for your project.
-- ============================================================

create table if not exists qc_logs (
  id                    bigint generated always as identity primary key,
  serial_number         text not null,
  batch_number          text,
  uid_number            text,
  timestamp             timestamptz not null default now(),
  test_station          text not null,
  overall_status        text not null check (overall_status in ('PASS','FAIL')),
  notes                 text,
  is_retest             boolean not null default false,

  -- 10 QC parameters
  plug_socket_mating    text not null check (plug_socket_mating in ('Pass','Fail')),
  resistance_value      text not null check (resistance_value in ('Pass','Fail')),
  seal_cycle            text not null check (seal_cycle in ('Pass','Fail')),
  visual_appearance     text not null check (visual_appearance in ('Yes','No')),
  moulding_color        text not null check (moulding_color in ('Cream','Transparent','Brown')),
  golden_coating        text not null check (golden_coating in ('Present','Missing')),
  insert_glue           text not null check (insert_glue in ('Applied','Missing')),
  rotation_smoothness   text not null check (rotation_smoothness in ('Smooth','Rough')),
  labelling_clear       text not null check (labelling_clear in ('Yes','No')),
  serial_legibility     text not null check (serial_legibility in ('Yes','No')),

  created_at            timestamptz not null default now()
);

-- ------------------------------------------------------------
-- Duplicate prevention: a serial can only be tested once per
-- station UNLESS it's flagged as a re-test. A partial unique
-- index (only covering rows where is_retest = false) does this
-- cleanly: re-tests are simply excluded from the constraint.
-- ------------------------------------------------------------
create unique index if not exists uniq_serial_station_non_retest
  on qc_logs (serial_number, test_station)
  where is_retest = false;

-- Helpful index for the frontend's pre-submit duplicate check
create index if not exists idx_serial_station on qc_logs (serial_number, test_station);

-- ------------------------------------------------------------
-- Row Level Security: allow inserts from the anon key (used
-- directly from the browser) but disallow updates/deletes from
-- the client. Tighten further with real auth if needed.
-- ------------------------------------------------------------
alter table qc_logs enable row level security;

create policy "Allow inserts from anon"
  on qc_logs for insert
  to anon
  with check (true);

create policy "Allow reads from anon"
  on qc_logs for select
  to anon
  using (true);

-- No update/delete policy is created, so the client cannot
-- modify or remove existing logs — only append new ones.

-- ============================================================
-- Frontend wiring:
-- In the app's Settings panel, set:
--   Backend Mode      = Supabase
--   Supabase Project URL = https://<your-project>.supabase.co
--   Supabase Anon Key    = <your anon/public key, from
--                           Project Settings > API>
-- The app inserts rows via the PostgREST endpoint
-- (`${url}/rest/v1/qc_logs`), which is what index.html already
-- calls in submitToSupabase().
-- ============================================================
