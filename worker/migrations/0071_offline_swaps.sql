-- Swaps made without network (migration 0071). The staff app keeps up to 10 swaps on the phone
-- while offline and sends them when the network is back (src/lib/offline/, shared/station-work.ts
-- checkOfflineAt). Such a swap already happened in front of the customer, so the server records it
-- even when it contradicts the back-office, and marks it to check:
--   swap_log.offline      1 = sent later; created_at is when it happened, synced_at when it arrived
--   swap_log.review       why it is to check: 'stock' (no full battery in the counter), 'battery'
--                         (battery register disagrees), 'payment' (fleet pass no longer valid),
--                         'customer' (contact not found); review_note = the server's error code
--   swap_log.reviewed_at  / reviewed_by: an owner or admin marked it checked
-- offline_swap_rejects keeps the rare offline swaps the server refuses (staff no longer at the
-- station, time older than 14 days, invalid data), with the form as sent, for the admin.
-- Code: worker/station-work.ts (recordSwap, markSwapChecked, offlineRejects). Test: worker/offline-swaps.test.ts.
-- Only adds columns with defaults and a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table swap_log add column offline integer not null default 0 check (offline in (0, 1));
alter table swap_log add column synced_at text;
alter table swap_log add column review text check (review is null or review in ('stock', 'battery', 'payment', 'customer'));
alter table swap_log add column review_note text check (review_note is null or length(review_note) between 1 and 200);
alter table swap_log add column reviewed_at text;
alter table swap_log add column reviewed_by text;

create index swap_log_review_idx on swap_log (station_id, created_at) where review is not null and reviewed_at is null;

create table offline_swap_rejects (
  id text primary key,
  request_id text not null unique,
  station_id text not null,
  staff_id text not null, -- user id, no foreign key (as audit_log.actor)
  occurred_at text not null,
  error text not null check (length(error) between 1 and 80),
  payload text not null check (length(payload) <= 4000), -- the SwapInput as sent (JSON)
  created_at text not null,
  resolved_at text,
  resolved_by text
);

create index offline_swap_rejects_open_idx on offline_swap_rejects (created_at) where resolved_at is null;
