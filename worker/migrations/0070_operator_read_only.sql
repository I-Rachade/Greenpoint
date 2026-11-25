-- Operator accounts that only read (migration 0070). operator_owners.access:
--   'manage' = runs the operator's stations: staff, hours, prices, swap corrections, and works there
--              like staff (every account linked before this migration keeps that);
--   'read'   = sees My stations (live, history, batteries, activity) of its operator, changes nothing
--              and does not work at the stations. New accounts added in /admin/operators start here.
-- A person whose every operator link is 'read' is a read-only account (Profile.ownerReadOnly): the API
-- refuses each of its writes except signing in and out and its own account (worker/api.ts, readOnlyGuard).
-- Code: worker/api.ts (addOperatorOwner, setOperatorOwnerAccess, ownerActivity), worker/batteries.ts,
-- worker/station-work.ts (roleAtStation). Test: worker/operator-read-only.test.ts.
-- Only adds a column with a default, so it is safe to apply before the new Worker is deployed.
-- Apply: npx wrangler d1 migrations apply DB --remote

alter table operator_owners add column access text not null default 'manage' check (access in ('manage', 'read'));
