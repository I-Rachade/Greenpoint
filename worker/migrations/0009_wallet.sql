-- Wallet (Cashplus phase 1): a balance in FCFA per user, transfers between
-- users, fees and limits per product, admin corrections. Code: worker/wallet.ts,
-- src/lib/wallet.ts; plan: planung/cashplus-plan.md. Numbered 0009 because 0007
-- is the driver role (PR #16). Only adds tables, so it is safe to apply before
-- the new Worker is deployed. The module stays off ('wallet_enabled' = '0')
-- until the legal question (BCEAO e-money) is settled; admins can test it.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Switches and values the backoffice changes at run time.
create table app_settings (
  key text primary key,
  value text not null,
  updated_by text,
  updated_at text not null
);
insert into app_settings (key, value, updated_at) values ('wallet_enabled', '0', '2026-10-13T00:00:00.000Z');

-- One wallet per user, in FCFA (whole francs). The check makes every booking
-- that would overdraw a wallet fail, and with it the whole batch it is part of.
-- Deleting an account is refused while the balance is not 0 (worker/auth.ts).
create table wallets (
  user_id text primary key references users (id),
  currency text not null default 'XOF' check (currency = 'XOF'),
  balance_xof integer not null default 0 check (balance_xof >= 0),
  status text not null default 'active' check (status in ('active', 'frozen')),
  created_at text not null,
  updated_at text not null
);

-- Fee and limits per product (spec: transaction_settings). 0 = no limit.
create table wallet_fee_settings (
  product text primary key check (product in ('transfer')),
  fixed_xof integer not null default 0 check (fixed_xof >= 0),
  percent real not null default 0 check (percent >= 0 and percent <= 50),
  min_xof integer not null default 0 check (min_xof >= 0),
  max_xof integer not null default 0 check (max_xof >= 0),
  daily_xof integer not null default 0 check (daily_xof >= 0),
  monthly_xof integer not null default 0 check (monthly_xof >= 0),
  is_active integer not null default 1,
  updated_by text,
  updated_at text not null
);
insert into wallet_fee_settings (product, fixed_xof, percent, min_xof, max_xof, daily_xof, monthly_xof, updated_at)
  values ('transfer', 0, 0, 100, 500000, 1000000, 5000000, '2026-10-13T00:00:00.000Z');

-- The ledger. A transfer is two rows with the same trx_id: 'send' on the
-- sender's side (carries the fee) and 'received' on the recipient's side.
-- The fee is only on the paying side, so profit is never counted twice.
create table wallet_transactions (
  id text primary key,
  trx_id text not null,
  -- Null once the person deleted the account: the booking stays (accounting records).
  user_id text references users (id) on delete set null,
  type text not null check (type in ('transfer', 'admin_adjust')),
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
  -- Sent by the app with each payment; a retry with the same key never pays twice.
  idempotency_key text,
  details text not null default '{}',   -- JSON: fee breakdown, IP, country, device
  created_at text not null,
  unique (trx_id, attribute)
);
create index wallet_transactions_user_idx on wallet_transactions (user_id, created_at);
create index wallet_transactions_created_idx on wallet_transactions (created_at);
create unique index wallet_transactions_idempotency on wallet_transactions (user_id, idempotency_key)
  where idempotency_key is not null;

-- Deleting an account removes the person's name from the other side's history.
create trigger wallet_transactions_anonymize_on_user_delete before delete on users
begin
  update wallet_transactions set counterparty_label = null where counterparty_user_id = old.id;
end;
