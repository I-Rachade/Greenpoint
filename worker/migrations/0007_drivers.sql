-- Drivers (phase 1): people who drive one of our vehicles carry parcels express
-- between stations, pick them up at a customer's home or deliver them there.
-- Plan: planung/fahrer.md, code: worker/drivers.ts and src/lib/drivers.ts.
-- Only adds tables and columns, so it is safe to apply before the new Worker is deployed.
-- "Driver" is not a value of users.role: rebuilding that table would cascade into
-- sessions and reservations. A driver is a user with a row in `drivers`.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Prices and rules (one row), see DEFAULT_DRIVER_SETTINGS in src/lib/drivers.ts.
create table driver_settings (
  id integer primary key check (id = 1),
  settings text not null,          -- JSON of DriverSettings
  updated_at text not null
);

-- Our own vehicles, handed to drivers by the admin.
create table fleet_vehicles (
  id text primary key,
  type text not null check (type in ('moto', 'tricycle', 'cargo_tricycle')),
  plate text not null unique check (length(plate) between 2 and 20),
  is_active integer not null default 1,
  created_at text not null
);

create table drivers (
  user_id text primary key references users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'suspended')),
  full_name text not null check (length(full_name) between 2 and 80),
  id_number text not null check (length(id_number) between 3 and 40),
  license_number text not null check (length(license_number) between 3 and 40),
  wanted_type text not null check (wanted_type in ('moto', 'tricycle', 'cargo_tricycle')),
  id_doc_key text,                 -- R2 keys of the photos (private, admins only)
  license_doc_key text,
  portrait_key text,
  vehicle_id text unique references fleet_vehicles (id) on delete set null,
  code text not null unique,       -- shown under the driver's QR code
  created_at text not null,
  reviewed_at text,
  reviewed_by text
);

-- Drivers waiting at a station; the earliest is first in line.
create table driver_queue (
  driver_id text primary key references drivers (user_id) on delete cascade,
  station_id text not null references stations (id) on delete cascade,
  since text not null
);
create index driver_queue_station_idx on driver_queue (station_id, since);

-- One trip of a driver. User ids have no foreign key, like parcels: the trip stays on record.
create table delivery_jobs (
  id text primary key,
  kind text not null check (kind in ('express', 'pickup', 'delivery')),
  status text not null check (status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning', 'done', 'failed', 'cancelled')),
  parcel_id text references parcels (id),
  customer_user_id text,            -- pickup: the sender; delivery: the recipient; express: null
  customer_name text,
  from_station_id text references stations (id),
  to_station_id text references stations (id),
  home_lat real,
  home_lng real,
  home_note text check (home_note is null or length(home_note) <= 300),
  home_phone text,
  size text not null check (size in ('S', 'M', 'L', 'XL')),
  weight_kg real,
  content text not null default '',
  declared_value integer,
  recipient_phone text,             -- pickup bookings, before the parcel exists
  recipient_name text,
  distance_m integer not null,
  fare_fcfa integer not null check (fare_fcfa >= 0),
  collect_fcfa integer not null default 0 check (collect_fcfa >= 0),
  driver_id text,
  driver_station_id text,           -- where the driver was in line when offered the trip
  declined text not null default '', -- drivers who said no, comma-separated, so it is not offered to them again
  created_at text not null,
  assigned_at text,
  accepted_at text,
  picked_up_at text,
  at_door_at text,
  done_at text,
  cancelled_by text,
  proof_key text                    -- R2 key of the photo at the door
);
create index delivery_jobs_status_idx on delivery_jobs (status, created_at);
create index delivery_jobs_driver_idx on delivery_jobs (driver_id, created_at);
create index delivery_jobs_customer_idx on delivery_jobs (customer_user_id, created_at);
create index delivery_jobs_parcel_idx on delivery_jobs (parcel_id);
-- A driver has one trip at a time; a parcel one open trip.
create unique index delivery_jobs_one_per_driver on delivery_jobs (driver_id)
  where status in ('assigned', 'accepted', 'picked_up', 'at_door', 'returning');
create unique index delivery_jobs_one_per_parcel on delivery_jobs (parcel_id)
  where status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning');

-- Money between us and the driver: cash collected (owed to us), earnings and settlements (paid out or handed in).
create table driver_ledger (
  id text primary key,
  driver_id text not null,          -- no foreign key: accounting stays when the account is deleted
  at text not null,
  kind text not null check (kind in ('collected', 'earning', 'settlement')),
  amount_fcfa integer not null,
  job_id text,
  station_id text,
  actor text
);
create index driver_ledger_driver_idx on driver_ledger (driver_id, at);
-- One earning and one cash entry per trip.
create unique index driver_ledger_once_per_job on driver_ledger (job_id, kind) where job_id is not null;

-- Parcels: express trips skip the collection run; home deliveries keep the
-- status "arrived" until delivered and track the trip here.
alter table parcels add column express integer not null default 0;
alter table parcels add column delivery_status text check (delivery_status is null or delivery_status in ('booked', 'out_for_delivery', 'delivered', 'failed'));
alter table parcels add column job_id text;
