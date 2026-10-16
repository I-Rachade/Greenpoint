-- Charging by QR code: the customer scans the sticker on an outlet and starts the charge
-- in the app, without staff. Off per outlet until an admin switches it on in the backoffice
-- (Prises connectées). Code: startSelfCharge() in worker/charging.ts.
-- Adds one column with a default; safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
alter table charging_points add column qr_start integer not null default 0;
