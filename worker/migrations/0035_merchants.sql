-- Merchants (plan planung/marchand.md): shops that book deliveries and rides, with employees,
-- favorite drivers and assigned drivers who check in at the shop.
--
-- users.role gets the value 'merchant' (the merchant and the shop's employees; one role per
-- account, like fleet managers, never a customer: R11). SQLite cannot change a CHECK
-- constraint, so users is rebuilt exactly as in 0030_driver_role.sql, with the tables that
-- reference users since then (fleets, fleet_invites, staff_reassignments) copied aside too.
--
-- BEFORE APPLYING REMOTELY:
--   1. Take a D1 Time Travel bookmark and write it down:
--        npx wrangler d1 time-travel info DB
--      (to undo: npx wrangler d1 time-travel restore DB --bookmark=<bookmark>)
--   2. Note the row counts of users and of every table copied in step 1 below and compare
--      them after applying. The migration checks them itself and fails as a whole when one
--      differs, but compare anyway.
--   3. Deploy the new Worker right after: the old one does not know the role 'merchant'
--      (nobody has it yet, so nothing breaks before that).
--
-- The traps (see 0030): D1 always enforces foreign keys; dropping users runs an implicit
-- DELETE FROM users whose ON DELETE actions would cascade into or null out every table
-- below; triggers on users go with the table. So every table that references users, directly
-- or through reservations, drivers or fleets, is copied aside and emptied before the drop
-- (children first) and put back after the rename (parents first).
-- users keeps every column in the same order; only the role check changes.
--
-- Code: worker/merchants.ts, src/lib/merchants.ts. Test: worker/migration-0035.test.ts,
-- worker/merchants.test.ts.
-- Apply: npx wrangler d1 migrations apply DB --remote
PRAGMA defer_foreign_keys = on;

-- 1. Copy aside.
create table m35_sessions as select * from sessions;
create table m35_wallets as select * from wallets;
create table m35_station_staff as select * from station_staff;
create table m35_operator_owners as select * from operator_owners;
create table m35_reservations as select * from reservations;
create table m35_payments as select * from payments;
create table m35_drivers as select * from drivers;
create table m35_driver_queue as select * from driver_queue;
create table m35_fleet_manager_drivers as select * from fleet_manager_drivers;
create table m35_wallet_topups as select * from wallet_topups;
create table m35_wallet_transactions as select * from wallet_transactions;
create table m35_greenpoint_ledger as select * from greenpoint_ledger;
create table m35_greenpoint_redemptions as select * from greenpoint_redemptions;
create table m35_station_reviews as select * from station_reviews;
create table m35_charging_sessions as select * from charging_sessions;
create table m35_swap_log as select * from swap_log;
create table m35_fleets as select * from fleets;
create table m35_fleet_invites as select * from fleet_invites;
create table m35_staff_reassignments as select * from staff_reassignments;

-- 2. Empty them, children first, so dropping users has nothing to cascade into or set to null.
delete from driver_queue;
delete from fleet_manager_drivers;
delete from fleet_invites;
delete from swap_log;
delete from greenpoint_ledger;
delete from payments;
delete from drivers;
delete from reservations;
delete from sessions;
delete from station_staff;
delete from operator_owners;
delete from staff_reassignments;
delete from fleets;
delete from wallet_topups;
delete from wallet_transactions;
delete from greenpoint_redemptions;
delete from station_reviews;
delete from charging_sessions;
delete from wallets;

