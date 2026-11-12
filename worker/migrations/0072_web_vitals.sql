-- Speed measured on people's phones (migration 0072): one row per page view, sent by the app
-- (src/components/web-vitals.tsx) to POST /api/vitals (worker/vitals.ts). Times in ms, cls without
-- unit, null when the browser did not measure it. No account, no address: page, platform, network,
-- memory, app version and country only. Rows older than 30 days are removed by the daily cron.
-- Only adds a table, so it is safe to apply before or after the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table web_vitals (
  at text not null,
  page text not null,
  platform text not null check (platform in ('android', 'ios', 'web')),
  net text,
  memory real,
  version text,
  country text,
  ttfb real,
  fcp real,
  lcp real,
  cls real,
  inp real
);
create index web_vitals_at_idx on web_vitals (at);
