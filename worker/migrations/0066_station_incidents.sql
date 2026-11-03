-- Problems reported at a station (Omnivoltaic agent training: report every charger failure,
-- power cut, battery anomaly or payment error). An agent, owner or admin at the station reports
-- one; the station's owners and the admins are told at once (push and e-mail); an owner or an
-- admin marks it handled, with a note. Kinds: charger, power, battery, payment, other ("other"
-- needs a comment). One request id records one report.
-- Code: shared/incidents.ts, worker/incidents.ts, src/components/station-work/incident-page.tsx,
-- src/components/owner/history.tsx. Test: worker/incidents.test.ts.
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table station_incidents (
  id text primary key,
  request_id text not null unique,
  station_id text not null references stations (id) on delete cascade,
  kind text not null check (kind in ('charger', 'power', 'battery', 'payment', 'other')),
  comment text check (comment is null or length(comment) between 1 and 500),
  battery_label text check (battery_label is null or length(battery_label) between 1 and 60),
  reported_by text not null,   -- user id, no foreign key (as audit_log.actor)
  role text not null check (role in ('staff', 'owner', 'admin')),
  created_at text not null,
  status text not null default 'open' check (status in ('open', 'resolved')),
  resolved_by text,
  resolved_at text,
  resolution text check (resolution is null or length(resolution) between 1 and 500),
  check (kind <> 'other' or comment is not null),
  check ((status = 'resolved') = (resolved_at is not null and resolved_by is not null))
);

create index station_incidents_station_idx on station_incidents (station_id, created_at);
create index station_incidents_open_idx on station_incidents (created_at) where status = 'open';
