import { beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";

// The driver role (plan phase 5): drivers are not customers (R11), driver routes need the
// driver role and not just a drivers row, and the role changes only with nothing open (R15).

const OWN = "00000000-0000-4000-8000-000000000001";
const PIN = "2580";
const T = new Date().toISOString();
const LATER = "2099-01-01T00:00:00.000Z";
const USERS = [
  ["admin", "+22890000001", "admin"],
  ["afi", "+22890000002", "operator"],
  ["ama", "+22890000003", "rider"],
  ["kofi", "+22890000004", "driver"],
  ["yawa", "+22890000005", "rider"], // an active drivers row, but a customer account (not converted)
  ["esi", "+22890000006", "rider"], // applies to drive
  ["edem", "+22890000007", "fleet_manager"],
] as const;

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1, MEDIA: { put: async () => {}, delete: async () => {} } } as unknown as Env;
  for (const [id, phone, role] of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(id, phone, id, role, T, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`token-of-${id}-0123456789`), id, T, LATER);
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, created_at) values
      ('st', '${OWN}', 'Bè', 6.1319, 1.2228, 'both', 10, '00:00-24:00', '${T}'), ('st2', '${OWN}', 'Lomé', 6.17, 1.21, 'both', 10, '00:00-24:00', '${T}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('st', 1, 2, 3, '${T}');
    insert into station_staff (station_id, user_id) values ('st', 'afi');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('st', 1, '', 0, '${T}'), ('st2', 1, '', 0, '${T}');
    insert into app_settings (key, value, updated_at) values ('drivers_enabled', '1', '${T}');
    insert into fleet_vehicles (id, type, plate, created_at) values ('v1', 'moto', 'TG 1', '${T}'), ('v2', 'moto', 'TG 2', '${T}'), ('v3', 'moto', 'TG 3', '${T}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at,
        id_doc_key, license_doc_key, portrait_key) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', 'v1', 'ABCDEFGH', '${T}', null, null, null),
      ('yawa', 'active', 'Yawa', 'ID002', 'LIC002', 'moto', 'v2', 'HGFEDCBA', '${T}', null, null, null),
      ('esi', 'pending', 'Esi', 'ID003', 'LIC003', 'moto', null, 'ABCDEFGJ', '${T}', 'drivers/esi/id-1.jpg', 'drivers/esi/license-1.jpg', 'drivers/esi/portrait-1.jpg');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 5000, '${T}', '${T}');
  `);
  return { db, env };
}

async function call<B = unknown>(env: Env, as: string, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer token-of-${as}-0123456789` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as B };
}

const HOME = { lat: 6.175, lng: 1.215, note: "Portail bleu", phone: "90 11 22 33" };
const role = (db: DatabaseSync, id: string) => (db.prepare("select role from users where id = ?").get(id) as { role: string }).role;

describe("drivers are not customers (R11)", () => {
  const customerRoutes: [string, string, unknown?][] = [
    ["GET", "/api/wallet"],
    ["POST", "/api/wallet/code", { pin: PIN }],
    ["GET", "/api/greenpoint"],
    ["POST", "/api/greenpoint/vehicle", { vehicle: "moped" }],
    ["POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" }],
    ["POST", "/api/reservations", { stationId: "st", kind: "swap" }],
    ["POST", "/api/jobs/pickup", { home: HOME, toStationId: "st2", recipientPhone: "90000003", content: "Livre", size: "S" }],
    ["POST", "/api/jobs/courier", { pickup: HOME, dropoff: { ...HOME, lat: 6.18 }, recipientPhone: "90000003", content: "Livre", size: "S" }],
    ["POST", "/api/jobs/ride", { pickup: HOME, dropoff: { ...HOME, lat: 6.18 }, passengers: 1 }],
    ["POST", "/api/parcels/p1/delivery", { home: HOME }],
  ];

  it.each(customerRoutes)("%s %s answers 403 to a driver", async (method, path, body) => {
    const { env } = await setup();
    expect((await call(env, "kofi", method, path, body)).status).toBe(403);
  });

  it("still lets customers use the same routes", async () => {
    const { env } = await setup();
    expect((await call(env, "ama", "GET", "/api/wallet")).status).toBe(200);
    expect((await call(env, "ama", "GET", "/api/greenpoint")).status).toBe(200);
    expect((await call(env, "ama", "POST", "/api/reservations", { stationId: "st", kind: "swap" })).status).toBe(200);
  });

  it("gives drivers no greenpoints for their trips (W10)", async () => {
    const { env, db } = await setup();
    db.exec(`insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, collect_fcfa, driver_id, created_at, from_station_id, to_station_id)
      values ('j1', 'express', 'open', 'S', 5000, 1500, 0, null, '${T}', 'st', 'st2')`);
    const { tripStatement } = await import("./greenpoint");
    await (await tripStatement(env.DB, { driverId: "kofi", jobId: "j1", distanceMeters: 5000, stationId: "st", createdBy: "kofi" }))!.run();
    expect(db.prepare("select points, co2_grams > 0 as co2, distance_m from greenpoint_ledger where user_id = 'kofi'").get()).toEqual({ points: 0, co2: 1, distance_m: 5000 });
  });
});

