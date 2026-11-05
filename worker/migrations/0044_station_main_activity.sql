-- What a station mainly is, set in the backoffice: 'charging', 'swap', 'ev' (electric car chargers), 'restaurant' or 'shop'.
-- Null = automatic (the illustration follows the station's services, as before).
-- It only picks the illustration shown while the station has no photo (src/lib/station-extras.ts).
-- Safe to apply before the new Worker is deployed: the old code never reads main_activity.
alter table stations add column main_activity text check (main_activity in ('charging', 'swap', 'ev', 'restaurant', 'shop'));
