-- Wallet top-ups from Flooz / T-Money (Cashplus phase 2, "Add money"). A top-up
-- is asked from the provider like a reservation payment (worker/payments.ts);
-- once the provider confirms it, the wallet is credited with a 'topup' booking.
-- Code: worker/wallet-topups.ts. Only adds a table and widens the type check of
-- wallet_transactions (SQLite cannot change a check, so the table is rebuilt).
-- No trigger here: D1's query API cannot create one, and the account deletion
-- in worker/auth.ts clears the phone number itself.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table wallet_topups (
  id text primary key,
  -- Sent to the provider as our order reference ("pdw_…"); unique so a retry never pays twice.
  identifier text not null unique,
  -- Null once the person deleted the account: the record stays (accounting records).
  user_id text references users (id) on delete set null,
  amount_xof integer not null check (amount_xof > 0),
  network text not null check (network in ('flooz', 'tmoney')),
  phone text check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  provider text not null,
  provider_reference text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired', 'cancelled')),
  failure_reason text,
  -- The booking that credited the wallet; set in the same batch as the credit, so it happens once.
  wallet_tx_id text,
  created_at text not null,
  updated_at text not null,
  paid_at text
);
create index wallet_topups_user_idx on wallet_topups (user_id, created_at);

create table wallet_transactions_new (
  id text primary key,
  trx_id text not null,
  user_id text references users (id) on delete set null,
  type text not null check (type in ('transfer', 'admin_adjust', 'topup')),
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
