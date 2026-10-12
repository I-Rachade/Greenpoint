-- Connected sockets (e.g. LoRa dual-outlet e-scooter chargers).
-- A device is one socket box with one or more outlets; each outlet is a row in
-- charging_points. Devices report to POST /api/devices/events (worker/devices.ts).
-- See docs/steckdosen-lora.md.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table devices (
  external_id text primary key check (external_id = upper(external_id)),  -- DevEUI or the vendor's id
  station_id text not null references stations (id) on delete cascade,
  vendor text not null default '',
  model text not null default '',
  link text not null default 'lorawan' check (link in ('lorawan', 'vendor_cloud', 'own_server')),
  outlets integer not null default 2 check (outlets between 1 and 16),
  last_seen_at text,
  created_at text not null
);
create index devices_station_idx on devices (station_id);

-- Which outlet of the device a charging point is, and what it has delivered.
alter table charging_points add column outlet integer check (outlet >= 1);
alter table charging_points add column energy_wh integer check (energy_wh >= 0);
create unique index charging_points_device_outlet on charging_points (device_id, outlet) where device_id is not null;

-- Raw messages, kept for troubleshooting.
create table device_messages (
  id integer primary key autoincrement,
  external_id text not null,
  received_at text not null,
  payload text not null   -- JSON
);
create index device_messages_device_idx on device_messages (external_id, received_at);
