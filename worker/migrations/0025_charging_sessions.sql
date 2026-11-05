-- Charging at a connected socket, run by station staff: staff start an outlet for a
-- cash customer or an app customer (phone, e-mail or the customer's QR code), both
-- see power, energy and price live, staff stop it (or the socket ends it when the
-- battery is full), and the charge is paid in cash at the counter or in the app
-- (wallet, Flooz, T-Money). Price per kWh, set per station with a network default.
-- greenpoints follow the kWh once a charge at a solar station is paid.
-- Code: worker/charging.ts, src/lib/charging.ts. Plan: planung/laden-vor-ort-plan.md.
-- Adds tables and columns; wallet_transactions is rebuilt to allow the 'charge'
-- type (SQLite cannot change a check), as 0010 did. Safe to apply before the new
-- Worker is deployed: the old code never writes the new type.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Price per kWh and minimum per charge, in FCFA, multiples of 5. Null = network default.
alter table stations add column charge_kwh_xof integer check (charge_kwh_xof > 0 and charge_kwh_xof % 5 = 0);
alter table stations add column charge_min_xof integer check (charge_min_xof >= 0 and charge_min_xof % 5 = 0);
-- The network default (JSON, see DEFAULT_CHARGE_TARIFF in src/lib/charging.ts); the backoffice changes it.
insert or ignore into app_settings (key, value, updated_at) values
  ('charge_tariff', '{"kwhXof":150,"minXof":100}', '2026-10-15T00:00:00.000Z');

create table charging_sessions (
  id text primary key,
  station_id text not null references stations (id) on delete cascade,
  charging_point_id text references charging_points (id) on delete set null,
  device_id text not null,
  outlet integer not null check (outlet >= 1),
  point_label text not null,
  -- The command's order number (Xingke) or idTag (OCPP), for troubleshooting.
  order_no text,
  -- Null for a cash customer without an account, and once the customer deleted the account.
  user_id text references users (id) on delete set null,
  status text not null default 'charging' check (status in ('charging', 'stopped', 'paid', 'cancelled')),
  -- Tariff copied at the start, so a later price change never changes a running or old charge.
  kwh_xof integer not null check (kwh_xof > 0),
  min_xof integer not null check (min_xof >= 0),
  -- Energy of this charge, summed from the socket's readings (see chargeReadingStatement).
  energy_wh integer not null default 0 check (energy_wh >= 0),
  last_reading_wh integer,
  -- 1 once the socket reported the outlet charging; only then does "free" or "done" end the charge.
  seen_charging integer not null default 0,
  started_by text not null,
  started_at text not null,
  stopped_by text,              -- null when the socket ended it
  stopped_at text,
  -- Final amount, set when paid.
  amount_xof integer check (amount_xof >= 0),
  payment_method text check (payment_method in ('cash', 'wallet', 'flooz', 'tmoney')),
  payment_ref text,             -- wallet transaction number or payments.id
  paid_by text,                 -- staff who took the cash, or the customer
  paid_at text
);
-- One open charge per outlet, also under parallel starts.
create unique index charging_sessions_one_open on charging_sessions (charging_point_id) where status = 'charging';
create index charging_sessions_station_idx on charging_sessions (station_id, started_at);
create index charging_sessions_user_idx on charging_sessions (user_id, started_at);
create index charging_sessions_device_idx on charging_sessions (device_id, outlet) where status in ('charging', 'stopped');

-- greenpoints of a paid charge, earned once.
alter table greenpoint_ledger add column charging_session_id text;
create unique index greenpoint_ledger_charge on greenpoint_ledger (charging_session_id) where charging_session_id is not null;

-- Flooz/T-Money payment of a charge; at most one open or successful one per charge.
alter table payments add column charging_session_id text;
create unique index payments_one_per_charge on payments (charging_session_id)
  where charging_session_id is not null and status in ('pending', 'succeeded');

-- Wallet: a charge paid from the balance is a 'charge' booking on the customer's side.
create table wallet_transactions_new (
  id text primary key,
  trx_id text not null,
  user_id text references users (id) on delete set null,
  type text not null check (type in ('transfer', 'admin_adjust', 'topup', 'charge')),
  attribute text not null check (attribute in ('send', 'received')),
  status text not null default 'success' check (status in ('success', 'pending', 'rejected')),
  amount_xof integer not null check (amount_xof > 0),
  fee_xof integer not null default 0 check (fee_xof >= 0),
  total_xof integer not null check (total_xof > 0),
  balance_after_xof integer not null,
  counterparty_user_id text references users (id) on delete set null,
  counterparty_label text,
  remark text check (remark is null or length(remark) <= 120),
  admin_id text,
  idempotency_key text,
  details text not null default '{}',
  created_at text not null,
  unique (trx_id, attribute)
);
insert into wallet_transactions_new select * from wallet_transactions;
drop table wallet_transactions;
alter table wallet_transactions_new rename to wallet_transactions;
create index wallet_transactions_user_idx on wallet_transactions (user_id, created_at);
create index wallet_transactions_created_idx on wallet_transactions (created_at);
create unique index wallet_transactions_idempotency on wallet_transactions (user_id, idempotency_key)
  where idempotency_key is not null;
