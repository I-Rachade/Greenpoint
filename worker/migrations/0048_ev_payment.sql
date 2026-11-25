-- Paying car chargers in the app: a charger is connected to an outlet of a connected device
-- (OCPP or a vendor's cloud API, like the motorbike sockets), which switches and meters it.
-- It is then started and paid like a motorbike outlet (QR code with the PIN and Green Credit,
-- or by staff and paid in cash), at the car price. Its outlet is not one of the station's
-- motorbike places.
--
-- Code: src/lib/ev-chargers.ts, worker/ev-chargers.ts, worker/charging.ts (tariffFor).
-- Only adds columns and a row, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table ev_chargers add column point_id text references charging_points (id) on delete set null;
create unique index ev_chargers_point_idx on ev_chargers (point_id) where point_id is not null;

-- A station's own car price (null = the network price below).
alter table stations add column ev_kwh_xof integer check (ev_kwh_xof is null or ev_kwh_xof > 0);
alter table stations add column ev_min_xof integer check (ev_min_xof is null or ev_min_xof >= 0);

-- Network price of a car charge, changed in the backoffice.
insert into app_settings (key, value, updated_at) values ('ev_tariff', '{"kwhXof":200,"minXof":500}', '2026-10-18T00:00:00.000Z');
