-- What a station offers, each part optional and combinable:
--   battery swap point      stations.kind in ('swap', 'both') with battery_capacity
--   battery charging point  stations.kind in ('charging', 'both'); its places are the
--                           station's connected sockets (charging_points with a device)
--   parcel counter          parcel_depots.is_active and has_counter
--   parcel lockers          parcel_depots.is_active and lockers > 0
-- A station without swap and charging (has_battery = 0) is a parcel point only; its
-- kind column is then ignored (the app calls it "parcel"). Code: worker/api.ts.
-- Only adds columns and recounts, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table stations add column has_battery integer not null default 1 check (has_battery in (0, 1));

-- 0 = lockers only, nobody takes parcels at a counter.
alter table parcel_depots add column has_counter integer not null default 1 check (has_counter in (0, 1));

-- Charging places are now the connected outlets, no longer a number typed in.
update stations set charging_slots =
  (select count(*) from charging_points p where p.station_id = stations.id and p.device_id is not null);
update station_status set free_slots =
  min(free_slots, (select s.charging_slots from stations s where s.id = station_status.station_id));
