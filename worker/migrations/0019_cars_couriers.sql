-- Cars and express parcels door to door.
-- - fleet_vehicles.type and drivers.wanted_type gain 'car' (up to four passengers).
-- - delivery_jobs.kind gains 'courier': a parcel from the sender's door (home_*)
--   straight to the recipient's door (dropoff_*), paid in cash to the driver.
-- - delivery_jobs gains vehicle_type: the kind of vehicle a ride was booked for.
-- Code: worker/drivers.ts (bookRide, bookCourier).
--
-- SQLite cannot change a check, so the three tables are rebuilt.
-- delivery_jobs: no table has a foreign key to it (see 0018), so dropping it cascades nowhere.
-- drivers and fleet_vehicles: driver_queue and fleet_manager_drivers point at drivers
-- (on delete cascade) and drivers points at fleet_vehicles (on delete set null).
-- Dropping a table runs those actions even with deferred foreign keys, so all
-- four tables are copied first and filled again from the copies.
-- The new tables only widen checks and add a column, so this is safe to apply
-- before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
PRAGMA defer_foreign_keys = on;

-- Drivers and their vehicles ---------------------------------------------------------

create table fleet_vehicles_copy as select * from fleet_vehicles;
create table drivers_copy as select * from drivers;
create table driver_queue_copy as select * from driver_queue;
create table fleet_manager_drivers_copy as select * from fleet_manager_drivers;

drop table drivers;
drop table fleet_vehicles;

-- Our own vehicles, handed to drivers by the admin.
create table fleet_vehicles (
  id text primary key,
  type text not null check (type in ('moto', 'tricycle', 'cargo_tricycle', 'car')),
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
  wanted_type text not null check (wanted_type in ('moto', 'tricycle', 'cargo_tricycle', 'car')),
  id_doc_key text,                 -- R2 keys of the photos (private, admins only)
  license_doc_key text,
  portrait_key text,
  vehicle_id text unique references fleet_vehicles (id) on delete set null,
  code text not null unique,       -- shown under the driver's QR code
  created_at text not null,
  reviewed_at text,
  reviewed_by text
);

insert into fleet_vehicles (id, type, plate, is_active, created_at)
select id, type, plate, is_active, created_at from fleet_vehicles_copy;
insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, id_doc_key, license_doc_key,
  portrait_key, vehicle_id, code, created_at, reviewed_at, reviewed_by)
select user_id, status, full_name, id_number, license_number, wanted_type, id_doc_key, license_doc_key,
  portrait_key, vehicle_id, code, created_at, reviewed_at, reviewed_by
from drivers_copy;
-- Emptied by the cascade when drivers was dropped.
delete from driver_queue;
insert into driver_queue (driver_id, station_id, since) select driver_id, station_id, since from driver_queue_copy;
delete from fleet_manager_drivers;
insert into fleet_manager_drivers (driver_id, manager_id, created_at) select driver_id, manager_id, created_at from fleet_manager_drivers_copy;

drop table fleet_vehicles_copy;
drop table drivers_copy;
drop table driver_queue_copy;
drop table fleet_manager_drivers_copy;

-- Trips ---------------------------------------------------------------------------------

create table delivery_jobs_new (
  id text primary key,
  kind text not null check (kind in ('express', 'pickup', 'delivery', 'ride', 'courier')),
  status text not null check (status in ('open', 'assigned', 'accepted', 'picked_up', 'at_door', 'returning', 'done', 'failed', 'cancelled')),
  parcel_id text references parcels (id),
  customer_user_id text,            -- pickup and courier: the sender; delivery: the recipient; ride: the passenger; express: null
  customer_name text,
  from_station_id text references stations (id),
  to_station_id text references stations (id),
  home_lat real,                    -- ride: where the customer gets on; courier: the sender's door
  home_lng real,
  home_note text check (home_note is null or length(home_note) <= 300),
  home_phone text,
  size text not null check (size in ('S', 'M', 'L', 'XL')),
  weight_kg real,
  content text not null default '',
  declared_value integer,
  recipient_phone text,             -- pickup and courier bookings
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
  dropoff_lat real,                 -- ride: where the customer gets off; courier: the recipient's door
  dropoff_lng real,
  dropoff_note text check (dropoff_note is null or length(dropoff_note) <= 300),
  passengers integer check (passengers is null or passengers between 1 and 4),
  vehicle_type text check (vehicle_type is null or vehicle_type in ('moto', 'tricycle', 'cargo_tricycle', 'car'))
);

insert into delivery_jobs_new (id, kind, status, parcel_id, customer_user_id, customer_name, from_station_id, to_station_id,
  home_lat, home_lng, home_note, home_phone, size, weight_kg, content, declared_value, recipient_phone, recipient_name,
  distance_m, fare_fcfa, collect_fcfa, driver_id, driver_station_id, declined, created_at, assigned_at, accepted_at,
  picked_up_at, at_door_at, done_at, cancelled_by, proof_key, dropoff_lat, dropoff_lng, dropoff_note, passengers)
select id, kind, status, parcel_id, customer_user_id, customer_name, from_station_id, to_station_id,
  home_lat, home_lng, home_note, home_phone, size, weight_kg, content, declared_value, recipient_phone, recipient_name,
  distance_m, fare_fcfa, collect_fcfa, driver_id, driver_station_id, declined, created_at, assigned_at, accepted_at,
  picked_up_at, at_door_at, done_at, cancelled_by, proof_key, dropoff_lat, dropoff_lng, dropoff_note, passengers
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
