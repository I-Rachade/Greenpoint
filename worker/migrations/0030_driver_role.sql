-- Driver role (plan phase 5, W1, invariant R16): users.role gets the value 'driver'.
-- A driver is an account of its own, never a customer: no wallet, no greenpoints, no
-- reservations. The `drivers` table keeps the application, vehicle and fleet link.
--
-- BEFORE APPLYING REMOTELY:
--   1. Take a D1 Time Travel bookmark and write it down:
--        npx wrangler d1 time-travel info DB
--      (to undo: npx wrangler d1 time-travel restore DB --bookmark=<bookmark>)
--   2. Note the row counts of users and of every table listed in step 1 below
--      (select count(*) from <table>;) and compare them after applying. The migration
--      checks them itself and fails as a whole when one differs, but compare anyway.
--   3. Apply 0030 and 0031 with the new Worker ready to deploy right after: the old
--      Worker does not know the role 'driver' (converted drivers would see the
--      customer screens without their driver page until the deploy).
--
-- SQLite cannot change a CHECK constraint, so users is rebuilt (as in 0003_email_login.sql).
-- The traps, checked on D1 before (see 0003):
--   * D1 always enforces foreign keys; PRAGMA foreign_keys = off is ignored.
--   * Dropping users runs an implicit DELETE FROM users first. Its ON DELETE actions fire:
--     CASCADE would delete the rows of sessions, reservations, drivers (and through
--     drivers driver_queue and fleet_manager_drivers) and the other tables below;
--     SET NULL would empty user columns of payments, wallet_transactions, wallet_topups,
--     charging_sessions and swap_log (and swap_log's checks would refuse that for fleet
--     and wallet swaps, failing the whole migration).
--   * Triggers on users are dropped with it (payments_anonymize_on_user_delete) and are
--     created again below.
-- So every table that references users, directly or through reservations or drivers,
-- is copied aside and emptied before the drop (children first), and put back after the
-- rename (parents first). That includes wallets, which has no ON DELETE action: the drop
-- counts its rows as deferred foreign key violations that a commit would refuse, even
-- after the new table took the old name (checked with SQLite 3.50, test below).
-- users keeps every column in the same order. One change besides the role: an account
-- may have neither phone nor e-mail while it is a customer account without a PIN. Those
-- are the customer accounts 0031 opens for converted drivers, which the person claims
-- later with a number or address of their own (worker/former-accounts.ts). Every other
-- way of creating an account sets a phone number or an e-mail address, as before.
-- Indexes on users: only the unique ones of phone and e-mail, which come with the table.
--
-- Code: worker/roles.ts, worker/drivers.ts. Test: worker/migration-0030.test.ts.
-- Apply: npx wrangler d1 migrations apply DB --remote
PRAGMA defer_foreign_keys = on;

-- 1. Copy aside.
create table m30_sessions as select * from sessions;
create table m30_wallets as select * from wallets;
create table m30_station_staff as select * from station_staff;
create table m30_operator_owners as select * from operator_owners;
create table m30_reservations as select * from reservations;
create table m30_payments as select * from payments;
create table m30_drivers as select * from drivers;
create table m30_driver_queue as select * from driver_queue;
create table m30_fleet_manager_drivers as select * from fleet_manager_drivers;
create table m30_wallet_topups as select * from wallet_topups;
create table m30_wallet_transactions as select * from wallet_transactions;
create table m30_greenpoint_ledger as select * from greenpoint_ledger;
create table m30_greenpoint_redemptions as select * from greenpoint_redemptions;
create table m30_station_reviews as select * from station_reviews;
create table m30_charging_sessions as select * from charging_sessions;
create table m30_swap_log as select * from swap_log;

-- 2. Empty them, children first, so dropping users has nothing to cascade into or set to null.
delete from driver_queue;
delete from fleet_manager_drivers;
delete from swap_log;
delete from greenpoint_ledger;
delete from payments;
delete from drivers;
delete from reservations;
delete from sessions;
delete from station_staff;
delete from operator_owners;
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
  -- 'rider' is the customer (worker/roles.ts).
  role text not null default 'rider' check (role in ('rider', 'operator', 'fleet_manager', 'admin', 'driver')),
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
create table m30_check (ok integer not null check (ok = 1));
insert into m30_check select (select count(*) from users_new) = (select count(*) from users);

drop table users;
alter table users_new rename to users;

-- 4. Put everything back, parents first. The insert trigger of reservations (0029) would
-- change kind on rows it should leave as they are, so it is off while they go back.
drop trigger reservations_kind_from_type;
insert into reservations select * from m30_reservations;
insert into drivers select * from m30_drivers;
insert into sessions select * from m30_sessions;
insert into wallets select * from m30_wallets;
insert into station_staff select * from m30_station_staff;
insert into operator_owners select * from m30_operator_owners;
insert into payments select * from m30_payments;
insert into driver_queue select * from m30_driver_queue;
insert into fleet_manager_drivers select * from m30_fleet_manager_drivers;
insert into wallet_topups select * from m30_wallet_topups;
insert into wallet_transactions select * from m30_wallet_transactions;
insert into greenpoint_ledger select * from m30_greenpoint_ledger;
insert into greenpoint_redemptions select * from m30_greenpoint_redemptions;
insert into station_reviews select * from m30_station_reviews;
insert into charging_sessions select * from m30_charging_sessions;
insert into swap_log select * from m30_swap_log;

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
insert into m30_check select
  (select count(*) from sessions) = (select count(*) from m30_sessions)
  and (select count(*) from wallets) = (select count(*) from m30_wallets)
  and (select count(*) from station_staff) = (select count(*) from m30_station_staff)
  and (select count(*) from operator_owners) = (select count(*) from m30_operator_owners)
  and (select count(*) from reservations) = (select count(*) from m30_reservations)
  and (select count(*) from payments) = (select count(*) from m30_payments)
  and (select count(*) from drivers) = (select count(*) from m30_drivers)
  and (select count(*) from driver_queue) = (select count(*) from m30_driver_queue)
  and (select count(*) from fleet_manager_drivers) = (select count(*) from m30_fleet_manager_drivers)
  and (select count(*) from wallet_topups) = (select count(*) from m30_wallet_topups)
  and (select count(*) from wallet_transactions) = (select count(*) from m30_wallet_transactions)
  and (select count(*) from greenpoint_ledger) = (select count(*) from m30_greenpoint_ledger)
  and (select count(*) from greenpoint_redemptions) = (select count(*) from m30_greenpoint_redemptions)
  and (select count(*) from station_reviews) = (select count(*) from m30_station_reviews)
  and (select count(*) from charging_sessions) = (select count(*) from m30_charging_sessions)
  and (select count(*) from swap_log) = (select count(*) from m30_swap_log);

drop table m30_check;
drop table m30_sessions;
drop table m30_wallets;
drop table m30_station_staff;
drop table m30_operator_owners;
drop table m30_reservations;
drop table m30_payments;
drop table m30_drivers;
drop table m30_driver_queue;
drop table m30_fleet_manager_drivers;
drop table m30_wallet_topups;
drop table m30_wallet_transactions;
drop table m30_greenpoint_ledger;
drop table m30_greenpoint_redemptions;
drop table m30_station_reviews;
drop table m30_charging_sessions;
drop table m30_swap_log;
