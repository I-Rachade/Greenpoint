-- Plan phase 8 (W2): a staff account works at exactly one station. Owners (Betreiber)
-- run their stations through operator_owners, not station_staff. Ends with a unique
-- index station_staff(user_id); before it, existing staff with several stations are
-- resolved here:
--
-- 1. Rows of an owner at a station of an operator they run are dropped: the owner keeps
--    every right there through operator_owners, nothing is lost.
-- 2. Of the remaining rows, each person keeps the station they used most recently. "Used"
--    is the newest trace of that person at that station in any of: battery_events,
--    swap_log, audit_log (actor), parcel_events, charging_sessions (started),
--    greenpoint_ledger (created_by), driver_ledger (actor) and station_status
--    (updated_by). A tie, or no trace at all, keeps the assignment made last (the larger
--    rowid). parcel_scans and parcel_runs (0034) are not read: 0034 may be applied after
--    this file; their station actions are in audit_log and parcel_events as well.
-- 3. Every other row is removed and written to staff_reassignments (person, station,
--    operator), so the station's owner sees it as a list to re-staff ("Staff with
--    several stations keep the most recently used one; others go to the owner as a list
--    to re-staff"). Removals are also in the activity log (actor null, reason).
--
-- station_actions: one row per station action that passed the active-station check
-- (worker/station-work.ts stationActor), with station, person and role (principle 3).
--
-- Not purely additive: deletes the duplicate station_staff rows, all of them recorded in
-- staff_reassignments. Take a D1 Time Travel bookmark before applying remotely:
--   npx wrangler d1 time-travel info DB
-- Find the people concerned before applying:
--   select user_id, count(*) from station_staff group by user_id having count(*) > 1;
-- Code: worker/api.ts (addStaff, moveStaff, ownerView), worker/owner.ts.
-- Test: worker/migration-0033.test.ts.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table staff_reassignments (
  id text primary key,
  user_id text not null references users (id) on delete cascade,
  station_id text not null references stations (id) on delete cascade,
  operator_id text not null,
  created_at text not null,
  resolved_at text,
  resolved_by text
);
create index staff_reassignments_operator_idx on staff_reassignments (operator_id, resolved_at);

create table station_actions (
  id integer primary key autoincrement,
  station_id text not null,
  person_id text not null,   -- user id, no foreign key (as audit_log.actor)
  role text not null check (role in ('staff', 'owner', 'admin')),
  action text not null check (length(action) between 1 and 200),
  created_at text not null
);
create index station_actions_station_idx on station_actions (station_id, created_at);
create index station_actions_person_idx on station_actions (person_id, created_at);

-- 1. Owners at their own stations.
delete from station_staff
where exists (
  select 1 from stations s join operator_owners o on o.operator_id = s.operator_id
  where s.id = station_staff.station_id and o.user_id = station_staff.user_id
);

-- 2. The newest trace of each person at each of their stations.
create table m33_last_use as
select ss.rowid as rid, ss.station_id, ss.user_id,
  max(
    coalesce((select max(created_at) from battery_events x where x.person_id = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select max(created_at) from swap_log x where x.staff_id = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select max(at) from audit_log x where x.actor = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select max(at) from parcel_events x where x.actor = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select max(started_at) from charging_sessions x where x.started_by = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select max(created_at) from greenpoint_ledger x where x.created_by = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select max(at) from driver_ledger x where x.actor = ss.user_id and x.station_id = ss.station_id), ''),
    coalesce((select updated_at from station_status x where x.updated_by = ss.user_id and x.station_id = ss.station_id), '')
  ) as last_used
from station_staff ss;

create table m33_ranked as
select rid, station_id, user_id,
       row_number() over (partition by user_id order by last_used desc, rid desc) as n
from m33_last_use;

-- 3. The others: on the owner's list, in the activity log, then removed.
insert into staff_reassignments (id, user_id, station_id, operator_id, created_at)
select lower(hex(randomblob(16))), r.user_id, r.station_id, s.operator_id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from m33_ranked r join stations s on s.id = r.station_id
where r.n > 1;

insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes)
select strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), null, 'station_staff', 'delete', r.station_id || ':' || r.user_id, r.station_id, r.user_id,
       '{"reason":"one_station","migration":"0033"}'
from m33_ranked r
where r.n > 1;

delete from station_staff where rowid in (select rid from m33_ranked where n > 1);

drop table m33_ranked;
drop table m33_last_use;

create unique index station_staff_one_station on station_staff (user_id);
