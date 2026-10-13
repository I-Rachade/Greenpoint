-- greenpoint: the green label of poinderecharge. It counts the CO2 a person saves
-- by riding electric instead of petrol; 100 g saved = 1 greenpoint, redeemed for
-- free services, discounts and partner rewards. Never money: not bought, not paid
-- out, not transferable, separate from the wallet. Rules: planung/greenpoint-nutzung.md;
-- code: worker/greenpoint.ts, src/lib/greenpoint.ts. Numbered 0015 because 0007
-- (drivers, PR #16) and 0014 (operator accounts, PR #25) are taken by open PRs.
-- Only adds tables and a column, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- The vehicle a rider uses; sets the CO2 of a swap or charge. Null = scooter.
alter table users add column greenpoint_vehicle text
  check (greenpoint_vehicle in ('scooter', 'tricycle', 'ebike', 'moped'));

-- Every movement, so the balance and the CO2 total are sums and can be checked.
-- kind: swap / charge (earned), visit (entered by staff without reservation),
-- redeem (points spent), admin_adjust (correction).
create table greenpoint_ledger (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  kind text not null check (kind in ('swap', 'charge', 'visit', 'redeem', 'admin_adjust')),
  co2_grams integer not null default 0 check (co2_grams >= 0),
  points integer not null,
  vehicle text,
  station_id text references stations (id) on delete set null,
  reservation_id text references reservations (id) on delete set null,
  redemption_id text,
  created_by text,
  created_at text not null
);
create index greenpoint_ledger_user_idx on greenpoint_ledger (user_id, created_at);
-- A reservation earns once, even if completion runs twice.
create unique index greenpoint_ledger_reservation on greenpoint_ledger (reservation_id) where reservation_id is not null;
-- A redemption takes its points once.
create unique index greenpoint_ledger_redemption on greenpoint_ledger (redemption_id) where redemption_id is not null;

-- Rewards: from the network (poinderecharge pays) or from a partner (the partner pays).
create table greenpoint_rewards (
  id text primary key,
  title text not null,
  description text not null default '',
  cost_points integer not null check (cost_points > 0),
  provider text not null default 'network' check (provider in ('network', 'partner')),
  partner_name text,
  stock integer check (stock is null or stock >= 0),   -- null = unlimited
  valid_until text,
  is_active integer not null default 1,
  created_at text not null,
  updated_at text not null
);

-- A code the rider shows; staff enter it, then the points are taken.
create table greenpoint_redemptions (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  reward_id text not null references greenpoint_rewards (id),
  code text not null check (length(code) = 6),
  cost_points integer not null,
  status text not null default 'open' check (status in ('open', 'used', 'cancelled')),
  expires_at text not null,
  used_at text,
  used_by text,
  station_id text references stations (id) on delete set null,
  created_at text not null
);
create index greenpoint_redemptions_code_idx on greenpoint_redemptions (code) where status = 'open';
create unique index greenpoint_redemptions_one_open on greenpoint_redemptions (user_id) where status = 'open';

-- CO2 factors (JSON, see DEFAULT_FACTORS in src/lib/greenpoint.ts); the backoffice changes them.
insert or ignore into app_settings (key, value, updated_at) values
  ('greenpoint_factors', '{"batteryGrams":{"scooter":1500,"moped":2000,"tricycle":4000,"ebike":500},"kwhGrams":1000}', '2026-10-13T00:00:00.000Z');

-- The main reward, decided on 2026-10-13: a free battery swap for 150 greenpoints.
insert or ignore into greenpoint_rewards (id, title, description, cost_points, provider, created_at, updated_at) values
  ('free-swap', 'Échange de batterie offert', 'Un échange de batterie gratuit dans une station poinderecharge.', 150, 'network',
   '2026-10-13T00:00:00.000Z', '2026-10-13T00:00:00.000Z');
