-- Existing drivers become driver accounts (plan phase 5, "Folgen für bestehende Konten",
-- invariant R16). Needs 0030 (role 'driver', customer accounts without contact).
--
-- Converted: accounts with an approved driver row (drivers.status 'active' or 'suspended')
-- that are customer accounts (users.role = 'rider'). Applications that are pending or
-- were refused stay on their customer account, as before.
-- NOT converted: approved drivers whose account has another role (station staff,
-- fleet manager, admin). They keep that role and lose the driver page, since driver
-- routes now need the driver role. Before applying, list them and decide with the owner:
--   select d.user_id, d.full_name, u.role from drivers d join users u on u.id = d.user_id
--   where d.status in ('active', 'suspended') and u.role <> 'rider';
--
-- A driver is never a customer, but the person's customer things must not get lost
-- (one phone number = one account, so they cannot stay on it):
--   * Wallet and greenpoints move to a NEW customer account for the same person. It has no
--     phone number, e-mail address or PIN yet: nobody can sign in to it. The driver, signed
--     in on the driver account, sees what is waiting there on the driver page and claims it
--     with another number or address of theirs: a code goes there, and with that code and a
--     new PIN the waiting account becomes theirs (worker/former-accounts.ts). The link
--     between the two accounts is former_rider_accounts below.
--     Moved: the wallet row (balance and status), the wallet history and top-ups (also
--     where the driver is the other party of a transfer), the greenpoint ledger except
--     trips, the greenpoint redemptions, the name and the greenpoint vehicle.
--     Greenpoints earned with trips (kind 'delivery') stay on the driver account, with
--     their CO2 and km, for the fleet's CO2 statistics (W10); their points go to the new
--     account as one correction row, and one opposite row takes them off the driver
--     account, so no row is rewritten and every total stays the same.
--     A driver without a wallet, greenpoints or redemptions gets no new account.
--   * Active reservations are cancelled (cancel_reason 'driver_account', which does not
--     count against the person's limits); the driver page shows how many.
--   * Parcels and booked trips stay on the driver account and finish as usual: a parcel is
--     picked up with its code, and the old history stays readable. New ones are refused.
--
-- The migration checks that the sum of all wallet balances and the sum of all greenpoints
-- are the same before and after, and fails as a whole otherwise.
-- BEFORE APPLYING REMOTELY: see 0030 (Time Travel bookmark; apply together with the new
-- Worker). Also note select sum(balance_xof) from wallets; and
-- select sum(points) from greenpoint_ledger; before and compare after.
--
-- Code: worker/former-accounts.ts, worker/drivers.ts. Test: worker/migration-0031.test.ts.
-- Apply: npx wrangler d1 migrations apply DB --remote

-- The customer account waiting for a converted driver. No foreign keys: the record stays
-- when one of the accounts is deleted (like driver_ledger).
create table former_rider_accounts (
  driver_id text primary key,
  -- Null: nothing to move, the row only carries the cancelled reservations.
  rider_id text unique,
  -- What moved, for the record and the driver page.
  balance_xof integer not null default 0,
  points integer not null default 0,
  cancelled_reservations integer not null default 0,
  created_at text not null,
  claimed_at text
);

create table m31_totals as select
  (select coalesce(sum(balance_xof), 0) from wallets) as balance,
  (select coalesce(sum(points), 0) from greenpoint_ledger) as points,
  (select count(*) from users) as users;

create table m31_convert as
  select u.id as driver_id, lower(hex(randomblob(16))) as h
  from users u join drivers d on d.user_id = u.id
  where d.status in ('active', 'suspended') and u.role = 'rider';

-- Who gets a customer account: anyone with a wallet, greenpoints or redemptions.
create table m31_move as
  select driver_id,
    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-4' || substr(h, 14, 3) || '-a' || substr(h, 18, 3) || '-' || substr(h, 21, 12) as rider_id
  from m31_convert c
  where exists (select 1 from wallets w where w.user_id = c.driver_id)
     or exists (select 1 from greenpoint_ledger g where g.user_id = c.driver_id)
     or exists (select 1 from greenpoint_redemptions r where r.user_id = c.driver_id)
     or exists (select 1 from wallet_topups t where t.user_id = c.driver_id);

insert into users (id, phone, email, full_name, role, created_at, greenpoint_vehicle)
  select m.rider_id, null, null, u.full_name, 'rider', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), u.greenpoint_vehicle
  from m31_move m join users u on u.id = m.driver_id;

