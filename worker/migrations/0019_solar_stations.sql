-- Solar stations: greenpoints are only earned for swaps and charges at stations that
-- charge with solar power. The admin marks them in the backoffice; the app shows a
-- solar badge. Rules: planung/greenpoint-nutzung.md; code: worker/greenpoint.ts.
-- Only adds a column (default 0 = not solar), so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table stations add column is_solar integer not null default 0;
