-- Who owns a station's battery swapping, the host's commission and the daily cash handover.
-- Charging sockets already belong to poinderecharge or a point partner (0039). The swapping
-- belongs to the operator at an operator station, or to poinderecharge at a shop station (a
-- partner that only hosts it). The cash a partner station takes for poinderecharge is handed
-- back every day and an admin confirms it (cash_handovers).
--
-- Code: worker/station-cash.ts, src/lib/station-cash.ts. Test: worker/station-cash.test.ts.
-- Only adds columns and a table, so it is safe to apply before the new Worker is deployed:
-- null swap_owner keeps today's rule (ours at our stations, the operator's elsewhere).
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Null: automatic (poinderecharge at our own stations, the operator at a partner's).
alter table stations add column swap_owner text check (swap_owner in ('operator', 'poinderecharge'));
-- The host's commission on what belongs to poinderecharge at the station.
alter table stations add column commission_pct integer not null default 0 check (commission_pct between 0 and 100);
-- deduct: kept back at each handover; monthly: paid by poinderecharge every month.
alter table stations add column commission_mode text not null default 'monthly' check (commission_mode in ('deduct', 'monthly'));
-- Where the station's cash balance starts. Null: the station's creation. Existing stations
-- start now: what they took before was settled outside the app.
alter table stations add column cash_since text;
update stations set cash_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now');

-- Who owned the swap when it happened, like the socket owner of a charge: changing the station
-- later never changes a past swap. Null (older swaps): the rule of swap_owner above.
alter table swap_log add column owner text check (owner in ('operator', 'poinderecharge'));

-- A station closing its cash: what it took for poinderecharge in the period, what it handed over.
create table cash_handovers (
  id text primary key,
  station_id text not null references stations (id) on delete cascade,
  period_from text not null,
  period_until text not null,
  cash_xof integer not null,         -- cash taken for poinderecharge in the period
  carry_xof integer not null,        -- left over from earlier closings, at the time
  commission_xof integer not null default 0 check (commission_xof >= 0),  -- kept back (deduct)
  due_xof integer not null,          -- cash + carry - commission
  amount_xof integer not null check (amount_xof >= 0),                     -- handed over
  method text not null check (method in ('cash', 'mobile_money', 'bank')),
  reference text not null check (length(reference) between 1 and 80),    -- agent's name or transaction/receipt number
  note text check (note is null or length(note) <= 200),                 -- why the amount differs
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  created_by text not null,
  created_at text not null,
  decided_by text,
  decided_at text,
  reject_reason text check (reject_reason is null or length(reject_reason) between 1 and 200)
);
-- One closing per period start: two closings sent at once cannot cover the same cash.
create unique index cash_handovers_period on cash_handovers (station_id, period_from);
create index cash_handovers_status_idx on cash_handovers (status, created_at);