describe("driver routes need the driver role (R1)", () => {
  it("refuses a customer account with an active drivers row", async () => {
    const { env } = await setup();
    expect((await call(env, "yawa", "GET", "/api/driver/pass")).status).toBe(403);
    expect((await call(env, "yawa", "POST", "/api/driver/queue", { stationId: "st", position: { lat: 6.1319, lng: 1.2228 } })).status).toBe(403);
    expect((await call(env, "yawa", "POST", "/api/driver/jobs/j1/accept")).status).toBe(403);
    expect((await call(env, "kofi", "GET", "/api/driver/pass")).status).toBe(200);
  });

  it("does not offer trips to a customer account in the queue, nor let staff scan it", async () => {
    const { env, db } = await setup();
    db.exec(`insert into driver_queue (driver_id, station_id, since) values ('yawa', 'st', '${T}');
      insert into station_services (station_id, service, unlocked, status) values ('st', 'drivers', 1, 'approved') on conflict do update set unlocked = 1;
      insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, collect_fcfa, created_at, from_station_id, to_station_id)
      values ('j1', 'express', 'open', 'S', 5000, 1500, 0, '${T}', 'st', 'st2')`);
    await call(env, "afi", "GET", "/api/stations/st/drivers");
    expect(db.prepare("select status, driver_id from delivery_jobs where id = 'j1'").get()).toEqual({ status: "open", driver_id: null });
    expect((await call(env, "afi", "POST", "/api/stations/st/drivers/scan", { badge: "HGFEDCBA" })).status).toBe(404);
  });

  it("lets only customers apply", async () => {
    const { env } = await setup();
    const application = { fullName: "Afi", idNumber: "ID999", licenseNumber: "LIC999", wantedType: "moto" };
    for (const as of ["afi", "edem", "admin", "kofi"]) expect((await call(env, as, "POST", "/api/driver/apply", application)).status).toBe(403);
    expect((await call(env, "ama", "POST", "/api/driver/apply", application)).status).toBe(200);
  });
});

