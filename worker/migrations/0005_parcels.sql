-- Parcel depot (phase 1): a customer hands in a parcel at station A for a
-- recipient who picks it up at station B with a 6-digit code. Staff collect the
-- parcels and carry them between stations. Plan: planung/paketdepot.md,
-- code: worker/parcels.ts and src/lib/parcels.ts.
-- Only adds tables, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Stations that accept and hand out parcels (set in the backoffice).
create table parcel_depots (
  station_id text primary key references stations (id) on delete cascade,
  is_active integer not null default 1,
  note text not null default '' check (length(note) <= 200),   -- where at the station, e.g. "au comptoir"
  lockers integer not null default 0 check (lockers between 0 and 500),  -- compartments of a future locker
  updated_at text not null
);

-- Size tiers and prices. A parcel gets the smallest tier it fits by dimensions and weight.
create table parcel_sizes (
  size text primary key check (size in ('S', 'M', 'L', 'XL')),
  max_length_cm real not null check (max_length_cm > 0),
  max_width_cm real not null check (max_width_cm > 0),
  max_height_cm real not null check (max_height_cm > 0),
  max_weight_kg real not null check (max_weight_kg > 0 and max_weight_kg <= 50),
  price_fcfa integer not null check (price_fcfa >= 0),
  updated_at text not null
);
insert into parcel_sizes (size, max_length_cm, max_width_cm, max_height_cm, max_weight_kg, price_fcfa, updated_at) values
  ('S', 30, 20, 15, 2, 200, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('M', 45, 35, 25, 5, 500, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('L', 60, 40, 40, 20, 1000, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('XL', 100, 60, 60, 50, 2000, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

-- One row per parcel. Size and price are copied in, so later price changes do
-- not touch parcels already handed in. User ids have no foreign key: a deleted
-- account sets them to null (worker/auth.ts) and the parcel stays on record.
create table parcels (
  id text primary key,
  tracking_no text not null unique,               -- "GP-7K3M9Q"
  from_station_id text not null references stations (id),
  to_station_id text not null references stations (id),
  sender_user_id text,
  sender_phone text not null,
  sender_name text,
  recipient_user_id text,
  recipient_phone text not null,
  recipient_name text,
  content text not null check (length(content) between 1 and 300),
  declared_value integer check (declared_value is null or declared_value >= 0),
  length_cm real not null check (length_cm > 0),
  width_cm real not null check (width_cm > 0),
  height_cm real not null check (height_cm > 0),
  weight_kg real not null check (weight_kg > 0 and weight_kg <= 50),
  size text not null check (size in ('S', 'M', 'L', 'XL')),
  price_fcfa integer not null check (price_fcfa >= 0),
  payment_method text not null default 'cash',
  paid_at text,
  status text not null check (status in ('deposited', 'in_transit', 'arrived', 'picked_up', 'cancelled', 'stored', 'released', 'auctioned')),
  pickup_code text check (pickup_code is null or length(pickup_code) = 6),  -- set on arrival
  locker_no integer,
  pickup_deadline text,
  reminders_sent integer not null default 0,
  created_by text,
  created_at text not null,
  in_transit_at text,
  arrived_at text,
  picked_up_at text,
  picked_up_by text,
  stored_at text,                                  -- not picked up in time, put into storage
  closed_at text,                                  -- cancelled, released or auctioned
  check (from_station_id <> to_station_id)
);
create index parcels_from_idx on parcels (from_station_id, status);
create index parcels_to_idx on parcels (to_station_id, status);
create index parcels_sender_idx on parcels (sender_user_id);
create index parcels_recipient_idx on parcels (recipient_user_id);
create index parcels_created_idx on parcels (created_at);
-- The code alone finds the parcel at its station (a locker will only get the code).
create unique index parcels_code_per_station on parcels (to_station_id, pickup_code) where status = 'arrived';

-- History of each parcel: who changed its status and when.
create table parcel_events (
  id integer primary key autoincrement,
  parcel_id text not null references parcels (id) on delete cascade,
  at text not null,
  actor text,
  status text not null,
  station_id text
);
create index parcel_events_parcel_idx on parcel_events (parcel_id, id);

-- Messages sent about parcels (e-mail for now; customers also see every status in the app), for support.
create table parcel_notifications (
  id integer primary key autoincrement,
  parcel_id text not null references parcels (id) on delete cascade,
  at text not null,
  kind text not null,          -- deposited, arrived, reminder, picked_up, stored
  channel text not null check (channel in ('sms', 'email')),
  target text not null,
  ok integer not null default 0,
  error text
);
create index parcel_notifications_at_idx on parcel_notifications (channel, at);

-- Wrong pickup codes per station, to pause code entry after too many.
create table parcel_code_failures (
  id integer primary key autoincrement,
  station_id text not null,
  at text not null
);
create index parcel_code_failures_idx on parcel_code_failures (station_id, at);
