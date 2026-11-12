-- Green Credit: the wallet becomes a closed prepaid credit for energy (plan:
-- planung/credit-qr-plan.md in the project folder). It is loaded in cash at the counter of a
-- station an admin designated (stations.green_credit) and spent there on what belongs to
-- poinderecharge: a charge started by QR code (paid in advance, stopped when the credit is
-- used up), a battery swap, or a charge started with a charging card linked to the account.
-- No transfers, no withdrawals, no online top-ups. Every payment needs the customer's PIN,
-- typed on their own phone: at the counter the app shows a one-time code (credit_codes) that
-- staff scan.
--
-- Code: worker/wallet.ts, worker/charging.ts (selfCharge, creditStops, settlePrepaidCharges),
-- worker/charge-cards.ts, worker/station-work.ts, worker/station-cash.ts.
-- Only adds columns, a table and rows, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Designated in the backoffice: loads and accepts Green Credit. Off everywhere at first.
alter table stations add column green_credit integer not null default 0 check (green_credit in (0, 1));

-- Highest balance a customer may hold, in FCFA (0 = no limit). Changed in the backoffice.
insert into app_settings (key, value, updated_at) values ('green_credit_max_xof', '50000', '2026-10-18T00:00:00.000Z');

-- A counter load is booked at the station that took the cash (counted in its cash handover).
alter table wallet_transactions add column station_id text references stations (id) on delete set null;
create index wallet_transactions_station_idx on wallet_transactions (station_id, created_at) where station_id is not null;

-- The one-time code the app shows after the customer typed their PIN on their phone: staff
-- scan it to load the credit or to take a swap from it. Only its hash is kept; it holds a
-- few minutes and is used once. A new code voids the customer's older ones.
create table credit_codes (
  code_hash text primary key,
  user_id text not null references users (id) on delete cascade,
  created_at text not null,
  expires_at text not null,
  used_at text,
  used_at_station text,
  used_for text check (used_for in ('topup', 'swap'))
);
create index credit_codes_user_idx on credit_codes (user_id, created_at);

-- A charge paid from Green Credit (QR code, or a card linked to an account): the most it may
-- cost, the balance when it started. It stops there and is taken from the credit when it ends.
alter table charging_sessions add column credit_limit_xof integer check (credit_limit_xof is null or credit_limit_xof >= 0);

-- A card linked to an account now pays with the account's Green Credit: the credit already on
-- such a card moves to the account once, booked on both sides. Negative card balances (a late
-- stop) stay on the card.
insert into wallets (user_id, created_at, updated_at)
  select distinct user_id, '2026-10-18T00:00:00.000Z', '2026-10-18T00:00:00.000Z' from charge_cards
   where user_id is not null and balance_xof > 0 and user_id not in (select user_id from wallets);
insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
    counterparty_label, remark, details, created_at)
  select lower(hex(randomblob(16))), 'AB' || substr('11111111' || abs(random() % 100000000), -8), c.user_id, 'admin_adjust', 'received',
         c.balance_xof, 0, c.balance_xof,
         (select w.balance_xof from wallets w where w.user_id = c.user_id)
           + (select sum(c2.balance_xof) from charge_cards c2 where c2.user_id = c.user_id and c2.balance_xof > 0 and c2.id_tag <= c.id_tag),
         'Carte ' || c.id_tag, 'Solde de la carte ' || c.id_tag, json_object('fromCard', c.id_tag), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    from charge_cards c where c.user_id is not null and c.balance_xof > 0;
update wallets set
    balance_xof = balance_xof + (select sum(c.balance_xof) from charge_cards c where c.user_id = wallets.user_id and c.balance_xof > 0),
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  where user_id in (select user_id from charge_cards where user_id is not null and balance_xof > 0);
insert into charge_card_transactions (id, id_tag, type, amount_xof, balance_after_xof, reason, created_at)
  select lower(hex(randomblob(16))), id_tag, 'adjust', -balance_xof, 0, 'Vers le Green Credit du compte', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    from charge_cards where user_id is not null and balance_xof > 0;
update charge_cards set balance_xof = 0 where user_id is not null and balance_xof > 0;
