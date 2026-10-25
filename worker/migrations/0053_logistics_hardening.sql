-- Logistics review 2026-10-19 (worker/drivers.ts, worker/parcels.ts).
-- Only adds a column and an index, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- A courier the driver handed over with the photo alone, without the recipient's code: the trip is
-- done, but the driver's share is booked only once the sender confirms receipt or an admin approves
-- the photo. null: handed over with the code (or not a courier), 'pending': waiting, 'approved': booked.
alter table delivery_jobs add column proof_review text check (proof_review in ('pending', 'approved'));
create index delivery_jobs_proof_review_idx on delivery_jobs (proof_review) where proof_review = 'pending';

-- Wrong pickup codes (parcel_code_failures, 0005) are now also counted per parcel ("parcel:<id>")
-- and per door handover ("job:<id>") in station_id; the column keeps its name, no change needed.
