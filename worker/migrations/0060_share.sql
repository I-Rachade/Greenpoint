-- Share: renting e-motorbikes (later e-scooters and cars) from station to station (plan
-- "Modul Share" in the project folder, docs/SHARE.md). A vehicle carries a Tutrack GPS tracker
-- with an ignition lock; a ride starts at a Share station and ends within the radius of any
-- Share station. Paid after the ride with Flooz/T-Money, Green Credit or in cash to the staff.
-- A ride paid from Green Credit is booked in wallet_transactions as type 'trip' (a ride, as the
-- former driver trips were) with the ride in details: a new type would mean rebuilding the
-- table, which drops the triggers other migrations put on it.
-- Code: src/lib/share.ts, worker/share.ts, worker/tutrack.ts, worker/tutrack-bridge.ts.
-- Numbered after the migrations of PR #91 (0049 to 0059) so both can land in any order.
-- Only adds tables, columns and rows, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- The module switch: off until an admin turns it on in the backoffice.
insert into app_settings (key, value, updated_at) values ('share_enabled', '0', '2026-10-20T00:00:00.000Z');

-- Stations that take Share vehicles: the drop-off radius (50 m by default) and the loan helmets kept there.
create table share_stations (
  station_id text primary key references stations (id) on delete cascade,
  enabled integer not null default 1 check (enabled in (0, 1)),
  radius_m integer not null default 50 check (radius_m between 10 and 500),
  helmets integer not null default 0 check (helmets between 0 and 500),
  updated_at text not null
);

-- Prices per vehicle kind in FCFA. Inactive until an admin sets them: such a kind cannot be rented.
create table share_tariffs (
  kind text primary key check (kind in ('emoto', 'escooter', 'car')),
  unlock_xof integer not null default 0 check (unlock_xof >= 0),
  minute_xof integer not null default 0 check (minute_xof >= 0),
  pause_minute_xof integer not null default 0 check (pause_minute_xof >= 0),
  deposit_xof integer not null default 0 check (deposit_xof >= 0),
  wrong_drop_xof integer not null default 0 check (wrong_drop_xof >= 0),
  is_active integer not null default 0 check (is_active in (0, 1)),
  updated_at text not null
);
insert into share_tariffs (kind, updated_at) values
  ('emoto', '2026-10-20T00:00:00.000Z'), ('escooter', '2026-10-20T00:00:00.000Z'), ('car', '2026-10-20T00:00:00.000Z');

-- The vehicles and their tracker. station_id = where it is parked (null while on the road or lost).
-- The tracker columns are what Tutrack last pushed (worker/tutrack-bridge.ts).
create table share_vehicles (
  id text primary key,
  kind text not null check (kind in ('emoto', 'escooter', 'car')),
  name text not null check (length(name) between 1 and 60),
  plate text not null default '',
  qr_token text not null unique,
  home_station_id text references stations (id) on delete set null,
  station_id text references stations (id) on delete set null,
  status text not null default 'maintenance'
    check (status in ('available', 'reserved', 'in_ride', 'charging', 'maintenance', 'lost')),
  tracker_id text unique,            -- Tutrack deviceId
  imei text not null default '',
  sim text not null default '',
  unlock_command text not null default '',  -- Tutrack cmdCategoryCode that releases the ignition
  lock_command text not null default '',    -- … and the one that cuts it
  online integer not null default 0 check (online in (0, 1)),
  ignition integer check (ignition in (0, 1)),
  battery_percent integer check (battery_percent between 0 and 100),
  lat real,
  lng real,
  fix_at text,                       -- time of the last position (UTC)
  last_seen_at text,
  note text not null default '',
  created_at text not null
);
create index share_vehicles_station_idx on share_vehicles (station_id, status);

-- One ride per row: reserved → riding ⇄ paused → ended, or reserved → cancelled.
create table share_rides (
  id text primary key,
  user_id text references users (id) on delete set null,
  vehicle_id text not null references share_vehicles (id),
  from_station_id text not null references stations (id),
  to_station_id text references stations (id) on delete set null,
  end_station_id text references stations (id) on delete set null,
  status text not null check (status in ('reserved', 'riding', 'paused', 'ended', 'cancelled')),
  helmet integer not null default 0 check (helmet in (0, 1)),
  reserved_at text not null,
  reserve_expires_at text,
  started_at text,
  paused_at text,
  paused_seconds integer not null default 0,
  ended_at text,
  ended_by text,                     -- the customer, or the admin who ended it by hand
  wrong_drop integer not null default 0 check (wrong_drop in (0, 1)),
  distance_m integer not null default 0,
  -- The tariff as it was when the ride started: a later price change does not touch it.
  unlock_xof integer not null default 0,
  minute_xof integer not null default 0,
  pause_minute_xof integer not null default 0,
  deposit_xof integer not null default 0,
  wrong_drop_xof integer not null default 0,
  amount_xof integer not null default 0,
  payment_status text not null default 'none' check (payment_status in ('none', 'unpaid', 'paid')),
  paid_with text check (paid_with in ('flooz', 'tmoney', 'wallet', 'cash', 'free')),
  paid_at text,
  paid_ref text,                     -- Green Credit transaction number of a ride paid from the credit
  cash_by text,                      -- staff who took the cash
  photos text not null default '[]', -- R2 keys of the photos at the start and the end
  created_at text not null
);
create index share_rides_user_idx on share_rides (user_id, created_at);
create index share_rides_vehicle_idx on share_rides (vehicle_id, created_at);
-- At most one open ride per vehicle and per customer, also under parallel requests.
create unique index share_rides_one_per_vehicle on share_rides (vehicle_id) where status in ('reserved', 'riding', 'paused');
create unique index share_rides_one_per_user on share_rides (user_id) where status in ('reserved', 'riding', 'paused');

-- The track of a ride, from the tracker (or the phone while trackers are simulated).
create table share_ride_points (
  ride_id text not null references share_rides (id) on delete cascade,
  at text not null,
  lat real not null,
  lng real not null,
  speed_kmh real
);
create index share_ride_points_ride_idx on share_ride_points (ride_id, at);

-- The customer's check, once: ID photo and selfie (licence only for cars). Photos are private (R2).
create table share_verifications (
  user_id text primary key references users (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  id_key text,
  selfie_key text,
  licence_key text,
  submitted_at text,
  decided_at text,
  decided_by text,
  reject_reason text
);

-- Breakdowns, damage, alarms, vehicles left outside a station, rides that run too long.
create table share_incidents (
  id text primary key,
  kind text not null check (kind in ('breakdown', 'damage', 'alarm', 'wrong_drop', 'long_ride', 'offline')),
  vehicle_id text references share_vehicles (id) on delete set null,
  ride_id text references share_rides (id) on delete set null,
  note text not null default '',
  created_at text not null,
  resolved_at text,
  resolved_by text,
  resolution text
);
create index share_incidents_open_idx on share_incidents (resolved_at, created_at);
-- One open alarm of a kind per ride, so a tracker that repeats itself does not flood the list.
create unique index share_incidents_one_open on share_incidents (ride_id, kind) where resolved_at is null and ride_id is not null;

-- A ride paid with Flooz/T-Money (worker/payments.ts), at most one open or paid payment per ride.
alter table payments add column share_ride_id text;
create unique index payments_one_per_share_ride on payments (share_ride_id)
  where share_ride_id is not null and status in ('pending', 'succeeded');
