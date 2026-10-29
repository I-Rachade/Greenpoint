-- Reservation by type (plan phase 4): a reservation says what it holds.
--   kind    swap            a full battery of one battery type
--           charging_point  a place to charge: a motorbike outlet or an electric car charger
--   target  swap: battery_types.id (null at a station without battery types)
--           charging_point: charging_points.id (connected motorbike outlet) or
--           ev_chargers.id (car charger); null = a free place counted by the staff
--           (station without connected outlets).
-- type ('battery' / 'slot') stays as it was: swap = battery, charging_point = slot.
-- A reservation holds without touching the battery counter (0027): what a customer can
-- reserve is the full batteries of the type minus the active swap reservations of that
-- type; the counter drops by 1 only when the swap hands the battery out.
--
-- Backfill: kind from type; target from the outlet a completed slot reservation used,
-- and the station's battery type where the station swaps exactly one type.
-- The trigger keeps kind right for rows the previous Worker still writes (type only)
-- between applying this migration and deploying the new Worker.
--
-- reservation_code_failures: wrong pickup codes typed for a reservation. After 5 within
-- 15 minutes the reservation takes no code for a while (as parcel_code_failures, 0005).
--
-- Code: worker/reservations.ts, worker/api.ts, src/lib/reservations.ts.
-- Only adds columns, a table, an index and a trigger, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table reservations add column kind text not null default 'swap' check (kind in ('swap', 'charging_point'));
alter table reservations add column target text;

update reservations set kind = 'charging_point' where type = 'slot';
update reservations set target = charging_point_id where type = 'slot' and charging_point_id is not null;
update reservations
  set target = (select battery_type_id from station_battery_types where station_id = reservations.station_id)
  where type = 'battery' and (select count(*) from station_battery_types where station_id = reservations.station_id) = 1;

create index reservations_target_active_idx on reservations (station_id, kind, target) where status = 'active';

create trigger reservations_kind_from_type after insert on reservations
when new.type = 'slot' and new.kind = 'swap'
begin
  update reservations set kind = 'charging_point' where id = new.id;
end;

create table reservation_code_failures (
  id integer primary key autoincrement,
  reservation_id text not null,
  station_id text not null,
  at text not null
);
create index reservation_code_failures_idx on reservation_code_failures (reservation_id, at);
