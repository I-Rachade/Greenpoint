-- Battery counter per station and battery type (plan phase 3, W9, invariants R3-R5).
-- The counter changes only through events, never by setting a number:
--   issue       -1 full (a battery handed out; never below 0)
--   full        +1 full when someone marks a battery full; the "empty" stock (batteries
--               charging at the station) goes down by one, not below 0
--   correction  +-n full, owner (Betreiber) or admin only, always with a reason
--   empty_in    +1 empty: the empty battery a customer brings back (not the counter)
-- Counter = start + full - issued +- corrections. Each event has a unique request_id,
-- so a repeated tap or retry is one event.
-- battery_type_id is '' at a station that lists no battery types (one counter for the station).
-- Every event logs station, person and role (staff, owner, admin).
-- Code: worker/station-work.ts, src/lib/station-work.ts.
--
-- The existing stock fields stay what customers and the map read: each event also
-- writes station_battery_types.full_batteries and station_status.full_batteries
-- (the sum over the station's types), in the same batch.
-- Backfill: every swap point starts with today's stock, so nothing changes for customers.
-- Counters of types added later are created on their first event, from the stock then.
-- Only adds tables and rows, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table battery_counter (
  station_id text not null references stations (id) on delete cascade,
  battery_type_id text not null default '',
  full integer not null default 0 check (full >= 0),
  empty integer not null default 0 check (empty >= 0),
  updated_at text not null,
  primary key (station_id, battery_type_id)
);

create table battery_events (
  id text primary key,
  request_id text not null unique,
  station_id text not null references stations (id) on delete cascade,
  battery_type_id text not null default '',
  type text not null check (type in ('issue', 'full', 'correction', 'empty_in')),
  delta integer not null,
  full_after integer not null check (full_after >= 0),
  empty_after integer not null check (empty_after >= 0),
  reason text check (reason is null or length(reason) between 1 and 200),
  swap_id text,          -- swap_log.id when the event is part of a swap (0028)
  person_id text not null,  -- user id, no foreign key (as audit_log.actor)
  role text not null check (role in ('staff', 'owner', 'admin')),
  created_at text not null,
  check (type <> 'issue' or delta = -1),
  check (type not in ('full', 'empty_in') or delta = 1),
  check (type <> 'correction' or (delta <> 0 and reason is not null))
);
create index battery_events_station_idx on battery_events (station_id, created_at);
create index battery_events_swap_idx on battery_events (swap_id) where swap_id is not null;

insert or ignore into battery_counter (station_id, battery_type_id, full, empty, updated_at)
  select sbt.station_id, sbt.battery_type_id, sbt.full_batteries, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from station_battery_types sbt;
insert or ignore into battery_counter (station_id, battery_type_id, full, empty, updated_at)
  select st.station_id, '', st.full_batteries, 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from station_status st join stations s on s.id = st.station_id
  where s.has_battery = 1 and s.kind in ('swap', 'both')
    and not exists (select 1 from station_battery_types sbt where sbt.station_id = st.station_id);
