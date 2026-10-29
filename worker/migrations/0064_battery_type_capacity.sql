-- Places per battery type: a swap point that swaps several battery types (e.g. Omnivoltaic
-- 60 V, Omnivoltaic 72 V, Spiro 72 V) has its own number of places for each. A "full" tap
-- on a type's counter stays within that type's places, and lowering them in the backoffice
-- brings that type's full batteries down to it (a correction in the log, as before).
-- stations.battery_capacity stays what the app reads: at a station with types it is the sum
-- of their places, written by the backoffice with them. Without types it is the one number.
-- capacity = 0 means not set: the type then counts against the station's places (as before).
--
-- Backfill: each station's places are shared out over its types, brands and models sorted,
-- the first ones taking the remainder; a type never gets fewer places than it has full
-- batteries now, so no counter is over its places. The station's number becomes the sum.
-- Stations without a limit (battery_capacity 0) keep none: their types stay at 0.
-- Code: worker/battery-types.ts, worker/station-work.ts, src/components/admin-stations.tsx.
-- Test: worker/migration-0064.test.ts.
-- Only adds a column and fills it, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table station_battery_types add column capacity integer not null default 0 check (capacity >= 0);

update station_battery_types set capacity = (
  select max(x.share, station_battery_types.full_batteries) from (
    select sbt.station_id, sbt.battery_type_id,
           s.battery_capacity / count(*) over (partition by sbt.station_id)
             + case when row_number() over (partition by sbt.station_id order by t.brand, t.name)
                         <= s.battery_capacity % count(*) over (partition by sbt.station_id) then 1 else 0 end as share
    from station_battery_types sbt
    join stations s on s.id = sbt.station_id
    join battery_types t on t.id = sbt.battery_type_id
    where s.battery_capacity > 0
  ) x
  where x.station_id = station_battery_types.station_id and x.battery_type_id = station_battery_types.battery_type_id
)
where station_id in (select id from stations where battery_capacity > 0);

update stations set battery_capacity = (select sum(capacity) from station_battery_types where station_id = stations.id)
where battery_capacity > 0 and exists (select 1 from station_battery_types where station_id = stations.id);
