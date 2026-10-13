-- Backoffice switch for the parcel module (parcel depot, partner API and,
-- once merged, driver pickups). Starts on, so nothing changes until an admin
-- turns it off; then the app hides every parcel screen and the Worker refuses
-- parcel requests from customers, station staff and partner apps. Code:
-- worker/features.ts. Only adds a row, so it is safe to apply before the new
-- Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

insert or ignore into app_settings (key, value, updated_at) values ('parcels_enabled', '1', '2026-10-13T00:00:00.000Z');