-- 3. The new users table, with every column of the old one in the same order.
create table users_new (
  id text primary key,
  phone text unique check (phone is null or phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  -- Stored in lower case.
  email text unique check (email is null or (email = lower(email) and length(email) <= 254 and email like '_%@_%._%')),
  full_name text,
  -- 'rider' is the customer (worker/roles.ts). 'merchant': a shop's merchant or employee (0035).
  role text not null default 'rider' check (role in ('rider', 'operator', 'fleet_manager', 'admin', 'driver', 'merchant')),
  created_at text not null,
  last_sign_in_at text,
  pin_hash text,
  pin_failures integer not null default 0,
  pin_locked_until text,
  greenpoint_vehicle text check (greenpoint_vehicle in ('scooter', 'tricycle', 'ebike', 'moped')),
  -- A customer account opened for a converted driver waits without contact until claimed (0031).
  check (phone is not null or email is not null or (role = 'rider' and pin_hash is null))
);
insert into users_new (id, phone, email, full_name, role, created_at, last_sign_in_at, pin_hash, pin_failures, pin_locked_until, greenpoint_vehicle)
  select id, phone, email, full_name, role, created_at, last_sign_in_at, pin_hash, pin_failures, pin_locked_until, greenpoint_vehicle from users;

-- Fails the whole migration if a row did not make it.
create table m35_check (ok integer not null check (ok = 1));
insert into m35_check select (select count(*) from users_new) = (select count(*) from users);

drop table users;
alter table users_new rename to users;

-- 4. Put everything back, parents first. The insert trigger of reservations (0029) would
-- change kind on rows it should leave as they are, so it is off while they go back.
drop trigger reservations_kind_from_type;
insert into reservations select * from m35_reservations;
insert into drivers select * from m35_drivers;
insert into fleets select * from m35_fleets;
insert into sessions select * from m35_sessions;
insert into wallets select * from m35_wallets;
insert into station_staff select * from m35_station_staff;
insert into operator_owners select * from m35_operator_owners;
insert into staff_reassignments select * from m35_staff_reassignments;
insert into payments select * from m35_payments;
insert into driver_queue select * from m35_driver_queue;
insert into fleet_manager_drivers select * from m35_fleet_manager_drivers;
insert into fleet_invites select * from m35_fleet_invites;
insert into wallet_topups select * from m35_wallet_topups;
insert into wallet_transactions select * from m35_wallet_transactions;
insert into greenpoint_ledger select * from m35_greenpoint_ledger;
insert into greenpoint_redemptions select * from m35_greenpoint_redemptions;
insert into station_reviews select * from m35_station_reviews;
insert into charging_sessions select * from m35_charging_sessions;
insert into swap_log select * from m35_swap_log;

create trigger reservations_kind_from_type after insert on reservations
when new.type = 'slot' and new.kind = 'swap'
begin
  update reservations set kind = 'charging_point' where id = new.id;
end;

-- The trigger of 0006_payments.sql, dropped with the old users table.
create trigger payments_anonymize_on_user_delete before delete on users
begin
  update payments set user_id = null, phone = null where user_id = old.id;
end;

-- 5. Same row counts everywhere, or nothing is applied.
insert into m35_check select
  (select count(*) from sessions) = (select count(*) from m35_sessions)
  and (select count(*) from wallets) = (select count(*) from m35_wallets)
  and (select count(*) from station_staff) = (select count(*) from m35_station_staff)
  and (select count(*) from operator_owners) = (select count(*) from m35_operator_owners)
  and (select count(*) from reservations) = (select count(*) from m35_reservations)
  and (select count(*) from payments) = (select count(*) from m35_payments)
  and (select count(*) from drivers) = (select count(*) from m35_drivers)
  and (select count(*) from driver_queue) = (select count(*) from m35_driver_queue)
  and (select count(*) from fleet_manager_drivers) = (select count(*) from m35_fleet_manager_drivers)
  and (select count(*) from wallet_topups) = (select count(*) from m35_wallet_topups)
  and (select count(*) from wallet_transactions) = (select count(*) from m35_wallet_transactions)
  and (select count(*) from greenpoint_ledger) = (select count(*) from m35_greenpoint_ledger)
  and (select count(*) from greenpoint_redemptions) = (select count(*) from m35_greenpoint_redemptions)
  and (select count(*) from station_reviews) = (select count(*) from m35_station_reviews)
  and (select count(*) from charging_sessions) = (select count(*) from m35_charging_sessions)
  and (select count(*) from swap_log) = (select count(*) from m35_swap_log)
  and (select count(*) from fleets) = (select count(*) from m35_fleets)
  and (select count(*) from fleet_invites) = (select count(*) from m35_fleet_invites)
  and (select count(*) from staff_reassignments) = (select count(*) from m35_staff_reassignments);

drop table m35_check;
drop table m35_sessions;
drop table m35_wallets;
drop table m35_station_staff;
drop table m35_operator_owners;
drop table m35_reservations;
drop table m35_payments;
drop table m35_drivers;
drop table m35_driver_queue;
drop table m35_fleet_manager_drivers;
drop table m35_wallet_topups;
drop table m35_wallet_transactions;
drop table m35_greenpoint_ledger;
drop table m35_greenpoint_redemptions;
drop table m35_station_reviews;
drop table m35_charging_sessions;
drop table m35_swap_log;
drop table m35_fleets;
drop table m35_fleet_invites;
drop table m35_staff_reassignments;

-- 6. The shops. One shop per merchant; an account belongs to at most one shop.
create table merchants (
  id text primary key,
  owner_id text not null unique references users (id) on delete cascade,
  name text not null check (length(name) between 2 and 80),
  phone text not null check (phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  address text not null default '' check (length(address) <= 200),
  lat real not null,
  lng real not null,
  -- pending: registered, waiting for an admin. suspended: an approved shop an admin stopped.
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  -- standard: at most 3 employees besides the merchant, no statistics. unlocked: set by an admin.
  tier text not null default 'standard' check (tier in ('standard', 'unlocked')),
  created_at text not null,
  reviewed_at text,
  reviewed_by text,
  tier_set_at text,
  tier_set_by text
);
create index merchants_status_idx on merchants (status, created_at);

-- The merchant (is_owner = 1) and the employees.
create table merchant_members (
  user_id text primary key references users (id) on delete cascade,
  merchant_id text not null references merchants (id) on delete cascade,
  is_owner integer not null default 0 check (is_owner in (0, 1)),
  created_at text not null,
  added_by text
);
create index merchant_members_merchant_idx on merchant_members (merchant_id);

-- Like fleet_invites (0032). No foreign key on the invitee: the number may have no account yet.
create table merchant_invites (
  id text primary key,
  merchant_id text not null references merchants (id) on delete cascade,
  phone text not null,
  invited_by text not null,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  token text not null unique check (length(token) between 6 and 16),
  created_at text not null,
  expires_at text not null,
  decided_at text,
  user_id text
);
create index merchant_invites_merchant_idx on merchant_invites (merchant_id, status);
create index merchant_invites_phone_idx on merchant_invites (phone, status);
create unique index merchant_invites_one_pending on merchant_invites (merchant_id, phone) where status = 'pending';

-- Favorite drivers (active right away) and assigned drivers (pending until the driver, their
-- fleet manager or an admin approves; the pay option comes with the approval).
create table merchant_drivers (
  id text primary key,
  merchant_id text not null references merchants (id) on delete cascade,
  driver_id text not null references users (id) on delete cascade,
  kind text not null check (kind in ('favorite', 'assigned')),
  status text not null check (status in ('pending', 'active', 'declined', 'ended')),
  pay_mode text check (pay_mode in ('per_trip', 'hourly')),
  rate_per_hour_fcfa integer check (rate_per_hour_fcfa is null or rate_per_hour_fcfa > 0),
  created_at text not null,
  created_by text not null,
  approved_at text,
  approved_by text,
  approved_as text check (approved_as in ('driver', 'fleet_manager', 'admin')),
  ended_at text,
  ended_by text,
  check (kind = 'favorite' or pay_mode is not null),
  check (pay_mode is null or (pay_mode = 'hourly') = (rate_per_hour_fcfa is not null))
);
create index merchant_drivers_merchant_idx on merchant_drivers (merchant_id, status);
create index merchant_drivers_driver_idx on merchant_drivers (driver_id, status);
create unique index merchant_drivers_one_open on merchant_drivers (merchant_id, driver_id, kind) where status in ('pending', 'active');

-- Check-ins of assigned drivers. The pay option is copied at check-in. Hourly: amount_fcfa is
-- set at check-out (hours x rate), received_at when the driver confirms the shop paid.
create table merchant_checkins (
  id text primary key,
  merchant_id text not null references merchants (id) on delete cascade,
  driver_id text not null references users (id) on delete cascade,
  assignment_id text not null,
  pay_mode text not null check (pay_mode in ('per_trip', 'hourly')),
  rate_per_hour_fcfa integer,
  in_at text not null,
  out_at text,
  out_by text check (out_by in ('driver', 'merchant', 'admin', 'auto')),
  out_actor text,
  amount_fcfa integer,
  received_at text
);
-- At most one open check-in per driver (decision 10).
create unique index merchant_checkins_one_open on merchant_checkins (driver_id) where out_at is null;
create index merchant_checkins_merchant_idx on merchant_checkins (merchant_id, in_at);

-- The shop's trips: which shop and who of it booked. No foreign key (as the other user columns of delivery_jobs).
alter table delivery_jobs add column merchant_id text;
alter table delivery_jobs add column booked_by text;
create index delivery_jobs_merchant_idx on delivery_jobs (merchant_id, created_at);
