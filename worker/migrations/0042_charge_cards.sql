-- Charging cards: a customer swipes a card at an OCPP charge point and the charge starts
-- without the app. Only a card an admin linked to a customer account charges; the charge is
-- that customer's, priced per kWh like any other, and paid in the app or at the counter.
-- A card swiped before anyone registered it is kept here without a customer, so the admin
-- can find its number in the backoffice (Recharges > Cartes) and link it.
-- Code: worker/charge-cards.ts, handleOcppCall() in worker/ocpp.ts, src/lib/charge-cards.ts.
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table charge_cards (
  -- The card number as the charge point sends it (OCPP idTag, at most 20 characters), upper case.
  id_tag text primary key check (length(id_tag) between 1 and 20 and id_tag = upper(id_tag)),
  -- Null: swiped, not registered yet (or the customer deleted the account). Such a card never charges.
  user_id text references users (id) on delete set null,
  label text check (label is null or length(label) <= 60),
  blocked integer not null default 0 check (blocked in (0, 1)),
  created_by text,              -- the admin who added it; null when a swipe added it
  created_at text not null,
  last_swiped_at text,
  last_device_id text
);
create index charge_cards_user_idx on charge_cards (user_id);
