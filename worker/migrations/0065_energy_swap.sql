-- Omnivoltaic swaps paid by the energy given (procedure "Fiche rapide de formation - agent de swap").
-- A battery type can be priced by energy instead of the station's one swap price: the customer
-- pays (% OUT - % IN) / 100 x the type's price for 100 %, rounded to the nearest 5 FCFA, only by
-- T-Money or Flooz straight to the brand's merchant number, and the agent keeps the transaction id.
--
-- battery_types: pricing ('station' = the station's price as before, 'energy' = by energy),
--   price_full_xof (price for 100 %), ussd_tmoney / ussd_flooz (the code the customer dials,
--   "{montant}" standing for the amount).
-- swap_log: the batteries' charge in and out (%), the vehicle's plate and the customer's name,
--   the state of the battery brought back, and the Mobile Money network and transaction id
--   (one transaction id pays one swap). A new payment 'mobile_money': not cash at the station
--   (worker/station-cash.ts), the money goes to the brand.
-- swap_log is rebuilt for its payment check (SQLite cannot change a check in place); every row
-- is copied as it is, the new columns stay empty for the swaps before.
-- Code: shared/energy-swap.ts, worker/station-work.ts, worker/battery-types.ts,
-- src/components/station-work/swap-page.tsx, src/components/admin-stations.tsx.
-- Test: worker/migration-0065.test.ts.
-- The old Worker keeps working on the new tables (it never writes the new columns or payment),
-- so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

PRAGMA defer_foreign_keys = on;

alter table battery_types add column pricing text not null default 'station' check (pricing in ('station', 'energy'));
-- A type priced by energy always has its price for 100 %.
alter table battery_types add column price_full_xof integer
  check ((price_full_xof is null or price_full_xof between 1 and 1000000) and (pricing <> 'energy' or price_full_xof is not null));
alter table battery_types add column ussd_tmoney text check (ussd_tmoney is null or length(ussd_tmoney) between 1 and 80);
alter table battery_types add column ussd_flooz text check (ussd_flooz is null or length(ussd_flooz) between 1 and 80);

create table swap_log_new (
  id text primary key,
  request_id text not null unique,
  station_id text not null references stations (id) on delete cascade,
  battery_type_id text not null default '',
  has_battery_in integer not null check (has_battery_in in (0, 1)),
  battery_in_id text,
  battery_in_label text check (battery_in_label is null or length(battery_in_label) between 1 and 60),
  battery_out_id text,
  battery_out_label text check (battery_out_label is null or length(battery_out_label) between 1 and 60),
  customer_type text not null check (customer_type in ('app', 'cash', 'fleet', 'first_purchase')),
  customer_user_id text references users (id) on delete set null,
  driver_id text references users (id) on delete set null,
  fleet_manager_id text,
  reservation_id text references reservations (id) on delete set null,
  payment text not null check (payment in ('cash', 'wallet', 'fleet', 'none', 'mobile_money')),
  amount_xof integer not null default 0 check (amount_xof >= 0),
  wallet_trx_id text,
  staff_id text not null,   -- who did it, user id, no foreign key (as audit_log.actor)
  role text not null check (role in ('staff', 'owner', 'admin')),
  created_at text not null,
  owner text check (owner in ('operator', 'poinderecharge')),
  -- 0065: swaps priced by energy.
  in_pct integer check (in_pct is null or in_pct between 0 and 100),
  out_pct integer check (out_pct is null or out_pct between 0 and 100),
  plate text check (plate is null or length(plate) between 2 and 20),
  customer_name text check (customer_name is null or length(customer_name) between 1 and 80),
  battery_in_condition text check (battery_in_condition is null or battery_in_condition in ('ok', 'damaged', 'leak', 'hot', 'smell')),
  mm_network text check (mm_network is null or mm_network in ('tmoney', 'flooz')),
  mm_ref text check (mm_ref is null or length(mm_ref) between 4 and 40),
  check (has_battery_in = (customer_type <> 'first_purchase')),
  check (customer_type <> 'fleet' or (driver_id is not null and payment = 'fleet')),
  check (payment <> 'wallet' or customer_user_id is not null),
  check ((in_pct is null) = (out_pct is null)),
  check (out_pct is null or out_pct > in_pct),
  check ((payment = 'mobile_money') = (mm_network is not null and mm_ref is not null))
);

insert into swap_log_new (id, request_id, station_id, battery_type_id, has_battery_in, battery_in_id, battery_in_label, battery_out_id,
    battery_out_label, customer_type, customer_user_id, driver_id, fleet_manager_id, reservation_id, payment, amount_xof, wallet_trx_id,
    staff_id, role, created_at, owner)
  select id, request_id, station_id, battery_type_id, has_battery_in, battery_in_id, battery_in_label, battery_out_id,
    battery_out_label, customer_type, customer_user_id, driver_id, fleet_manager_id, reservation_id, payment, amount_xof, wallet_trx_id,
    staff_id, role, created_at, owner from swap_log;

-- Fails the whole migration if a row did not make it.
create table m65_check (ok integer not null check (ok = 1));
insert into m65_check select (select count(*) from swap_log_new) = (select count(*) from swap_log);
drop table m65_check;

drop table swap_log;
alter table swap_log_new rename to swap_log;

create index swap_log_station_idx on swap_log (station_id, created_at);
create index swap_log_driver_idx on swap_log (driver_id) where driver_id is not null;
-- One Mobile Money transaction pays one swap.
create unique index swap_log_mm_ref_idx on swap_log (mm_network, mm_ref) where mm_ref is not null;
