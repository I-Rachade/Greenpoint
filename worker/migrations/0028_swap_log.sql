-- Swap log (plan phase 3, W7, invariant R6): one row per battery swap at a station.
-- A swap takes the customer's empty battery in and hands a full one out, in one batch
-- with its counter events (0027: issue -1 full, empty_in +1 empty). A first purchase
-- only hands one out (has_battery_in = 0); every other swap has both.
-- Customer types: app (account found by app QR or phone), cash (no account), fleet
-- (driver QR, billed to the driver's fleet), first_purchase.
-- Payment: cash, wallet (app customer, PIN at the counter), fleet, none (a reservation
-- completed with its code, paid outside the app as before). Lite: cash only.
-- Battery numbers are optional (scan or type); *_id stays empty until batteries get a register.
-- Code: worker/station-work.ts, src/lib/station-work.ts.
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table swap_log (
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
  payment text not null check (payment in ('cash', 'wallet', 'fleet', 'none')),
  amount_xof integer not null default 0 check (amount_xof >= 0),
  wallet_trx_id text,
  staff_id text not null,   -- who did it, user id, no foreign key (as audit_log.actor)
  role text not null check (role in ('staff', 'owner', 'admin')),
  created_at text not null,
  check (has_battery_in = (customer_type <> 'first_purchase')),
  check (customer_type <> 'fleet' or (driver_id is not null and payment = 'fleet')),
  check (payment <> 'wallet' or customer_user_id is not null)
);
create index swap_log_station_idx on swap_log (station_id, created_at);
create index swap_log_driver_idx on swap_log (driver_id) where driver_id is not null;
