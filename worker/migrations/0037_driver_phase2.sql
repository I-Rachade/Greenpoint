-- Driver phase 2 (planung/fahrer.md): live position of drivers on duty.
--
-- Only adds tables and columns, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- The last position a driver's app reported while on duty (in a queue, checked in at a
-- shop or on a trip). One row per driver, overwritten; no history is kept.
create table driver_positions (
  driver_id text primary key references users (id) on delete cascade,
  lat real not null,
  lng real not null,
  accuracy_m real,
  at text not null
);
