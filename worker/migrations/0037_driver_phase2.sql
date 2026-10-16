-- Driver phase 2 (planung/fahrer.md): live position of drivers on duty.
--
-- Only adds tables and columns, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- The last position a driver's app reported while on duty (in a queue, checked in at a
-- shop or on a trip). One row per driver, overwritten; no history is kept.
create table driver_positions (
  driver_id text primary key references users (id) on delete cascade,
  lat real not null,
  lng real not null,
  accuracy_m real,
  at text not null
);

-- Push notifications (planung/fahrer.md): the Firebase Cloud Messaging token of each app
-- install, so drivers hear about a new offer with the app closed. A token belongs to the
-- account last signed in on that phone; signing out removes it.
create table push_tokens (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  platform text not null,
  updated_at text not null
);
create index push_tokens_user on push_tokens (user_id);

-- Paying a trip online (planung/fahrer.md phase 2): the customer pays the fare from the
-- wallet, which they top up with Flooz or T-Money. The driver then takes no cash for it.
-- prepaid_refunded_at is set when a trip that did not happen gave the money back.
alter table delivery_jobs add column prepaid_fcfa integer not null default 0 check (prepaid_fcfa >= 0);
alter table delivery_jobs add column prepaid_refunded_at text;

-- Wallet: a trip paid from the balance is a 'trip' booking ('send'), its refund a 'trip'
-- booking ('received'). SQLite cannot change a CHECK constraint, so the table is rebuilt as in
-- 0025. Nothing references wallet_transactions, so dropping it touches no other table.
create table wallet_transactions_new (
  id text primary key,
  trx_id text not null,
  user_id text references users (id) on delete set null,
  type text not null check (type in ('transfer', 'admin_adjust', 'topup', 'charge', 'trip')),
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

-- Payout to the phone: a driver we owe money asks for it on Flooz or T-Money; an admin sends
-- it from our merchant account and marks it paid, which settles that amount in the ledger.
-- No foreign key, like driver_ledger: payouts are accounting records and stay.
create table driver_payouts (
  id text primary key,
  driver_id text not null,
  amount_fcfa integer not null check (amount_fcfa > 0),
  network text not null check (network in ('flooz', 'tmoney')),
  phone text not null,
  status text not null default 'requested' check (status in ('requested', 'paid', 'rejected')),
  reference text check (reference is null or length(reference) <= 80),
  requested_at text not null,
  decided_at text,
  decided_by text
);
create index driver_payouts_status on driver_payouts (status, requested_at);
-- At most one open request per driver.
create unique index driver_payouts_one_open on driver_payouts (driver_id) where status = 'requested';
