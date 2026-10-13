-- Battery types: motorbike brands (battery operators such as Spiro or
-- Omnivoltaic) each use their own swap batteries. An admin keeps the list in
-- the backoffice and says, per station, which types its swap point swaps.
-- Charging needs no type: the station's charging sockets take any battery.
-- A swap point with no type listed says nothing about it. Code: src/lib/battery-types.ts, worker/api.ts.
-- Only adds tables, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table battery_types (
  id text primary key,
  brand text not null check (length(brand) between 1 and 60),   -- motorbike brand or battery operator
  name text not null check (length(name) between 1 and 80),     -- model, e.g. "72V 40Ah"
  is_active integer not null default 1 check (is_active in (0, 1)),
  created_at text not null,
  unique (brand, name)
);

-- Battery types a station's swap point swaps.
create table station_battery_types (
  station_id text not null references stations (id) on delete cascade,
  battery_type_id text not null references battery_types (id) on delete cascade,
  primary key (station_id, battery_type_id)
);
create index station_battery_types_type_idx on station_battery_types (battery_type_id);
