-- Plan phase 7: every parcel is scanned when it changes hands, and the driver is recorded
-- (stationsdienste-plan: "Sammelfahrt: jedes Paket wird beim Verladen und beim Eingang
-- gescannt, der Fahrer wird erfasst"). Code: worker/parcel-runs.ts, worker/drivers.ts.
-- 0033 is kept for plan phase 8 (unique index station_staff(user_id)).
--
-- Only adds tables and columns, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- A collection run: staff at a station pick the parcels a driver takes along (status
-- loading), scan each one into the driver's hands, then the run leaves (under_way).
-- Staff at each destination scan the parcels in; the run is done when all are in.
create table parcel_runs (
  id text primary key,
  station_id text not null references stations (id),
  driver_id text not null,                 -- the driver account; no foreign key, the run stays on record
  status text not null check (status in ('loading', 'under_way', 'done', 'cancelled')),
  created_by text not null,
  created_role text not null check (created_role in ('staff', 'owner', 'admin')),
  created_at text not null,
  departed_at text,
  done_at text
);
create index parcel_runs_station_idx on parcel_runs (station_id, status);
create index parcel_runs_driver_idx on parcel_runs (driver_id, created_at);

-- The run a parcel is on (or went on). Set while loading, kept afterwards.
alter table parcels add column run_id text;
create index parcels_run_idx on parcels (run_id);

-- One row per scan of a parcel changing hands. run_id is the collection run
-- (parcel_runs.id) or the driver trip (delivery_jobs.id); '' for a parcel that left
-- before this migration. The same scan twice is one row (idempotent).
create table parcel_scans (
  id integer primary key autoincrement,
  parcel_id text not null references parcels (id) on delete cascade,
  run_id text not null,
  kind text not null check (kind in ('handover_to_driver', 'received_at_station', 'delivered')),
  driver_id text,
  station_id text,
  scanned_by text not null,
  role text not null check (role in ('staff', 'owner', 'admin', 'driver')),
  created_at text not null
);
create unique index parcel_scans_once on parcel_scans (parcel_id, run_id, kind);
create index parcel_scans_parcel_idx on parcel_scans (parcel_id, id);

-- Courier (door to door, no parcel row): the code the recipient gives the driver at the
-- door. Made when the driver takes the parcel; the sender sees it in the app.
alter table delivery_jobs add column handover_code text check (handover_code is null or length(handover_code) = 6);
