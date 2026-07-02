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
  plug_socket           text not null check (plug_socket in ('Pass','Fail')),
  seal                  text not null check (seal in ('Pass','Fail')),
  visual                text not null check (visual in ('Pass','Fail')),
  insert_glue           text not null check (insert_glue in ('Pass','Fail')),
  rotation              text not null check (rotation in ('Pass','Fail')),
  labelling             text not null check (labelling in ('Pass','Fail')),
  serial_number_check   text not null check (serial_number_check in ('Pass','Fail')),
  resistance            text,
  resistance_verified   text not null check (resistance_verified in ('Pass','Fail')),
  moulding              text not null check (moulding in ('Cream','Brown Transparent')),
  golden_coating        text not null check (golden_coating in ('Glossy','Dull')),
  created_at            timestamptz not null default now()
);

create unique index if not exists uniq_serial_station_non_retest
  on qc_logs (serial_number, test_station)
  where is_retest = false;

create index if not exists idx_serial_station on qc_logs (serial_number, test_station);

alter table qc_logs enable row level security;

drop policy if exists "Allow inserts from anon" on qc_logs;
drop policy if exists "Allow reads from anon" on qc_logs;
drop policy if exists "Allow updates from anon" on qc_logs;

create policy "Allow inserts from anon"
  on qc_logs for insert
  to anon
  with check (true);

create policy "Allow reads from anon"
  on qc_logs for select
  to anon
  using (true);

create policy "Allow updates from anon"
  on qc_logs for update
  to anon
  using (true)
  with check (true);
