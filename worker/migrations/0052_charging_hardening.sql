-- Charging hardening 2026-10-19 (worker/charging.ts, worker/charge-cards.ts, worker/ocpp.ts).
-- Adds columns and lets counter codes be used for a charge; the old Worker keeps working on it,
-- so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- A Green Credit charge (QR code or linked card) takes its limit from the credit when it starts
-- ("charge" booking with status 'pending' and details.hold): credit_held_xof is that amount,
-- credit_hold_trx its transaction number. When the charge ends, the price is booked and the rest
-- comes back in the same batch ("charge" 'received' with the same number). Null: a charge
-- started before this migration, paid the old way from the balance when it ends.
alter table charging_sessions add column credit_held_xof integer check (credit_held_xof is null or credit_held_xof >= 0);
alter table charging_sessions add column credit_hold_trx text;

-- The OCPP transaction of the charge (ocpp_transactions.id), set at StartTransaction: meter
-- readings and the stop that name this transaction reach this charge even once it is stopped.
alter table charging_sessions add column ocpp_transaction_id integer;

-- Staff start a charge for an app customer only with the customer's one-time counter code
-- (shown in the app after the PIN): a code may now also be used for 'charge'. SQLite cannot
-- change a check, so the table is rebuilt; nothing references it.
create table credit_codes_new (
  code_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at text not null,
  expires_at text not null,
  used_at text,
  used_at_station text,
  used_for text check (used_for in ('topup', 'swap', 'charge')),
  used_by_request text
);
insert into credit_codes_new (code_hash, user_id, created_at, expires_at, used_at, used_at_station, used_for, used_by_request)
  select code_hash, user_id, created_at, expires_at, used_at, used_at_station, used_for, used_by_request from credit_codes;
drop table credit_codes;
alter table credit_codes_new rename to credit_codes;
create index credit_codes_user_idx on credit_codes (user_id, created_at);
