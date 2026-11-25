-- Couriers handed over with the photo alone (0053): an admin can now also reject the photo
-- (POST /api/admin/jobs/:id/reject-proof, worker/drivers.ts rejectProof). 'rejected': the driver's
-- share is not booked, and the trip can no longer be approved. proof_reject_reason: why, as the
-- admin wrote it (shown to the driver and the sender).
-- SQLite cannot widen the CHECK of 0053 in place: the column is copied into a new one with the
-- wider CHECK, the old one dropped and the new one takes its name (its own CHECK and its index are
-- the only things that refer to it). D1 runs the file as one transaction; the running Worker only
-- writes 'pending' and 'approved', which the new CHECK still allows, so it is safe to apply before
-- the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote
alter table delivery_jobs add column proof_review_next text check (proof_review_next in ('pending', 'approved', 'rejected'));
update delivery_jobs set proof_review_next = proof_review where proof_review is not null;
drop index delivery_jobs_proof_review_idx;
alter table delivery_jobs drop column proof_review;
alter table delivery_jobs rename column proof_review_next to proof_review;
create index delivery_jobs_proof_review_idx on delivery_jobs (proof_review) where proof_review = 'pending';
alter table delivery_jobs add column proof_reject_reason text;
