-- Car battery level (OCPP MeterValues measurand "SoC", in %): a car charger that reports it
-- (mostly DC chargers; an AC Type 2 charger usually cannot read the car) shows it live to the
-- customer, the staff and the backoffice, like the power and the energy.
-- charging_points.soc_percent: last level read on that outlet; cleared when a new charge starts.
-- Code: shared/iot/ocpp.ts (meterReading), worker/devices.ts (ingest), worker/charging.ts
-- (toSession), src/components/charging/charging.tsx. Test: worker/ocpp.test.ts.
-- Only adds a nullable column, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table charging_points add column soc_percent integer;