describe("role change only with nothing open (R15)", () => {
  const approve = (env: Env) => call(env, "admin", "POST", "/api/admin/drivers/esi/review", { action: "approve", vehicleId: "v3" });

  it("approving a customer makes the account a driver account", async () => {
    const { env, db } = await setup();
    expect((await approve(env)).status).toBe(200);
    expect(role(db, "esi")).toBe("driver");
    expect(db.prepare("select status, vehicle_id from drivers where user_id = 'esi'").get()).toEqual({ status: "active", vehicle_id: "v3" });
    expect((await call(env, "esi", "GET", "/api/wallet")).status).toBe(403);
    expect((await call(env, "esi", "GET", "/api/driver/pass")).status).toBe(200);
  });

  it.each([
    ["money in the wallet", `insert into wallets (user_id, balance_xof, created_at, updated_at) values ('esi', 100, '${T}', '${T}')`],
    ["an active reservation", `insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code) values ('r1', 'esi', 'st', 'battery', 'active', '${T}', '${LATER}', '1234')`],
    [
      "a parcel to collect",
      `insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_phone, recipient_phone, content, length_cm, width_cm, height_cm, weight_kg, size, price_fcfa, status, created_at)
       values ('p1', 'GP-AAAAAA', 'st', 'st2', '+22890000003', '+22890000006', 'Livre', 20, 10, 5, 1, 'S', 1000, 'in_transit', '${T}')`,
    ],
    [
      "a booked trip",
      `insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, collect_fcfa, customer_user_id, created_at) values ('j1', 'ride', 'open', 'S', 5000, 1500, 1500, 'esi', '${T}')`,
    ],
  ])("is refused with %s", async (_, sql) => {
    const { env, db } = await setup();
    db.exec(sql);
    expect((await approve(env)).body).toEqual({ error: "role_change_blocked" });
    expect(role(db, "esi")).toBe("rider");
    expect(db.prepare("select status from drivers where user_id = 'esi'").get()).toEqual({ status: "pending" });
  });

  it("does not approve an application of a staff account", async () => {
    const { env, db } = await setup();
    db.exec("update drivers set user_id = 'afi' where user_id = 'esi'");
    const res = await call(env, "admin", "POST", "/api/admin/drivers/afi/review", { action: "approve", vehicleId: "v3" });
    expect(res.body).toEqual({ error: "has_other_role" });
    expect(role(db, "afi")).toBe("operator");
  });

  it("releases a driver back to customer only without a trip, cash or fleet", async () => {
    const { env, db } = await setup();
    const release = () => call(env, "admin", "POST", "/api/admin/drivers/kofi/review", { action: "release" });
    db.exec(`insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}')`);
    expect((await release()).body).toEqual({ error: "role_change_blocked" });
    db.exec("delete from fleet_manager_drivers");
    db.exec(`insert into driver_ledger (id, driver_id, at, kind, amount_fcfa) values ('l1', 'kofi', '${T}', 'collected', 1500)`);
    expect((await release()).body).toEqual({ error: "role_change_blocked" });
    db.exec(`insert into driver_ledger (id, driver_id, at, kind, amount_fcfa) values ('l2', 'kofi', '${T}', 'settlement', 1500)`);
    db.exec(`insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, collect_fcfa, driver_id, created_at) values ('j1', 'ride', 'accepted', 'S', 5000, 1500, 1500, 'kofi', '${T}')`);
    expect((await release()).body).toEqual({ error: "driver_busy" });
    db.exec("update delivery_jobs set status = 'done'");
    expect((await release()).status).toBe(200);
    expect(role(db, "kofi")).toBe("rider");
    expect(db.prepare("select count(*) as n from drivers where user_id = 'kofi'").get()).toEqual({ n: 0 });
    // The trips and the cash ledger stay on record.
    expect(db.prepare("select count(*) as n from driver_ledger where driver_id = 'kofi'").get()).toEqual({ n: 2 });
    expect((await call(env, "kofi", "GET", "/api/wallet")).status).toBe(200);
    expect((await call(env, "kofi", "GET", "/api/driver/pass")).status).toBe(403);
    // Only a driver account can be released.
    expect((await call(env, "admin", "POST", "/api/admin/drivers/yawa/review", { action: "release" })).status).toBe(403);
  });

  it("keeps the driver role out of the generic role change", async () => {
    const { env, db } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/users/kofi/role", { role: "customer" })).body).toEqual({ error: "has_other_role" });
    expect((await call(env, "admin", "POST", "/api/admin/users/ama/role", { role: "driver" })).status).toBe(400);
    expect((await call(env, "admin", "POST", "/api/admin/staff", { stationId: "st", userId: "kofi" })).body).toEqual({ error: "has_other_role" });
    expect(role(db, "kofi")).toBe("driver");
    expect(role(db, "ama")).toBe("rider");
  });
});
