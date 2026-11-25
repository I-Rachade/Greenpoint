-- Security review 2026-10-19, point 9: login codes and PIN logins counted per IP address, so one
-- address cannot use up the hourly code limit for everyone (worker/ip-limits.ts).
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
create table auth_ip_requests (
  ip text not null,
  kind text not null,
  at text not null
);
create index auth_ip_requests_idx on auth_ip_requests (ip, kind, at);
