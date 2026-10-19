-- Cash closings at our own stations too (0045 covered partner stations only). Green Credit that
-- staff load in cash at the counter (wallet_transactions type 'topup' with a station, 0047) is
-- handed over by the staff member who took it: each closing of an own station covers one staff
-- member's top-ups since their last closing there, and an admin confirms it like any other.
--
-- Code: worker/station-cash.ts, src/lib/station-cash.ts. Test: worker/station-cash.test.ts.
-- Safe to apply before the new Worker is deployed: it adds a column, moves the cash start of our
-- own stations (which the current Worker never reads) and rebuilds the unique index on the period
-- start for rows without a staff member, which is every row the current Worker writes, so it
-- protects them exactly as before.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- Whose top-ups the closing covers (own stations). Null: a partner station's closing.
alter table cash_handovers add column staff_id text;

-- Our own stations' balance starts now: top-ups loaded before were settled outside the app.
update stations set cash_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 where operator_id in (select id from operators where is_own = 1);

-- One closing per period start, per staff member at our stations: two staff members both closing
-- for the first time start at the same instant.
drop index cash_handovers_period;
create unique index cash_handovers_period on cash_handovers (station_id, period_from) where staff_id is null;
create unique index cash_handovers_staff_period on cash_handovers (station_id, staff_id, period_from) where staff_id is not null;
