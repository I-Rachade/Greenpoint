import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0030 rebuilds users to add the role 'driver' (plan phase 5, R16): nothing in
// any table that references users, directly or through reservations or drivers, may change.

/** Every table that references users (found with pragma foreign_key_list after 0029), plus users. */
const TABLES = [
  "users",
  "sessions",
  "station_staff",
  "operator_owners",
  "reservations",
  "payments",
  "drivers",
  "driver_queue",
  "fleet_manager_drivers",
  "wallets",
  "wallet_topups",
  "wallet_transactions",
  "greenpoint_ledger",
  "greenpoint_redemptions",
  "station_reviews",
  "charging_sessions",
  "swap_log",
];

const T = "2026-10-15T10:00:00.000Z";

function seed(db: DatabaseSync) {
  db.exec(`
    insert into users (id, phone, email, full_name, role, created_at, last_sign_in_at, pin_hash, pin_failures, pin_locked_until, greenpoint_vehicle) values
      ('admin', '+22890000001', null, 'Admin', 'admin', '${T}', '${T}', 'hash-a', 0, null, null),
      ('owner', '+22890000002', 'owner@example.tg', 'Yao', 'operator', '${T}', null, 'hash-o', 2, '${T}', null),
      ('staff', '+22890000003', null, 'Afi', 'operator', '${T}', null, 'hash-s', 0, null, null),
      ('ama', null, 'ama@example.tg', 'Ama', 'rider', '${T}', '${T}', 'hash-r', 0, null, 'moped'),
      ('kofi', '+22890000005', null, 'Kofi', 'rider', '${T}', null, 'hash-k', 0, null, 'scooter'),
      ('edem', '+22890000006', null, 'Edem', 'fleet_manager', '${T}', null, 'hash-e', 0, null, null);
    insert into operators (id, name, is_own, created_at) values ('op', 'Partenaire', 0, '${T}');
    insert into operator_owners (operator_id, user_id, created_at) values ('op', 'owner', '${T}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values ('st', 'op', 'Bè', 6.13, 1.22, 'both', '${T}');
    insert into station_staff (station_id, user_id) values ('st', 'staff');
    insert into charging_points (id, station_id, label, created_at) values ('cp', 'st', 'P1', '${T}');
    insert into sessions (token_hash, user_id, created_at, expires_at) values
      ('tok-ama', 'ama', '${T}', '2026-12-01T00:00:00.000Z'), ('tok-kofi', 'kofi', '${T}', '2026-12-01T00:00:00.000Z'),
      ('tok-staff', 'staff', '${T}', '2026-12-01T00:00:00.000Z');
    insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code, kind, target) values
      ('r-active', 'ama', 'st', 'battery', 'active', '${T}', '2026-12-01T00:00:00.000Z', '1234', 'swap', 'bt'),
      ('r-done', 'ama', 'st', 'slot', 'completed', '${T}', '${T}', '2345', 'charging_point', 'cp'),
      ('r-kofi', 'kofi', 'st', 'battery', 'cancelled', '${T}', '${T}', '3456', 'swap', null),
      ('r-odd', 'kofi', 'st', 'slot', 'expired', '${T}', '${T}', '4567', 'swap', null);
    -- A row the insert trigger of 0029 would change if it fired while rows go back.
    update reservations set kind = 'swap' where id = 'r-odd';
    insert into payments (id, identifier, user_id, station_id, reservation_id, amount_xof, network, phone, provider, status, created_at, updated_at) values
      ('pay-1', 'PAY-1', 'ama', 'st', 'r-done', 500, 'flooz', '+22891234567', 'mock', 'succeeded', '${T}', '${T}');
    insert into fleet_vehicles (id, type, plate, created_at) values ('v1', 'moto', 'TG 1', '${T}');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('st', 1, '', 0, '${T}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', 'v1', 'ABCDEFGH', '${T}');
    insert into driver_queue (driver_id, station_id, since) values ('kofi', 'st', '${T}');
    insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}');
    insert into wallets (user_id, balance_xof, status, created_at, updated_at) values ('ama', 2500, 'active', '${T}', '${T}'), ('kofi', 700, 'frozen', '${T}', '${T}');
    insert into wallet_topups (id, identifier, user_id, amount_xof, network, phone, provider, status, created_at, updated_at) values
      ('top-1', 'pdw_1', 'ama', 3000, 'tmoney', '+22891234567', 'mock', 'succeeded', '${T}', '${T}');
    insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof, counterparty_user_id, counterparty_label, created_at) values
      ('tx-1', 'TRX1', 'ama', 'transfer', 'send', 500, 0, 500, 2500, 'kofi', 'Kofi', '${T}'),
      ('tx-2', 'TRX1', 'kofi', 'transfer', 'received', 500, 0, 500, 700, 'ama', 'Ama', '${T}');
    insert into greenpoint_ledger (id, user_id, kind, co2_grams, points, vehicle, station_id, reservation_id, job_id, distance_m, created_at) values
      ('gp-1', 'ama', 'charge', 1000, 10, 'moped', 'st', 'r-done', null, null, '${T}'),
      ('gp-2', 'kofi', 'delivery', 600, 6, 'moto', 'st', null, 'job-1', 15000, '${T}');
    insert into greenpoint_redemptions (id, user_id, reward_id, code, cost_points, status, expires_at, created_at) values
      ('red-1', 'ama', 'free-swap', '123456', 150, 'open', '2026-12-01T00:00:00.000Z', '${T}');
    insert into station_reviews (id, station_id, user_id, rating, comment, created_at, updated_at) values ('rev-1', 'st', 'ama', 5, 'Top', '${T}', '${T}');
    insert into charging_sessions (id, station_id, charging_point_id, device_id, outlet, point_label, user_id, status, kwh_xof, min_xof, started_by, started_at) values
      ('cs-1', 'st', 'cp', 'dev-1', 1, 'P1', 'ama', 'paid', 150, 100, 'staff', '${T}');
    insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, customer_user_id, driver_id, fleet_manager_id, reservation_id, payment, amount_xof, staff_id, role, created_at) values
      ('sw-fleet', 'req-1', 'st', 1, 'fleet', null, 'kofi', 'edem', null, 'fleet', 500, 'staff', 'staff', '${T}'),
      ('sw-wallet', 'req-2', 'st', 1, 'app', 'ama', null, null, 'r-active', 'wallet', 500, 'staff', 'staff', '${T}');
  `);
}

