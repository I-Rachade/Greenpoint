-- Charging cards with their own credit: a customer swipes a card at an OCPP charge point and
-- the charge starts without the app, as long as the card's balance covers the station's
-- minimum price. The charge stops when the balance is used up, and its price is taken from
-- the card when it ends. Station staff top a card up in cash at the counter; an admin can
-- correct a balance. A card may be linked to a customer account (greenpoints, the app),
-- but does not need one. A card swiped for the first time is added with no credit, so its
-- number shows in the backoffice and at the counter.
-- charging_sessions is rebuilt to allow the payment method 'card' (SQLite cannot change a
-- check), as 0025 did for wallet_transactions, and gets the column charge_card.
-- Code: worker/charge-cards.ts, worker/charging.ts (openCardCharge, settleCardCharges, cardStops),
-- worker/ocpp.ts, src/lib/charge-cards.ts.
-- Safe to apply before the new Worker is deployed: the old code never writes 'card' or charge_card.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table charge_cards (
  -- The card number as the charge point sends it (OCPP idTag, at most 20 characters), upper case.
  id_tag text primary key check (length(id_tag) between 1 and 20 and id_tag = upper(id_tag)),
  -- Optional: the customer the card belongs to (greenpoints, shown in the app).
  user_id text references users (id) on delete set null,
  label text check (label is null or length(label) <= 60),
  blocked integer not null default 0 check (blocked in (0, 1)),
  -- Credit in FCFA. Can go below 0 when a stop reached the charge point late; such a card
  -- starts nothing until it is topped up again.
  balance_xof integer not null default 0,
  created_by text,              -- the admin or staff who added it; null when a swipe added it
  created_at text not null,
  last_swiped_at text,
  last_device_id text
);
create index charge_cards_user_idx on charge_cards (user_id);

-- Every change of a card's balance.
create table charge_card_transactions (
  id text primary key,
  id_tag text not null,         -- no foreign key: the history stays when a card is deleted
  type text not null check (type in ('topup', 'charge', 'adjust')),
  amount_xof integer not null check (amount_xof <> 0),   -- + credit, - debit
  balance_after_xof integer not null,
  station_id text,              -- where it was topped up or charged
  charging_session_id text,     -- type 'charge': the charge it paid
  reason text check (reason is null or length(reason) <= 120),
  created_by text,              -- staff or admin; null for a charge
  created_at text not null
);
create index charge_card_transactions_card_idx on charge_card_transactions (id_tag, created_at);
create index charge_card_transactions_station_idx on charge_card_transactions (station_id, created_at);
-- A charge is taken from the card once.
create unique index charge_card_transactions_one_per_charge on charge_card_transactions (charging_session_id)
  where charging_session_id is not null;

create table charging_sessions_new (
  id text primary key,
  station_id text not null references stations (id) on delete cascade,
  charging_point_id text references charging_points (id) on delete set null,
  device_id text not null,
  outlet integer not null check (outlet >= 1),
  point_label text not null,
  order_no text,
  user_id text references users (id) on delete set null,
  status text not null default 'charging' check (status in ('charging', 'stopped', 'paid', 'cancelled')),
  kwh_xof integer not null check (kwh_xof > 0),
  min_xof integer not null check (min_xof >= 0),
  energy_wh integer not null default 0 check (energy_wh >= 0),
  last_reading_wh integer,
  seen_charging integer not null default 0,
  started_by text not null,
  started_at text not null,
  stopped_by text,
  stopped_at text,
  amount_xof integer check (amount_xof >= 0),
  payment_method text check (payment_method in ('cash', 'wallet', 'flooz', 'tmoney', 'card')),
  payment_ref text,
  paid_by text,
  paid_at text,
  partner_id text references point_partners (id),
  -- The card that started the charge and pays it.
  charge_card text
);
insert into charging_sessions_new (id, station_id, charging_point_id, device_id, outlet, point_label, order_no, user_id, status,
  kwh_xof, min_xof, energy_wh, last_reading_wh, seen_charging, started_by, started_at, stopped_by, stopped_at, amount_xof,
  payment_method, payment_ref, paid_by, paid_at, partner_id)
select id, station_id, charging_point_id, device_id, outlet, point_label, order_no, user_id, status,
  kwh_xof, min_xof, energy_wh, last_reading_wh, seen_charging, started_by, started_at, stopped_by, stopped_at, amount_xof,
  payment_method, payment_ref, paid_by, paid_at, partner_id
from charging_sessions;
drop table charging_sessions;
alter table charging_sessions_new rename to charging_sessions;
create unique index charging_sessions_one_open on charging_sessions (charging_point_id) where status = 'charging';
create index charging_sessions_station_idx on charging_sessions (station_id, started_at);
create index charging_sessions_user_idx on charging_sessions (user_id, started_at);
create index charging_sessions_device_idx on charging_sessions (device_id, outlet) where status in ('charging', 'stopped');
create index charging_sessions_partner_idx on charging_sessions (partner_id, paid_at) where partner_id is not null;
create index charging_sessions_card_idx on charging_sessions (charge_card) where charge_card is not null;
create trigger charging_sessions_partner_from_device after insert on charging_sessions
begin
  update charging_sessions set partner_id = (select partner_id from devices where external_id = new.device_id) where id = new.id;
end;