insert into former_rider_accounts (driver_id, rider_id, balance_xof, points, created_at)
  select m.driver_id, m.rider_id,
    coalesce((select balance_xof from wallets where user_id = m.driver_id), 0),
    coalesce((select sum(points) from greenpoint_ledger where user_id = m.driver_id), 0),
    strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from m31_move m;

-- Wallet: the row itself (balance and frozen status), its history and top-ups.
update wallets set user_id = (select rider_id from m31_move where driver_id = wallets.user_id)
  where user_id in (select driver_id from m31_move);
update wallet_transactions set user_id = (select rider_id from m31_move where driver_id = wallet_transactions.user_id)
  where user_id in (select driver_id from m31_move);
update wallet_transactions set counterparty_user_id = (select rider_id from m31_move where driver_id = wallet_transactions.counterparty_user_id)
  where counterparty_user_id in (select driver_id from m31_move);
update wallet_topups set user_id = (select rider_id from m31_move where driver_id = wallet_topups.user_id)
  where user_id in (select driver_id from m31_move);

-- Greenpoints: everything but trips moves; the points of trips move as one correction.
update greenpoint_ledger set user_id = (select rider_id from m31_move where driver_id = greenpoint_ledger.user_id)
  where kind <> 'delivery' and user_id in (select driver_id from m31_move);
update greenpoint_redemptions set user_id = (select rider_id from m31_move where driver_id = greenpoint_redemptions.user_id)
  where user_id in (select driver_id from m31_move);
create table m31_trip_points as
  select m.driver_id, m.rider_id, sum(g.points) as points
  from m31_move m join greenpoint_ledger g on g.user_id = m.driver_id and g.kind = 'delivery'
  group by m.driver_id, m.rider_id
  having sum(g.points) <> 0;
insert into greenpoint_ledger (id, user_id, kind, co2_grams, points, created_by, created_at)
  select lower(hex(randomblob(16))), rider_id, 'admin_adjust', 0, points, 'migration-0031', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from m31_trip_points;
insert into greenpoint_ledger (id, user_id, kind, co2_grams, points, created_by, created_at)
  select lower(hex(randomblob(16))), driver_id, 'admin_adjust', 0, -points, 'migration-0031', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  from m31_trip_points;

-- Reservations: cancelled, counted for the driver page.
insert or ignore into former_rider_accounts (driver_id, rider_id, created_at)
  select c.driver_id, null, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') from m31_convert c
  where c.driver_id not in (select driver_id from m31_move)
    and exists (select 1 from reservations r where r.user_id = c.driver_id and r.status = 'active');
update former_rider_accounts set cancelled_reservations =
    (select count(*) from reservations r where r.user_id = former_rider_accounts.driver_id and r.status = 'active')
  where driver_id in (select driver_id from m31_convert);
insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes)
  select strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), null, 'reservations', 'update', r.id, r.station_id, r.user_id,
    '{"status":["active","cancelled"],"cancel_reason":[null,"driver_account"]}'
  from reservations r where r.status = 'active' and r.user_id in (select driver_id from m31_convert);
update reservations set status = 'cancelled', cancel_reason = 'driver_account'
  where status = 'active' and user_id in (select driver_id from m31_convert);

-- The role.
insert into audit_log (at, actor, table_name, action, row_id, user_id, changes)
  select strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), null, 'profiles', 'update', c.driver_id, c.driver_id,
    json_object('role', json_array('customer', 'driver'), 'former_account', (select rider_id from m31_move m where m.driver_id = c.driver_id))
  from m31_convert c;
update users set role = 'driver' where id in (select driver_id from m31_convert);

-- Same money and greenpoints in total, or nothing is applied.
create table m31_check (ok integer not null check (ok = 1));
insert into m31_check select
  (select coalesce(sum(balance_xof), 0) from wallets) = (select balance from m31_totals)
  and (select coalesce(sum(points), 0) from greenpoint_ledger) = (select points from m31_totals)
  and (select count(*) from users) = (select users from m31_totals) + (select count(*) from m31_move)
  and not exists (select 1 from wallets where user_id in (select driver_id from m31_convert))
  and not exists (
    select 1 from m31_convert c
    where (select coalesce(sum(points), 0) from greenpoint_ledger where user_id = c.driver_id) <> 0
  );

drop table m31_check;
drop table m31_trip_points;
drop table m31_move;
drop table m31_convert;
drop table m31_totals;
