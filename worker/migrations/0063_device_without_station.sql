-- A socket can be registered before it is installed: devices.station_id may be null until an
-- admin assigns the box to a station (worker/devices.ts assignDeviceStation). A box without a
-- station has no charging points; they are created when it gets one. Deleting a station now
-- leaves its sockets registered without a station (their charging points go with it, as before).
--
-- SQLite cannot drop a NOT NULL, so devices is rebuilt with the same columns in the same order.
-- The traps (see 0030_driver_role.sql):
--   * D1 always enforces foreign keys. Dropping devices runs an implicit DELETE FROM devices
--     whose ON DELETE CASCADE would empty device_commands and ocpp_transactions, so both are
--     copied aside and emptied first, and put back after the rename.
--   * The trigger charging_sessions_partner_from_device reads devices: a rename fails while a
--     trigger names a missing table, so it is dropped first and created again below.
-- Safe to apply before the new Worker is deployed: the old Worker always sets a station.
-- Code: worker/devices.ts, src/components/backoffice/devices-manager.tsx.
-- Test: worker/migration-0063.test.ts.
-- Apply: npx wrangler d1 migrations apply DB --remote
PRAGMA defer_foreign_keys = on;

create table m63_device_commands as select * from device_commands;
create table m63_ocpp_transactions as select * from ocpp_transactions;
delete from device_commands;
delete from ocpp_transactions;

drop trigger charging_sessions_partner_from_device;

create table devices_new (
  external_id text primary key check (external_id = upper(external_id)),  -- DevEUI or the vendor's id
  station_id text references stations (id) on delete set null,  -- null until assigned
  vendor text not null default '',
  model text not null default '',
  link text not null default 'lorawan' check (link in ('lorawan', 'vendor_cloud', 'own_server')),
  outlets integer not null default 2 check (outlets between 1 and 16),
  last_seen_at text,
  created_at text not null,
  vendor_ref text,
  protocol text check (protocol in ('ocpp1.6')),
  ocpp_key_hash text,
  partner_id text references point_partners (id),
  qr_token text,
  qr_code text
);
insert into devices_new select * from devices;
drop table devices;
alter table devices_new rename to devices;

create index devices_station_idx on devices (station_id);
create index devices_partner_idx on devices (partner_id) where partner_id is not null;
create unique index devices_qr_token on devices (qr_token) where qr_token is not null;
create unique index devices_qr_code on devices (qr_code) where qr_code is not null;

create trigger charging_sessions_partner_from_device after insert on charging_sessions
begin
  update charging_sessions set partner_id = (select partner_id from devices where external_id = new.device_id) where id = new.id;
end;

insert into device_commands select * from m63_device_commands;
insert into ocpp_transactions select * from m63_ocpp_transactions;
drop table m63_device_commands;
drop table m63_ocpp_transactions;
