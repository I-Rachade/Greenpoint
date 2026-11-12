-- Adds the Schuko plug (household socket, CEE 7/4, for slow charging with the
-- car's own cable) to the plug types of electric-car chargers. SQLite cannot
-- change a check constraint, so the table is rebuilt with the same columns and
-- rows. Nothing references ev_chargers.
-- The old Worker never writes 'schuko', so it is safe to apply before deploying.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table ev_chargers_new (
  id text primary key,
  name text not null check (length(name) between 1 and 80),
  connector text not null check (connector in ('type2', 'ccs2', 'chademo', 'gbt_ac', 'gbt_dc', 'schuko')),
  power_kw real not null check (power_kw > 0 and power_kw <= 400),
  station_id text references stations (id) on delete set null,  -- null until assigned
  is_active integer not null default 1 check (is_active in (0, 1)),
  created_at text not null
);
insert into ev_chargers_new (id, name, connector, power_kw, station_id, is_active, created_at)
  select id, name, connector, power_kw, station_id, is_active, created_at from ev_chargers;
drop table ev_chargers;
alter table ev_chargers_new rename to ev_chargers;
create index ev_chargers_station_idx on ev_chargers (station_id);
