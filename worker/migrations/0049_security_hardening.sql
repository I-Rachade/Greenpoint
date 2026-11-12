-- Security review 2026-10-19 (worker/auth.ts, worker/wallet.ts).
-- Only adds columns, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- How often the account was locked for wrong PINs in a row since the last right PIN: each new
-- lock lasts longer, so guessing the PIN 5 tries at a time no longer works out in a few weeks.
alter table users add column pin_lock_count integer not null default 0;

-- The request that used a counter code. Batches that load or spend with the code check this
-- instead of the time, so two requests in the same millisecond cannot both use it.
alter table credit_codes add column used_by_request text;

-- Codes staff type at the counter for someone else (greenpoint rewards, Green Credit): every try
-- is written down first and taken back when the code was right, so a staff member who types
-- many wrong codes is stopped for a while, also with parallel requests (worker/code-tries.ts).
create table counter_code_tries (
  staff_id text not null,
  kind text not null,
  at text not null
);
create index counter_code_tries_idx on counter_code_tries (staff_id, at);
