-- The security log (worker/security.ts): failed PIN logins, account locks, requests refused by a
-- limit, failed robot checks and unlocks by an admin. Read by the back office page "Sécurité"
-- and by the login, which asks for the robot check after a few failed tries for one contact or
-- from one address. Rows older than 30 days are dropped by the daily cron.
-- subject: SHA-256 of the phone number or e-mail address typed at the login, so tries count for
-- unknown contacts too and the log does not reveal who has an account.
-- dedupe: one row per key at most (for example one "limited" row per address and minute).
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
create table security_events (
  id integer primary key autoincrement,
  at text not null,
  kind text not null,
  user_id text,
  ip text,
  subject text,
  detail text,
  dedupe text unique
);
create index security_events_kind_at on security_events (kind, at);
create index security_events_subject on security_events (subject, kind, at) where subject is not null;
create index security_events_ip on security_events (ip, kind, at) where ip is not null;
create index security_events_at on security_events (at);
