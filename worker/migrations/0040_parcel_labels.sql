-- Shipping label (planung/colis-etiquette-envoi.md): staff print a label and stick it on
-- every parcel handed in at the counter, separate from the drop-off slip the sender gets
-- (in the app, printed only on request). A parcel goes on a collection run only once
-- staff confirmed its label is on. Each print and reprint is in audit_log.
--
-- Parcels from before this migration had their slip stuck on instead, so they count as labelled.
-- Code: worker/parcels.ts (markLabelPrinted), worker/parcel-runs.ts (startRun).
-- Only adds a column, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table parcels add column label_printed_at text;
update parcels set label_printed_at = created_at;
