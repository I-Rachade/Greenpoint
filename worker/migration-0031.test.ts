import { describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { DriverHome } from "../src/lib/drivers";
import type { GreenpointView } from "../src/lib/greenpoint";
import type { Profile, Reservation } from "../src/lib/types";
import type { WalletView } from "../src/lib/wallet";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { applyMigration, fakeD1 } from "./test-d1";

// Migration 0031 makes existing drivers driver accounts and moves their wallet and
// greenpoints to a new customer account the person claims later (plan phase 5, R16).

const T = "2026-10-15T10:00:00.000Z";
const LATER = "2099-01-01T00:00:00.000Z";

function seed(db: DatabaseSync) {
  db.exec(`
    insert into users (id, phone, email, full_name, role, created_at, pin_hash, greenpoint_vehicle) values
      ('ama', '+22890000004', null, 'Ama', 'rider', '${T}', 'h', null),
      ('kofi', '+22890000005', null, 'Kofi', 'rider', '${T}', 'h', 'moped'),
      ('yawa', '+22890000006', null, 'Yawa', 'rider', '${T}', 'h', null),
      ('esi', '+22890000007', null, 'Esi', 'rider', '${T}', 'h', null),
      ('pend', '+22890000008', null, 'Pend', 'rider', '${T}', 'h', null),
      ('staffer', '+22890000009', null, 'Comptoir', 'operator', '${T}', 'h', null),
      ('edem', '+22890000010', null, 'Edem', 'fleet_manager', '${T}', 'h', null);
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('st', '00000000-0000-4000-8000-000000000001', 'Bè', 6.13, 1.22, 'both', '${T}'),
      ('st2', '00000000-0000-4000-8000-000000000001', 'Lomé', 6.14, 1.23, 'both', '${T}');
    insert into fleet_vehicles (id, type, plate, created_at) values ('v1', 'moto', 'TG 1', '${T}'), ('v2', 'moto', 'TG 2', '${T}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', 'v1', 'ABCDEFGH', '${T}'),
      ('yawa', 'suspended', 'Yawa', 'ID002', 'LIC002', 'moto', 'v2', 'HGFEDCBA', '${T}'),
      ('esi', 'active', 'Esi', 'ID003', 'LIC003', 'moto', null, 'ABCDEFGJ', '${T}'),
      ('pend', 'pending', 'Pend', 'ID004', 'LIC004', 'moto', null, 'ABCDEFGK', '${T}'),
      ('staffer', 'active', 'Comptoir', 'ID005', 'LIC005', 'moto', null, 'ABCDEFGM', '${T}');
    insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}');
    insert into wallets (user_id, balance_xof, status, created_at, updated_at) values
      ('ama', 2500, 'active', '${T}', '${T}'), ('kofi', 700, 'active', '${T}', '${T}'), ('pend', 300, 'active', '${T}', '${T}');
    insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof, counterparty_user_id, counterparty_label, created_at) values
      ('tx-1', 'TRX1', 'ama', 'transfer', 'send', 700, 0, 700, 2500, 'kofi', 'Kofi', '${T}'),
      ('tx-2', 'TRX1', 'kofi', 'transfer', 'received', 700, 0, 700, 700, 'ama', 'Ama', '${T}');
    insert into wallet_topups (id, identifier, user_id, amount_xof, network, phone, provider, status, created_at, updated_at) values
      ('top-1', 'pdw_1', 'kofi', 1000, 'tmoney', '+22890000005', 'mock', 'pending', '${T}', '${T}');
    insert into greenpoint_ledger (id, user_id, kind, co2_grams, points, vehicle, station_id, job_id, distance_m, created_at) values
      ('gp-ama', 'ama', 'charge', 1000, 10, 'moped', 'st', null, null, '${T}'),
      ('gp-swap', 'kofi', 'swap', 2000, 20, 'moped', 'st', null, null, '${T}'),
      ('gp-trip', 'kofi', 'delivery', 600, 6, 'moto', 'st', 'job-1', 15000, '${T}'),
      ('gp-redeem', 'kofi', 'redeem', 0, -5, null, null, null, null, '${T}');
    insert into greenpoint_redemptions (id, user_id, reward_id, code, cost_points, status, expires_at, created_at) values
      ('red-1', 'kofi', 'free-swap', '123456', 150, 'open', '${LATER}', '${T}');
    insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code, kind) values
      ('r-kofi', 'kofi', 'st', 'battery', 'active', '${T}', '${LATER}', '1234', 'swap'),
      ('r-kofi-old', 'kofi', 'st', 'battery', 'completed', '${T}', '${T}', '2345', 'swap'),
      ('r-yawa', 'yawa', 'st', 'battery', 'active', '${T}', '${LATER}', '3456', 'swap'),
      ('r-ama', 'ama', 'st', 'battery', 'active', '${T}', '${LATER}', '4567', 'swap');
    insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_phone, recipient_phone, recipient_user_id, content,
        length_cm, width_cm, height_cm, weight_kg, size, price_fcfa, status, pickup_code, created_at) values
      ('p-kofi', 'GP-AAAAAA', 'st2', 'st', '+22890000004', '+22890000005', 'kofi', 'Livre', 20, 10, 5, 1, 'S', 1000, 'arrived', '654321', '${T}');
  `);
}

const sum = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const totals = (db: DatabaseSync) => ({
  balance: sum(db, "select coalesce(sum(balance_xof), 0) as n from wallets"),
  points: sum(db, "select coalesce(sum(points), 0) as n from greenpoint_ledger"),
  co2: sum(db, "select coalesce(sum(co2_grams), 0) as n from greenpoint_ledger"),
  transactions: sum(db, "select count(*) as n from wallet_transactions"),
  topups: sum(db, "select count(*) as n from wallet_topups"),
  redemptions: sum(db, "select count(*) as n from greenpoint_redemptions"),
  reservations: sum(db, "select count(*) as n from reservations"),
  parcels: sum(db, "select count(*) as n from parcels"),
  sessions: sum(db, "select count(*) as n from sessions"),
  drivers: sum(db, "select count(*) as n from drivers"),
});

function migrated() {
  const { db, d1 } = fakeD1({ before: "0031" });
  seed(db);
  const before = totals(db);
  applyMigration(db, "0031_convert_drivers.sql");
  const rider = (db.prepare("select rider_id from former_rider_accounts where driver_id = 'kofi'").get() as { rider_id: string }).rider_id;
  return { db, d1, before, rider };
}

describe("migration 0031: existing drivers become driver accounts (R16)", () => {
  it("loses no money and no greenpoints: the sums before and after are the same", () => {
    const { db, before } = migrated();
    const after = totals(db);
    expect(after).toEqual(before);
    expect(db.prepare("pragma foreign_key_check").all()).toEqual([]);
    expect(db.prepare("select name from sqlite_master where name like 'm31_%'").all()).toEqual([]);
  });

  it("converts approved drivers on customer accounts only", () => {
    const { db } = migrated();
    const roles = Object.fromEntries((db.prepare("select id, role from users where id not like '%-%'").all() as { id: string; role: string }[]).map((r) => [r.id, r.role]));
    expect(roles).toEqual({ ama: "rider", kofi: "driver", yawa: "driver", esi: "driver", pend: "rider", staffer: "operator", edem: "fleet_manager" });
    expect(sum(db, "select balance_xof as n from wallets where user_id = 'pend'")).toBe(300);
    expect(db.prepare("select driver_id, rider_id is not null as has_account, balance_xof, points, cancelled_reservations from former_rider_accounts order by driver_id").all()).toEqual([
      { driver_id: "kofi", has_account: 1, balance_xof: 700, points: 21, cancelled_reservations: 1 },
      { driver_id: "yawa", has_account: 0, balance_xof: 0, points: 0, cancelled_reservations: 1 },
    ]);
    // Fleet link, vehicle and code stay.
    expect(db.prepare("select manager_id from fleet_manager_drivers where driver_id = 'kofi'").get()).toEqual({ manager_id: "edem" });
    expect(db.prepare("select vehicle_id, code from drivers where user_id = 'kofi'").get()).toEqual({ vehicle_id: "v1", code: "ABCDEFGH" });
  });

  it("moves wallet and greenpoints to a new customer account nobody can sign in to yet", () => {
    const { db, rider } = migrated();
    expect(db.prepare("select phone, email, pin_hash, full_name, role, greenpoint_vehicle from users where id = ?").get(rider)).toEqual({
      phone: null,
      email: null,
      pin_hash: null,
      full_name: "Kofi",
      role: "rider",
      greenpoint_vehicle: "moped",
    });
    expect(db.prepare("select user_id, balance_xof, status from wallets where user_id in ('kofi', ?)").all(rider)).toEqual([
      { user_id: rider, balance_xof: 700, status: "active" },
    ]);
    expect(db.prepare("select id, user_id, counterparty_user_id from wallet_transactions order by id").all()).toEqual([
      { id: "tx-1", user_id: "ama", counterparty_user_id: rider },
      { id: "tx-2", user_id: rider, counterparty_user_id: "ama" },
    ]);
    // A top-up still pending credits the new account when it goes through.
    expect(db.prepare("select user_id from wallet_topups").get()).toEqual({ user_id: rider });
    expect(db.prepare("select user_id from greenpoint_redemptions").get()).toEqual({ user_id: rider });
    // Trips stay with the driver for the fleet's CO2 statistics; their points move as one correction.
    expect(db.prepare("select id, user_id from greenpoint_ledger where id like 'gp-%' order by id").all()).toEqual([
      { id: "gp-ama", user_id: "ama" },
      { id: "gp-redeem", user_id: rider },
      { id: "gp-swap", user_id: rider },
      { id: "gp-trip", user_id: "kofi" },
    ]);
    expect(sum(db, "select sum(points) as n from greenpoint_ledger where user_id = 'kofi'")).toBe(0);
    expect(sum(db, "select sum(co2_grams) as n from greenpoint_ledger where user_id = 'kofi'")).toBe(600);
    expect(sum(db, `select sum(points) as n from greenpoint_ledger where user_id = '${rider}'`)).toBe(21);
  });

  it("cancels active reservations with a reason and leaves parcels and history where they were", () => {
    const { db } = migrated();
    expect(db.prepare("select id, status, cancel_reason from reservations order by id").all()).toEqual([
      { id: "r-ama", status: "active", cancel_reason: null },
      { id: "r-kofi", status: "cancelled", cancel_reason: "driver_account" },
      { id: "r-kofi-old", status: "completed", cancel_reason: null },
      { id: "r-yawa", status: "cancelled", cancel_reason: "driver_account" },
    ]);
    expect(db.prepare("select status, recipient_user_id from parcels").get()).toEqual({ status: "arrived", recipient_user_id: "kofi" });
    const audit = db.prepare("select table_name, row_id from audit_log order by id").all();
    expect(audit).toEqual(
      expect.arrayContaining([
        { table_name: "reservations", row_id: "r-kofi" },
        { table_name: "reservations", row_id: "r-yawa" },
        { table_name: "profiles", row_id: "kofi" },
        { table_name: "profiles", row_id: "esi" },
      ]),
    );
  });

  it("lets the driver claim the waiting account with a number of theirs and a new PIN", async () => {
    const { db, d1, rider } = migrated();
    const env = { DB: d1, TEST_OTP: "+22899000001=123456,+22890000004=123456" } as unknown as Env;
    const tokens: Record<string, string> = {};
    for (const id of ["kofi", "ama", "yawa"]) {
      tokens[id] = `token-of-${id}-0123456789`;
      db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(tokens[id]), id, T, LATER);
    }
    const call = async <B = unknown>(as: string | null, method: string, path: string, body?: unknown, token?: string) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (as || token) headers.Authorization = `Bearer ${token ?? tokens[as!]}`;
      const res = await handleApi(new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env);
      return { status: res.status, body: (await res.json()) as B };
    };

    const home = (await call<DriverHome>("kofi", "GET", "/api/driver")).body;
    expect(home.formerAccount).toEqual({ balanceXof: 700, points: 21, cancelledReservations: 1, claimed: false, claimable: true });
    expect((await call<DriverHome>("yawa", "GET", "/api/driver")).body.formerAccount).toEqual({
      balanceXof: 0,
      points: 0,
      cancelledReservations: 1,
      claimed: false,
      claimable: false,
    });
    expect((await call("yawa", "POST", "/api/driver/former-account/code", { contact: "99000001" })).status).toBe(404);
    expect((await call("ama", "POST", "/api/driver/former-account/code", { contact: "99000001" })).status).toBe(403);
    // A number that already has an account cannot take it.
    expect((await call("kofi", "POST", "/api/driver/former-account/code", { contact: "90000004" })).body).toEqual({ error: "contact_taken" });
    expect((await call("kofi", "POST", "/api/driver/former-account/code", { contact: "99000001" })).status).toBe(200);
    expect((await call("kofi", "POST", "/api/driver/former-account/claim", { contact: "99000001", code: "000000", pin: "2580" })).body).toEqual({
      error: "invalid_code",
    });
    await call("kofi", "POST", "/api/driver/former-account/code", { contact: "99000001" });
    const claimed = await call("kofi", "POST", "/api/driver/former-account/claim", { contact: "99000001", code: "123456", pin: "2580" });
    expect(claimed.body).toMatchObject({ claimed: true, claimable: false, balanceXof: 700 });
    expect(db.prepare("select phone from users where id = ?").get(rider)).toEqual({ phone: "+22899000001" });
    // Only once.
    expect((await call("kofi", "POST", "/api/driver/former-account/code", { contact: "99000002" })).status).toBe(404);

    // The person signs in to it like to any customer account and finds money and greenpoints.
    const login = await call<{ token: string; profile: Profile }>(null, "POST", "/api/auth/login", { contact: "99000001", pin: "2580" });
    expect(login.body.profile).toMatchObject({ id: rider, role: "customer" });
    const wallet = (await call<WalletView>(null, "GET", "/api/wallet", undefined, login.body.token)).body;
    expect(wallet.balanceXof).toBe(700);
    expect(wallet.transactions).toHaveLength(1);
    expect((await call<GreenpointView>(null, "GET", "/api/greenpoint", undefined, login.body.token)).body.points).toBe(21);
  });

  it("keeps a driver with an unclaimed account from deleting theirs", async () => {
    const { db, d1 } = migrated();
    const env = { DB: d1, TEST_OTP: "+22890000005=123456" } as unknown as Env;
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256("token-of-kofi-0123456789"), "kofi", T, LATER);
    const headers = { "Content-Type": "application/json", Authorization: "Bearer token-of-kofi-0123456789" };
    await handleApi(new Request("https://app.poinderecharge.com/api/auth/delete-account/send", { method: "POST", headers, body: JSON.stringify({ channel: "sms" }) }), env);
    const res = await handleApi(
      new Request("https://app.poinderecharge.com/api/auth/delete-account", { method: "POST", headers, body: JSON.stringify({ channel: "sms", code: "123456" }) }),
      env,
    );
    expect(await res.json()).toEqual({ error: "wallet_not_empty" });
    expect(db.prepare("select count(*) as n from users where id = 'kofi'").get()).toEqual({ n: 1 });
  });

  it("shows the cancelled reservations to the driver with their reason", async () => {
    const { db, d1 } = migrated();
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256("token-of-kofi-0123456789"), "kofi", T, LATER);
    const res = await handleApi(
      new Request("https://app.poinderecharge.com/api/reservations/mine", { headers: { Authorization: "Bearer token-of-kofi-0123456789" } }),
      { DB: d1 } as unknown as Env,
    );
    const list = (await res.json()) as Reservation[];
    expect(list.find((r) => r.id === "r-kofi")).toMatchObject({ status: "cancelled", cancelReason: "driver_account" });
  });
});
