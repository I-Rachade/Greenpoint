-- Payments with Flooz (Moov Africa) and T-Money (Togocom), phase 2 preparation.
-- Only the Worker writes payments (worker/payments.ts). Without provider
-- credentials it runs against a simulated provider; nobody is charged.
-- See docs/ZAHLUNGEN.md.

-- Prices per station in FCFA (XOF). Null = no online payment for that service.
-- Whole francs, multiples of 5 (aggregators such as CinetPay require that).
alter table stations add column price_battery_xof integer check (price_battery_xof > 0 and price_battery_xof % 5 = 0);
alter table stations add column price_slot_xof integer check (price_slot_xof > 0 and price_slot_xof % 5 = 0);

create table payments (
  id text primary key,
  -- Sent to the provider as our order reference; unique so a retry never pays twice.
  identifier text not null unique,
  -- Null once the rider deleted the account: the payment stays (accounting records), the person does not.
  user_id text references users (id) on delete set null,
  station_id text not null references stations (id),
  reservation_id text references reservations (id) on delete set null,
  amount_xof integer not null check (amount_xof > 0),
  network text not null check (network in ('flooz', 'tmoney')),
  phone text check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),   -- wallet number; null after account deletion
  provider text not null,                     -- 'paygate', 'mock', later others
  provider_reference text,                    -- provider's transaction id (PayGate: tx_reference)
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'expired', 'cancelled')),
  failure_reason text,
  created_at text not null,
  updated_at text not null,
  paid_at text
);
create index payments_user_idx on payments (user_id, created_at);
-- At most one open or successful payment per reservation, also under parallel requests.
create unique index payments_one_per_reservation on payments (reservation_id) where status in ('pending', 'succeeded');

-- Deleting an account keeps its payments (they must be archived, see
-- planung/rechtliches-togo.md) but removes who paid and from which number.
create trigger payments_anonymize_on_user_delete before delete on users
begin
  update payments set user_id = null, phone = null where user_id = old.id;
end;
