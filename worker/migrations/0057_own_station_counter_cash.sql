-- The cash closing per staff member at our own stations (0051) also counts the cash swaps, the
-- cash charges and the parcels paid in cash at the counter, each for the person who took the
-- money: swap_log.staff_id, charging_sessions.paid_by (only the counter's "paid in cash" sets a
-- cash payment) and parcels.created_by (a counter parcel is paid when handed in). No new "who"
-- column is needed.
--
-- Until now that cash was handed over outside the app. So that nobody owes it a second time,
-- these kinds count only from the moment this migration runs at our existing stations; Green
-- Credit top-ups keep counting from stations.cash_since as before. Null: from cash_since (a
-- station created later, or a partner station, which never reads it).
--
-- Code: worker/station-cash.ts cashOfOwnStations. Test: worker/station-cash.test.ts.
-- Safe to apply before the new Worker is deployed: it only adds a column the current Worker
-- never reads.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table stations add column counter_cash_since text;

update stations set counter_cash_since = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
 where operator_id in (select id from operators where is_own = 1);
