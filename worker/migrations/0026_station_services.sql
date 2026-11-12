-- Service unlock per station (plan W11, invariant R8). A service runs at a station
-- only while its global switch is on (parcel module, driver module, Lite version;
-- worker/features.ts) AND the station is unlocked for it here. The station owner asks
-- for a service, an admin decides; an admin can also switch one on or off directly.
-- Services (src/lib/station-services.ts):
--   swap      battery swap point          charging  motorbike outlets
--   ev        electric car chargers       parcels   parcel counter and lockers
--   drivers   drivers queue at the station and hand parcels over there
-- No row = not unlocked. status is the latest request (null = nobody asked).
-- Code: worker/services.ts.
--
-- Backfill: every station keeps exactly what it offers today. Swap and outlets follow
-- stations.kind (and any outlet already registered), car chargers the chargers assigned
-- to the station, parcels the active parcel depot; drivers queue today at every active
-- parcel depot, so those stations get drivers too.
-- The triggers keep that rule for what an admin sets up later (new station, kind
-- changed, depot switched on, outlet registered, charger assigned): the admin set it up, so it is unlocked.
-- They only add missing rows, so a service an admin switched off stays off. They use
-- "where not exists", not "insert or ignore": the conflict policy of the triggering
-- statement (the upserts in worker/parcels.ts) would override an OR IGNORE in the body.
-- Only adds a table, rows and triggers, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table station_services (
  station_id text not null references stations (id) on delete cascade,
  service text not null check (service in ('swap', 'charging', 'ev', 'parcels', 'drivers')),
  unlocked integer not null default 0 check (unlocked in (0, 1)),
  status text check (status in ('pending', 'approved', 'rejected')),
  requested_by text,  -- user id, no foreign key (as audit_log.actor)
  requested_at text,
  decided_by text,
  decided_at text,
  primary key (station_id, service)
);
create index station_services_pending_idx on station_services (status) where status = 'pending';

insert or ignore into station_services (station_id, service, unlocked, status)
  select id, 'swap', 1, 'approved' from stations where has_battery = 1 and kind in ('swap', 'both');
insert or ignore into station_services (station_id, service, unlocked, status)
  select id, 'charging', 1, 'approved' from stations
  where (has_battery = 1 and kind in ('charging', 'both'))
     or exists (select 1 from charging_points p where p.station_id = stations.id);
insert or ignore into station_services (station_id, service, unlocked, status)
  select distinct station_id, 'ev', 1, 'approved' from ev_chargers where station_id is not null;
insert or ignore into station_services (station_id, service, unlocked, status)
  select station_id, 'parcels', 1, 'approved' from parcel_depots where is_active = 1;
insert or ignore into station_services (station_id, service, unlocked, status)
  select station_id, 'drivers', 1, 'approved' from parcel_depots where is_active = 1;

create trigger station_services_on_station_insert after insert on stations
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.id, 'swap', 1, 'approved' where new.has_battery = 1 and new.kind in ('swap', 'both')
      and not exists (select 1 from station_services where station_id = new.id and service = 'swap');
  insert into station_services (station_id, service, unlocked, status)
    select new.id, 'charging', 1, 'approved' where new.has_battery = 1 and new.kind in ('charging', 'both')
      and not exists (select 1 from station_services where station_id = new.id and service = 'charging');
end;

create trigger station_services_on_station_kind after update of kind, has_battery on stations
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.id, 'swap', 1, 'approved' where new.has_battery = 1 and new.kind in ('swap', 'both')
      and not exists (select 1 from station_services where station_id = new.id and service = 'swap');
  insert into station_services (station_id, service, unlocked, status)
    select new.id, 'charging', 1, 'approved' where new.has_battery = 1 and new.kind in ('charging', 'both')
      and not exists (select 1 from station_services where station_id = new.id and service = 'charging');
end;

create trigger station_services_on_depot_insert after insert on parcel_depots when new.is_active = 1
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'parcels', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'parcels');
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'drivers', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'drivers');
end;

create trigger station_services_on_depot_update after update of is_active on parcel_depots when new.is_active = 1
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'parcels', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'parcels');
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'drivers', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'drivers');
end;

create trigger station_services_on_point_insert after insert on charging_points
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'charging', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'charging');
end;

create trigger station_services_on_charger_insert after insert on ev_chargers when new.station_id is not null
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'ev', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'ev');
end;

create trigger station_services_on_charger_update after update of station_id on ev_chargers when new.station_id is not null
begin
  insert into station_services (station_id, service, unlocked, status)
    select new.station_id, 'ev', 1, 'approved'
    where not exists (select 1 from station_services where station_id = new.station_id and service = 'ev');
end;
