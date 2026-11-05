-- Rides: a driver takes the customer themselves from point A (home_*) to point
-- B (dropoff_*), paid in cash on arrival. Code: worker/drivers.ts (bookRide).
--
-- SQLite cannot change the check on delivery_jobs.kind, so the table is
-- rebuilt. No table has a foreign key to delivery_jobs (parcels.job_id,
-- driver_ledger.job_id and greenpoint_ledger.job_id are plain columns), so
-- dropping it cascades nowhere. The new table only adds columns, so it is
-- safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
PRAGMA defer_foreign_keys = on;

create table delivery_jobs_new (
  id text primary key,
  kind text not null check (kind in ('express', 'pickup', 'delivery', 'ride')),
  status text not null check (status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning', 'done', 'failed', 'cancelled')),
  parcel_id text references parcels (id),
  customer_user_id text,            -- pickup: the sender; delivery: the recipient; ride: the passenger; express: null
  customer_name text,
  from_station_id text references stations (id),
  to_station_id text references stations (id),
  home_lat real,                    -- ride: where the customer gets on
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
  picked_up_at text,                -- ride: the customer got on
  at_door_at text,
  done_at text,
  cancelled_by text,
  proof_key text,                   -- R2 key of the photo at the door
  dropoff_lat real,                 -- ride: where the customer gets off
  dropoff_lng real,
  dropoff_note text check (dropoff_note is null or length(dropoff_note) <= 300),
  passengers integer check (passengers is null or passengers between 1 and 3)
);

insert into delivery_jobs_new (id, kind, status, parcel_id, customer_user_id, customer_name, from_station_id, to_station_id,
  home_lat, home_lng, home_note, home_phone, size, weight_kg, content, declared_value, recipient_phone, recipient_name,
  distance_m, fare_fcfa, collect_fcfa, driver_id, driver_station_id, declined, created_at, assigned_at, accepted_at,
  picked_up_at, at_door_at, done_at, cancelled_by, proof_key)
select id, kind, status, parcel_id, customer_user_id, customer_name, from_station_id, to_station_id,
  home_lat, home_lng, home_note, home_phone, size, weight_kg, content, declared_value, recipient_phone, recipient_name,
  distance_m, fare_fcfa, collect_fcfa, driver_id, driver_station_id, declined, created_at, assigned_at, accepted_at,
  picked_up_at, at_door_at, done_at, cancelled_by, proof_key
from delivery_jobs;

drop table delivery_jobs;
alter table delivery_jobs_new rename to delivery_jobs;

create index delivery_jobs_status_idx on delivery_jobs (status, created_at);
create index delivery_jobs_driver_idx on delivery_jobs (driver_id, created_at);
create index delivery_jobs_customer_idx on delivery_jobs (customer_user_id, created_at);
create index delivery_jobs_parcel_idx on delivery_jobs (parcel_id);
-- A driver has one trip at a time; a parcel one open trip.
create unique index delivery_jobs_one_per_driver on delivery_jobs (driver_id)
  where status in ('assigned', 'accepted', 'picked_up', 'at_door', 'returning');
create unique index delivery_jobs_one_per_parcel on delivery_jobs (parcel_id)
  where status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning');
