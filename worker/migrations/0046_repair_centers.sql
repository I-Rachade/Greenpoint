-- Repair workshops ("ateliers de réparation") that are not at a station, e.g. the Spiro
-- service centres in Togo. The admin adds them in the backoffice; the app shows the active
-- ones on the map with their own marker. They take no reservations.
-- A workshop at a station is the station's "repair" amenity instead (src/lib/station-extras.ts).
-- Code: src/lib/repair-centers.ts, worker/repair-centers.ts.
-- Only adds a table, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table repair_centers (
  id text primary key,
  operator_id text references operators (id) on delete set null,  -- the brand it repairs for, if any
  name text not null check (length(name) between 1 and 80),
  address text not null default '' check (length(address) <= 200),
  lat real not null check (lat between -90 and 90),
  lng real not null check (lng between -180 and 180),
  phone text,
  opening_hours text not null default '',  -- days and times (src/lib/opening-hours.ts), '' = not known
  is_active integer not null default 1 check (is_active in (0, 1)),
  created_at text not null
);
