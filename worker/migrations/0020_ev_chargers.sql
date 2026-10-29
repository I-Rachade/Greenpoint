-- Charging stations for electric cars ("bornes VE"). The admin adds them in the
-- backoffice, then assigns each to a station; a station with at least one active
-- charger assigned shows in the app that it charges electric cars.
-- Code: src/lib/ev-chargers.ts, worker/ev-chargers.ts.
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table ev_chargers (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  connector text not null check (connector in ('type2', 'ccs2', 'chademo', 'gbt_ac', 'gbt_dc')),
  power_kw real not null check (power_kw > 0 and power_kw <= 400),
  station_id text references stations (id) on delete set null,  -- null until assigned
  is_active integer not null default 1 check (is_active in (0, 1)),
  created_at text not null
);
create index ev_chargers_station_idx on ev_chargers (station_id);
