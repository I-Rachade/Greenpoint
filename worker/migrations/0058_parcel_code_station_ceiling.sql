-- Wrong pickup codes (parcel_code_failures, 0005) are counted per key in station_id: a station for
-- a bare code, "parcel:<id>" once the parcel is known (0053), "job:<id>" at the door. at_station
-- also writes down the station of a code typed at a counter, so all wrong codes at one station
-- (bare or per parcel) are counted together against a station-wide ceiling (worker/code-tries.ts
-- withPickupCodeTry, PARCEL_STATION_MAX_CODE_FAILURES). null: a door handover or an older row.
-- Only adds a column and an index, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
alter table parcel_code_failures add column at_station text;
create index parcel_code_failures_station_idx on parcel_code_failures (at_station, at) where at_station is not null;