function snapshot(db: DatabaseSync): Record<string, unknown[]> {
  return Object.fromEntries(TABLES.map((t) => [t, db.prepare(`select * from ${t} order by 1, 2`).all()]));
}

describe("migration 0030: users rebuilt with the role 'driver' (R16)", () => {
  it("covers every table that references users", () => {
    const { db } = fakeD1({ before: "0030" });
    const tables = (db.prepare("select name from sqlite_master where type = 'table'").all() as { name: string }[]).map((r) => r.name);
    // Directly, or through reservations and drivers, whose rows the drop would delete too.
    const parents = new Set(["users", "reservations", "drivers"]);
    const referencing = tables.filter((t) =>
      (db.prepare(`pragma foreign_key_list("${t}")`).all() as { table: string }[]).some((fk) => parents.has(fk.table)),
    );
    expect(referencing.sort()).toEqual(TABLES.filter((t) => t !== "users").sort());
  });

  it("keeps every row and value of users and of every table that references it", () => {
    const { db } = fakeD1({ before: "0030" });
    seed(db);
    const before = snapshot(db);
    for (const t of TABLES) expect(before[t].length, t).toBeGreaterThan(0);
    const columns = db.prepare("pragma table_info(users)").all();

    applyMigration(db, "0030_driver_role.sql");

    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("pragma table_info(users)").all()).toEqual(columns);
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(db.prepare("select name from sqlite_master where name like 'm30_%' or name = 'users_new'").all()).toEqual([]);
  });

  it("accepts the role 'driver' and still refuses unknown roles and accounts without contact", () => {
    const { db } = fakeD1({ before: "0030" });
    seed(db);
    expect(() => db.exec("update users set role = 'driver' where id = 'kofi'")).toThrow(/CHECK/);
    applyMigration(db, "0030_driver_role.sql");
    db.exec("update users set role = 'driver' where id = 'kofi'");
    expect(() => db.exec("update users set role = 'boss' where id = 'kofi'")).toThrow(/CHECK/);
    // Only a customer account without PIN may wait without contact (0031).
    db.exec(`insert into users (id, role, created_at) values ('waiting', 'rider', '${T}')`);
    expect(() => db.exec(`insert into users (id, role, created_at, pin_hash) values ('w2', 'rider', '${T}', 'x')`)).toThrow(/CHECK/);
    expect(() => db.exec(`insert into users (id, role, created_at) values ('w3', 'driver', '${T}')`)).toThrow(/CHECK/);
    expect(() => db.exec(`insert into users (id, phone, role, created_at) values ('w4', '+22890000001', 'rider', '${T}')`)).toThrow(/UNIQUE/);
  });

  it("brings back the triggers on users and reservations", () => {
    const { db } = fakeD1({ before: "0030" });
    seed(db);
    applyMigration(db, "0030_driver_role.sql");
    const triggers = (db.prepare("select name from sqlite_master where type = 'trigger' order by name").all() as { name: string }[]).map((r) => r.name);
    expect(triggers).toEqual(expect.arrayContaining(["payments_anonymize_on_user_delete", "reservations_kind_from_type"]));
    db.exec(`insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code) values ('r-new', 'ama', 'st', 'slot', 'cancelled', '${T}', '${T}', '9999')`);
    expect(db.prepare("select kind from reservations where id = 'r-new'").get()).toEqual({ kind: "charging_point" });
    // Deleting an account still anonymizes its payments, as before.
    db.exec("delete from swap_log; delete from wallets where user_id = 'ama'; delete from users where id = 'ama'");
    expect(db.prepare("select user_id, phone from payments where id = 'pay-1'").get()).toEqual({ user_id: null, phone: null });
  });

  it("changes nothing when it fails half way", () => {
    const { db } = fakeD1({ before: "0030" });
    seed(db);
    const before = snapshot(db);
    // A leftover table with a name the migration needs makes it fail after the copies began.
    db.exec("create table m30_check (x)");
    expect(() => applyMigration(db, "0030_driver_role.sql")).toThrow();
    db.exec("drop table m30_check");
    expect(snapshot(db)).toEqual(before);
  });
});
