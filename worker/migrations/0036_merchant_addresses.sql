-- Merchants, phase 2 (planung/marchand.md): the shop's saved pickup addresses, besides its own
-- address. Members pick one when they book; the merchant adds and removes them.
-- Statistics, the CSV export and "recipient absent, back to the shop" need no new columns.
--
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table merchant_addresses (
  id text primary key,
  merchant_id text not null references merchants (id) on delete cascade,
  label text not null check (length(label) between 2 and 40),
  address text not null check (length(address) between 2 and 200),
  -- The phone number the driver calls at this address (Togo).
  phone text not null check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  lat real not null,
  lng real not null,
  created_at text not null,
  created_by text not null
);
create index merchant_addresses_merchant_idx on merchant_addresses (merchant_id, created_at);
