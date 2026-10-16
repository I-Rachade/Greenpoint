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

-- Push notifications (planung/fahrer.md): the Firebase Cloud Messaging token of each app
-- install, so drivers hear about a new offer with the app closed. A token belongs to the
-- account last signed in on that phone; signing out removes it.
create table push_tokens (
  token text primary key,
  user_id text not null references users (id) on delete cascade,
  platform text not null,
  updated_at text not null
);
create index push_tokens_user on push_tokens (user_id);
