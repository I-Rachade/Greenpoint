-- Fleets (plan phase 6, M1-M5, W5, W6, invariants R12, R13): a fleet manager is an account of
-- its own that registers itself and waits for an admin; until then the fleet functions are
-- blocked. A fleet is the manager's account: one fleet per manager (one role per account),
-- keyed by the manager's user id. Drivers stay linked through fleet_manager_drivers (0015).
--
-- status: pending (registered, waiting for an admin), approved, rejected.
-- tier:   standard (at most 3 drivers, active plus pending invites, no statistics) or
--         unlocked (more drivers and the statistics; paid outside the app, set by an admin).
--
-- Existing fleets: every account with the role fleet_manager or with drivers linked to it
-- gets a fleet, approved (they were made by an admin). Their tier is standard, also when
-- they already have more than 3 drivers: nobody loses a driver, the limit only refuses new
-- invites (R13 counts what is there plus what is invited), and the statistics stay locked
-- until an admin unlocks them ("Bestehende Flottenmanager: gelten als geprüft und behalten
-- ihre Fahrer, Statistik nur nach Freischaltung"). Find those fleets with
--   select manager_id, count(*) from fleet_manager_drivers group by manager_id having count(*) > 3;
--
-- Invites (W6, R12): the manager invites a driver by phone number; only a number without an
-- account or an empty customer account may be invited (checked by the Worker, and again
-- when the person accepts). The person confirms in the app; then the account becomes a
-- driver account in the fleet. token: the short code the manager can pass on (and the link
-- /chauffeur?invitation=<token>); the invite still only works for the account of that number.
--
-- Fleet managers are not customers (W5, R11): wallet, greenpoints, reservations and
-- bookings answer 403. Money or greenpoints that existing fleet managers still hold stay in
-- their rows (nothing is moved here); list them before deploying and settle with the admin:
--   select u.id, u.full_name, w.balance_xof from users u join wallets w on w.user_id = u.id
--   where u.role = 'fleet_manager' and w.balance_xof <> 0;
--
-- Only adds tables and rows, so it is safe to apply before the new Worker is deployed.
-- Code: worker/fleet.ts, src/lib/fleet.ts. Test: worker/fleet-manager.test.ts.
-- Apply: npx wrangler d1 migrations apply DB --remote

create table fleets (
  manager_id text primary key references users (id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  tier text not null default 'standard' check (tier in ('standard', 'unlocked')),
  created_at text not null,
  reviewed_at text,
  reviewed_by text,
  tier_set_at text,
  tier_set_by text
);
create index fleets_status_idx on fleets (status, created_at);

insert into fleets (manager_id, name, status, tier, created_at, reviewed_at)
select u.id,
       case when length(trim(coalesce(u.full_name, ''))) >= 2 then substr(trim(u.full_name), 1, 80)
            else coalesce(u.phone, u.email, 'Flotte') end,
       'approved', 'standard', u.created_at, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
from users u
where u.role = 'fleet_manager' or exists (select 1 from fleet_manager_drivers f where f.manager_id = u.id);

-- No foreign key on the invitee: the number may have no account yet.
create table fleet_invites (
  id text primary key,
  manager_id text not null references fleets (manager_id) on delete cascade,
  phone text not null,
  invited_by text not null,  -- user id (the manager or an admin), no foreign key (as audit_log.actor)
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  token text not null unique check (length(token) between 6 and 16),
  created_at text not null,
  expires_at text not null,
  decided_at text,
  user_id text               -- the account that accepted or declined
);
create index fleet_invites_manager_idx on fleet_invites (manager_id, status);
create index fleet_invites_phone_idx on fleet_invites (phone, status);
-- One open invite per fleet and number.
create unique index fleet_invites_one_pending on fleet_invites (manager_id, phone) where status = 'pending';
