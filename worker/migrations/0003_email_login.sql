-- Accounts with an e-mail address, a phone number, or both. Registration,
-- "PIN forgotten" and account deletion are confirmed with a code sent by SMS
-- or by e-mail.
--
-- SQLite cannot drop NOT NULL from users.phone, so the table is rebuilt.
-- D1 always enforces foreign keys and dropping users would cascade into its
-- child tables (PRAGMA foreign_keys = off is ignored, checked on a scratch
-- D1 database), so those rows are copied aside first and put back afterwards.
--
-- Must run before 0003_payments.sql (Flooz/T-Money): payments.user_id would
-- otherwise be set to null and its trigger on users dropped. The file name
-- sorts before it, so applying both together keeps the right order.
-- Apply: npx wrangler d1 migrations apply DB --remote
PRAGMA defer_foreign_keys = on;

create table backup_sessions as select * from sessions;
create table backup_station_staff as select * from station_staff;
create table backup_reservations as select * from reservations;

create table users_new (
  id text primary key,
  phone text unique check (phone is null or phone glob '+228[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),
  -- Stored in lower case.
  email text unique check (email is null or (email = lower(email) and length(email) <= 254 and email like '_%@_%._%')),
  full_name text,
  role text not null default 'rider' check (role in ('rider', 'operator', 'fleet_manager', 'admin')),
  created_at text not null,
  last_sign_in_at text,
  pin_hash text,
  pin_failures integer not null default 0,
  pin_locked_until text,
  check (phone is not null or email is not null)
);
insert into users_new (id, phone, full_name, role, created_at, last_sign_in_at, pin_hash, pin_failures, pin_locked_until)
  select id, phone, full_name, role, created_at, last_sign_in_at, pin_hash, pin_failures, pin_locked_until from users;

drop table users;
alter table users_new rename to users;

insert into sessions select * from backup_sessions;
insert into station_staff select * from backup_station_staff;
insert into reservations select * from backup_reservations;
drop table backup_sessions;
drop table backup_station_staff;
drop table backup_reservations;

-- Codes go to a phone number or an e-mail address.
alter table otp_codes rename column phone to target;
