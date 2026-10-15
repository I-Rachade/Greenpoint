import { beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";
import type { FleetInvite, FleetRemoval, FleetStatement, FleetView, MyFleetInvite } from "../src/lib/fleet";

// Fleet managers (plan phase 6): registration and approval (M1), fleet managers are not
// customers (R11), invites only to free numbers or empty customer accounts (R12), the
// standard tier's driver limit (R13), invites accepted, declined, revoked and expired, and
// the role matrix of the fleet routes.

const OWN = "00000000-0000-4000-8000-000000000001";
const PIN = "2580";
const T = new Date().toISOString();
const LATER = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";
const USERS = [
  ["admin", "+22890000001", "admin"],
  ["afi", "+22890000002", "operator"],
  ["ama", "+22890000003", "rider"], // money in the wallet
  ["kofi", "+22890000004", "driver"],
  ["edem", "+22890000007", "fleet_manager"], // approved, standard
  ["efua", "+22890000008", "fleet_manager"], // pending
  ["kwame", "+22890000009", "fleet_manager"], // approved, unlocked
  ["esi", "+22891000001", "rider"], // empty customer accounts, invitable
  ["yao", "+22891000002", "rider"],
  ["akos", "+22891000003", "rider"],
  ["selom", "+22891000004", "rider"],
] as const;

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1, MEDIA: { put: async () => {}, delete: async () => {} }, TEST_OTP: "+22897000001=123456,+22890000003=123456" } as unknown as Env;
  for (const [id, phone, role] of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(id, phone, id, role, T, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`token-of-${id}-0123456789`), id, T, LATER);
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, created_at, price_battery_xof) values
      ('st', '${OWN}', 'Bè', 6.1319, 1.2228, 'both', 10, '00:00-24:00', '${T}', 1000), ('st2', '${OWN}', 'Lomé', 6.17, 1.21, 'both', 10, '00:00-24:00', '${T}', 1000);
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('st', 1, 2, 3, '${T}');
    insert into station_staff (station_id, user_id) values ('st', 'afi');
    insert into app_settings (key, value, updated_at) values ('drivers_enabled', '1', '${T}');
    insert into fleet_vehicles (id, type, plate, created_at) values ('v1', 'moto', 'TG 1', '${T}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', 'v1', 'ABCDEFGH', '${T}');
    insert into fleets (manager_id, name, status, tier, created_at) values
      ('edem', 'Flotte Edem', 'approved', 'standard', '${T}'),
      ('efua', 'Flotte Efua', 'pending', 'standard', '${T}'),
      ('kwame', 'Flotte Kwame', 'approved', 'unlocked', '${T}');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 5000, '${T}', '${T}');
  `);
  return { db, env };
}

async function call<B = unknown>(env: Env, as: string | null, method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as || token) headers.Authorization = `Bearer ${token ?? `token-of-${as}-0123456789`}`;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as B };
}

const role = (db: DatabaseSync, id: string) => (db.prepare("select role from users where id = ?").get(id) as { role: string }).role;
const APPLICATION = { fullName: "Esi Mensah", idNumber: "ID777", licenseNumber: "LIC777", wantedType: "moto" };
const invite = (env: Env, as: string, phone: string) => call<FleetInvite>(env, as, "POST", "/api/fleet/invites", { phone });

describe("fleet manager registration and approval (M1)", () => {
  it("registers a fleet manager with a pending fleet, never a customer account", async () => {
    const { env, db } = await setup();
    expect((await call(env, null, "POST", "/api/auth/send", { contact: "97000001" })).status).toBe(200);
    const res = await call<{ token: string; profile: { role: string } }>(env, null, "POST", "/api/auth/register-fleet", {
      contact: "97 00 00 01",
      code: "123456",
      pin: PIN,
      fleetName: "  Zem   Express ",
    });
    expect(res.status).toBe(200);
    expect(res.body.profile.role).toBe("fleet_manager");
    const user = db.prepare("select id, role, full_name from users where phone = '+22897000001'").get() as { id: string; role: string; full_name: string };
    expect(user).toMatchObject({ role: "fleet_manager", full_name: "Zem Express" });
    expect(db.prepare("select name, status, tier from fleets where manager_id = ?").get(user.id)).toEqual({ name: "Zem Express", status: "pending", tier: "standard" });

    // Until approved: the page shows the fleet, every fleet function is blocked.
    const token = res.body.token;
    const view = await call<FleetView>(env, null, "GET", "/api/fleet", undefined, token);
    expect(view.body.fleet).toMatchObject({ status: "pending", name: "Zem Express" });
    expect(view.body.drivers).toEqual([]);
    expect((await call(env, null, "POST", "/api/fleet/invites", { phone: "91000001" }, token)).body).toEqual({ error: "fleet_not_approved" });
    expect((await call(env, null, "GET", "/api/fleet/statement?from=2026-10-01&to=2026-10-31", undefined, token)).status).toBe(403);
    expect((await call(env, null, "GET", "/api/fleet/stats?from=2026-10-01&to=2026-10-31", undefined, token)).body).toEqual({ error: "fleet_not_approved" });
    // Not a customer either (W5, R11).
    expect((await call(env, null, "GET", "/api/wallet", undefined, token)).status).toBe(403);

    expect((await call(env, "admin", "POST", `/api/admin/fleets/${user.id}/review`, { action: "approve" })).status).toBe(200);
    expect((await call(env, null, "POST", "/api/fleet/invites", { phone: "91000001" }, token)).status).toBe(200);
  });

  it("refuses a number that already has an account, a bad name and a wrong code", async () => {
    const { env, db } = await setup();
    const body = { contact: "90000003", code: "123456", pin: PIN, fleetName: "Flotte Ama" };
    expect((await call(env, null, "POST", "/api/auth/register-fleet", body)).body).toEqual({ error: "account_exists" });
    expect(role(db, "ama")).toBe("rider");
    expect((await call(env, null, "POST", "/api/auth/register-fleet", { ...body, contact: "97000001", fleetName: "x" })).status).toBe(400);
    expect((await call(env, null, "POST", "/api/auth/register-fleet", { ...body, contact: "97000001", code: "000000" })).body).toEqual({ error: "invalid_code" });
    expect(db.prepare("select count(*) as n from users where phone = '+22897000001'").get()).toEqual({ n: 0 });
  });

  it("lets only an admin approve, reject and set the tier", async () => {
    const { env, db } = await setup();
    for (const as of ["edem", "efua", "ama", "afi", "kofi"]) {
      expect((await call(env, as, "POST", "/api/admin/fleets/efua/review", { action: "approve" })).status).toBe(403);
      expect((await call(env, as, "POST", "/api/admin/fleets/edem/tier", { tier: "unlocked" })).status).toBe(403);
      expect((await call(env, as, "GET", "/api/admin/fleets")).status).toBe(403);
    }
    const list = await call<{ managerId: string; status: string }[]>(env, "admin", "GET", "/api/admin/fleets");
    expect(list.body[0]).toMatchObject({ managerId: "efua", status: "pending" });
    expect((await call(env, "admin", "POST", "/api/admin/fleets/efua/review", { action: "reject" })).status).toBe(200);
    expect(db.prepare("select status from fleets where manager_id = 'efua'").get()).toEqual({ status: "rejected" });
    expect((await call(env, "efua", "POST", "/api/fleet/invites", { phone: "91000001" })).body).toEqual({ error: "fleet_not_approved" });
    // An approved fleet is not refused afterwards.
    expect((await call(env, "admin", "POST", "/api/admin/fleets/edem/review", { action: "reject" })).status).toBe(403);
    expect((await call(env, "admin", "POST", "/api/admin/fleets/edem/tier", { tier: "gold" })).status).toBe(400);
    expect((await call(env, "admin", "POST", "/api/admin/fleets/edem/tier", { tier: "unlocked" })).status).toBe(200);
    expect(db.prepare("select tier from fleets where manager_id = 'edem'").get()).toEqual({ tier: "unlocked" });
    expect(db.prepare("select count(*) as n from audit_log where table_name = 'fleets'").get()).toEqual({ n: 2 });
  });

  it("gives an account an admin makes fleet manager an approved fleet", async () => {
    const { env, db } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/users/yao/role", { role: "fleet_manager" })).status).toBe(200);
    expect(db.prepare("select status, tier from fleets where manager_id = 'yao'").get()).toEqual({ status: "approved", tier: "standard" });
    expect((await invite(env, "yao", "91000003")).status).toBe(200);
    // Leaving the role ends the open invites.
    expect((await call(env, "admin", "POST", "/api/admin/users/yao/role", { role: "customer" })).status).toBe(200);
    expect(db.prepare("select status from fleet_invites where manager_id = 'yao'").get()).toEqual({ status: "revoked" });
  });
});

describe("fleet managers are not customers (R11)", () => {
  const customerRoutes: [string, string, unknown?][] = [
    ["GET", "/api/wallet"],
    ["POST", "/api/wallet/send", { contact: "90000003", amountXof: 500, pin: PIN, idempotencyKey: "key-12345678" }],
    ["POST", "/api/wallet/topups", { amountXof: 1000, network: "flooz", phone: "90000007" }],
    ["GET", "/api/greenpoint"],
    ["POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" }],
    ["POST", "/api/reservations", { stationId: "st", kind: "swap" }],
    ["POST", "/api/jobs/ride", { pickup: { lat: 6.175, lng: 1.215, note: "", phone: "90112233" }, dropoff: { lat: 6.18, lng: 1.215, note: "" }, passengers: 1 }],
    ["POST", "/api/parcels/p1/delivery", { home: { lat: 6.175, lng: 1.215, note: "", phone: "90112233" } }],
    ["POST", "/api/driver/apply", APPLICATION],
  ];

  it.each(customerRoutes)("%s %s answers 403 to a fleet manager", async (method, path, body) => {
    const { env } = await setup();
    expect((await call(env, "edem", method, path, body)).status).toBe(403);
    expect((await call(env, "efua", method, path, body)).status).toBe(403);
  });

  it("sends no money to a fleet manager", async () => {
    const { env } = await setup();
    expect((await call(env, "ama", "GET", "/api/wallet/recipient?contact=90000007")).body).toEqual({ error: "not_a_customer" });
  });
});

describe("invites only to free numbers or empty customer accounts (R12)", () => {
  it("invites a number without an account and an empty customer account", async () => {
    const { env, db } = await setup();
    const free = await invite(env, "edem", "+228 99 00 00 01");
    expect(free.status).toBe(200);
    expect(free.body).toMatchObject({ phone: "+22899000001", status: "pending" });
    expect(free.body.token).toMatch(/^[A-Z0-9]{8}$/);
    expect((await invite(env, "edem", "91000001")).status).toBe(200);
    expect(db.prepare("select count(*) as n from audit_log where table_name = 'fleet_invites'").get()).toEqual({ n: 2 });
  });

  it.each([
    ["staff", "90000002", "invite_number_taken"],
    ["a driver", "90000004", "invite_number_taken"],
    ["a fleet manager", "90000009", "invite_number_taken"],
    ["the manager", "90000007", "invite_number_taken"],
    ["money in the wallet", "90000003", "invite_account_not_empty"],
  ])("refuses %s", async (_, phone, error) => {
    const { env, db } = await setup();
    expect((await invite(env, "edem", phone)).body).toEqual({ error });
    expect(db.prepare("select count(*) as n from fleet_invites").get()).toEqual({ n: 0 });
  });

  it.each([
    ["an active reservation", `insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code) values ('r1', 'esi', 'st', 'battery', 'active', '${T}', '${LATER}', '1234')`],
    [
      "an open parcel",
      `insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_phone, recipient_phone, content, length_cm, width_cm, height_cm, weight_kg, size, price_fcfa, status, created_at)
       values ('p1', 'GP-AAAAAA', 'st', 'st2', '+22890000003', '+22891000001', 'Livre', 20, 10, 5, 1, 'S', 1000, 'in_transit', '${T}')`,
    ],
    ["a booked trip", `insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, collect_fcfa, customer_user_id, created_at) values ('j1', 'ride', 'open', 'S', 5000, 1500, 1500, 'esi', '${T}')`],
  ])("refuses a customer account with %s", async (_, sql) => {
    const { env, db } = await setup();
    db.exec(sql);
    expect((await invite(env, "edem", "91000001")).body).toEqual({ error: "invite_account_not_empty" });
  });

  it("refuses a second open invite to the same number, foreign numbers, and staff or drivers inviting", async () => {
    const { env } = await setup();
    expect((await invite(env, "edem", "91000001")).status).toBe(200);
    expect((await invite(env, "edem", "91 00 00 01")).body).toEqual({ error: "invite_pending" });
    expect((await invite(env, "edem", "+33612345678")).body).toEqual({ error: "phone_not_allowed" });
    for (const as of ["afi", "kofi", "ama"]) expect((await invite(env, as, "91000002")).status).toBe(403);
    // Admins link drivers in the backoffice instead.
    expect((await invite(env, "admin", "91000002")).status).toBe(403);
    // Another fleet may invite the same number; the first accepted wins.
    expect((await invite(env, "kwame", "91000001")).status).toBe(200);
  });

  it("checks again when the person accepts", async () => {
    const { env, db } = await setup();
    const { body } = await invite(env, "edem", "91000001");
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('esi', 300, '${T}', '${T}')`);
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${body.token}/accept`, { application: APPLICATION })).body).toEqual({
      error: "invite_account_not_empty",
    });
    expect(role(db, "esi")).toBe("rider");
  });
});

describe("standard tier: at most 3 drivers (R13)", () => {
  it("counts drivers and open invites, refuses the 4th and allows it after the unlock", async () => {
    const { env, db } = await setup();
    db.exec(`insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}')`);
    expect((await invite(env, "edem", "91000001")).status).toBe(200);
    const second = await invite(env, "edem", "91000002");
    expect(second.status).toBe(200);
    expect((await call<FleetView>(env, "edem", "GET", "/api/fleet")).body.fleet).toMatchObject({ used: 3, driverLimit: 3, tier: "standard" });
    expect((await invite(env, "edem", "91000003")).body).toEqual({ error: "fleet_limit" });
    // A revoked invite frees its place.
    expect((await call(env, "edem", "POST", `/api/fleet/invites/${second.body.id}/revoke`)).status).toBe(200);
    expect((await invite(env, "edem", "91000003")).status).toBe(200);
    expect((await invite(env, "edem", "91000004")).body).toEqual({ error: "fleet_limit" });
    // So does an expired one.
    db.exec(`update fleet_invites set expires_at = '${PAST}' where phone = '+22891000003'`);
    expect((await invite(env, "edem", "91000004")).status).toBe(200);
    expect((await invite(env, "edem", "99000001")).body).toEqual({ error: "fleet_limit" });
    // After the unlock (paid outside the app) there is no limit.
    await call(env, "admin", "POST", "/api/admin/fleets/edem/tier", { tier: "unlocked" });
    expect((await invite(env, "edem", "99000001")).status).toBe(200);
    expect((await call<FleetView>(env, "edem", "GET", "/api/fleet")).body.fleet).toMatchObject({ used: 4, driverLimit: null });
  });

  it("keeps the drivers of a fleet that already has more, and holds the admin to the limit too", async () => {
    const { env, db } = await setup();
    db.exec(`
      insert into users (id, phone, role, created_at) values ('d2', '+22893000002', 'driver', '${T}'), ('d3', '+22893000003', 'driver', '${T}'), ('d4', '+22893000004', 'driver', '${T}');
      insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values
        ('d2', 'active', 'D2', 'ID002', 'LIC002', 'moto', 'CODE0002', '${T}'),
        ('d3', 'active', 'D3', 'ID003', 'LIC003', 'moto', 'CODE0003', '${T}'),
        ('d4', 'active', 'D4', 'ID004', 'LIC004', 'moto', 'CODE0004', '${T}');
      insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}'), ('d2', 'edem', '${T}'), ('d3', 'edem', '${T}');
    `);
    expect((await call(env, "admin", "POST", "/api/admin/drivers/d4/manager", { contact: "90000007" })).body).toEqual({ error: "fleet_limit" });
    db.exec(`insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('d4', 'edem', '${T}')`);
    const view = await call<FleetView>(env, "edem", "GET", "/api/fleet");
    expect(view.body.drivers).toHaveLength(4);
    expect(view.body.fleet).toMatchObject({ used: 4, driverLimit: 3 });
    expect((await invite(env, "edem", "91000001")).body).toEqual({ error: "fleet_limit" });
    // The unlocked fleet takes the driver.
    expect((await call(env, "admin", "POST", "/api/admin/drivers/d4/manager", { contact: "90000009" })).status).toBe(200);
  });
});

describe("invites: accept, decline, revoke, expire", () => {
  it("accepting makes the empty customer account a driver account in the fleet", async () => {
    const { env, db } = await setup();
    const { body: inv } = await invite(env, "edem", "91000001");
    const mine = await call<MyFleetInvite[]>(env, "esi", "GET", "/api/fleet-invites");
    expect(mine.body).toEqual([{ token: inv.token, fleetName: "Flotte Edem", expiresAt: inv.expiresAt, needsApplication: true }]);
    // Somebody else's number, and no application yet.
    expect((await call(env, "yao", "POST", `/api/fleet-invites/${inv.token}/accept`, { application: APPLICATION })).body).toEqual({ error: "invite_not_found" });
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${inv.token}/accept`, {})).status).toBe(400);
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${inv.token.toLowerCase()}/accept`, { application: APPLICATION })).status).toBe(200);
    expect(role(db, "esi")).toBe("driver");
    expect(db.prepare("select status, full_name, wanted_type from drivers where user_id = 'esi'").get()).toEqual({ status: "pending", full_name: "Esi Mensah", wanted_type: "moto" });
    expect(db.prepare("select manager_id from fleet_manager_drivers where driver_id = 'esi'").get()).toEqual({ manager_id: "edem" });
    expect(db.prepare("select status, user_id from fleet_invites where id = ?").get(inv.id)).toEqual({ status: "accepted", user_id: "esi" });
    // Once only; the new driver is no customer any more and completes the application.
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${inv.token}/accept`, { application: APPLICATION })).status).toBe(404);
    expect((await call(env, "esi", "GET", "/api/wallet")).status).toBe(403);
    expect((await call(env, "esi", "GET", "/api/fleet-invites")).body).toEqual([]);
    expect((await call(env, "esi", "POST", "/api/driver/apply", { ...APPLICATION, fullName: "Esi M." })).status).toBe(200);
    expect((await call(env, "esi", "GET", "/api/driver/pass")).status).toBe(403); // not approved yet
    const view = await call<FleetView>(env, "edem", "GET", "/api/fleet");
    expect(view.body.drivers).toMatchObject([{ userId: "esi", status: "pending", fullName: "Esi M." }]);
    // An admin approves the driver and hands out a vehicle as usual.
    db.exec(`update drivers set id_doc_key = 'a', license_doc_key = 'b', portrait_key = 'c' where user_id = 'esi';
      insert into fleet_vehicles (id, type, plate, created_at) values ('v2', 'moto', 'TG 2', '${T}')`);
    expect((await call(env, "admin", "POST", "/api/admin/drivers/esi/review", { action: "approve", vehicleId: "v2" })).status).toBe(200);
    expect((await call(env, "esi", "GET", "/api/driver/pass")).status).toBe(200);
  });

  it("ends the other open invites of the number, and keeps an existing application", async () => {
    const { env, db } = await setup();
    db.exec(`insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values ('esi', 'pending', 'Esi', 'ID9', 'LIC9', 'tricycle', 'CODEESI1', '${T}')`);
    const a = (await invite(env, "edem", "91000001")).body;
    const b = (await invite(env, "kwame", "91000001")).body;
    expect((await call<MyFleetInvite[]>(env, "esi", "GET", "/api/fleet-invites")).body.map((i) => i.needsApplication)).toEqual([false, false]);
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${b.token}/accept`)).status).toBe(200);
    expect(db.prepare("select wanted_type from drivers where user_id = 'esi'").get()).toEqual({ wanted_type: "tricycle" });
    expect(db.prepare("select status from fleet_invites where id = ?").get(a.id)).toEqual({ status: "expired" });
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${a.token}/accept`)).body).toEqual({ error: "invite_not_found" });
  });

  it("declines, revokes and expires", async () => {
    const { env, db } = await setup();
    const one = (await invite(env, "edem", "91000001")).body;
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${one.token}/decline`)).status).toBe(200);
    expect(db.prepare("select status, user_id from fleet_invites where id = ?").get(one.id)).toEqual({ status: "declined", user_id: "esi" });
    expect(role(db, "esi")).toBe("rider");

    const two = (await invite(env, "edem", "91000002")).body;
    // Only the inviting fleet revokes, and only an open invite.
    expect((await call(env, "kwame", "POST", `/api/fleet/invites/${two.id}/revoke`)).body).toEqual({ error: "invite_not_found" });
    expect((await call(env, "edem", "POST", `/api/fleet/invites/${two.id}/revoke`)).status).toBe(200);
    expect((await call(env, "edem", "POST", `/api/fleet/invites/${two.id}/revoke`)).status).toBe(404);
    expect((await call(env, "yao", "POST", `/api/fleet-invites/${two.token}/accept`, { application: APPLICATION })).body).toEqual({ error: "invite_not_found" });

    const three = (await invite(env, "edem", "91000003")).body;
    db.exec(`update fleet_invites set expires_at = '${PAST}' where id = '${three.id}'`);
    expect((await call(env, "akos", "GET", "/api/fleet-invites")).body).toEqual([]);
    expect((await call(env, "akos", "POST", `/api/fleet-invites/${three.token}/accept`, { application: APPLICATION })).status).toBe(404);
    expect(db.prepare("select status from fleet_invites where id = ?").get(three.id)).toEqual({ status: "expired" });
    const view = await call<FleetView>(env, "edem", "GET", "/api/fleet");
    expect(view.body.invites.map((i) => i.status).sort()).toEqual(["declined", "expired", "revoked"]);
  });

  it("does not offer invites of a fleet that is not approved", async () => {
    const { env, db } = await setup();
    const { body } = await invite(env, "edem", "91000001");
    db.exec("update fleets set status = 'pending' where manager_id = 'edem'");
    expect((await call(env, "esi", "GET", "/api/fleet-invites")).body).toEqual([]);
    expect((await call(env, "esi", "POST", `/api/fleet-invites/${body.token}/accept`, { application: APPLICATION })).status).toBe(404);
  });
});

describe("removing a driver (R15)", () => {
  async function withInvited() {
    const t = await setup();
    const { body } = await invite(t.env, "edem", "91000001");
    await call(t.env, "esi", "POST", `/api/fleet-invites/${body.token}/accept`, { application: APPLICATION });
    return t;
  }

  it("takes the driver out of the fleet and back to customer when nothing is open", async () => {
    const { env, db } = await withInvited();
    expect((await call(env, "kwame", "POST", "/api/fleet/drivers/esi/remove")).status).toBe(404);
    const res = await call<FleetRemoval>(env, "edem", "POST", "/api/fleet/drivers/esi/remove");
    expect(res.body).toEqual({ released: true });
    expect(role(db, "esi")).toBe("rider");
    expect(db.prepare("select count(*) as n from drivers where user_id = 'esi'").get()).toEqual({ n: 0 });
    expect(db.prepare("select count(*) as n from fleet_manager_drivers").get()).toEqual({ n: 0 });
    expect((await call(env, "esi", "GET", "/api/wallet")).status).toBe(200);
  });

  it("not during a trip; with cash open the account stays a driver outside the fleet", async () => {
    const { env, db } = await withInvited();
    db.exec(`insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, collect_fcfa, driver_id, created_at) values ('j1', 'ride', 'accepted', 'S', 5000, 1500, 1500, 'esi', '${T}')`);
    expect((await call(env, "edem", "POST", "/api/fleet/drivers/esi/remove")).body).toEqual({ error: "driver_busy" });
    db.exec(`update delivery_jobs set status = 'done';
      insert into driver_ledger (id, driver_id, at, kind, amount_fcfa) values ('l1', 'esi', '${T}', 'collected', 1500)`);
    expect((await call<FleetRemoval>(env, "edem", "POST", "/api/fleet/drivers/esi/remove")).body).toEqual({ released: false });
    expect(role(db, "esi")).toBe("driver");
    expect(db.prepare("select count(*) as n from fleet_manager_drivers").get()).toEqual({ n: 0 });
  });
});

describe("statistics and statement", () => {
  it("shows statistics only to an unlocked fleet and admins, the statement to every approved fleet", async () => {
    const { env, db } = await setup();
    db.exec(`
      insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}');
      insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, driver_id, fleet_manager_id, payment, amount_xof, staff_id, role, created_at) values
        ('s1', 'rq1', 'st', 1, 'fleet', 'kofi', 'edem', 'fleet', 1000, 'afi', 'staff', '${T}'),
        ('s2', 'rq2', 'st2', 1, 'fleet', 'kofi', 'kwame', 'fleet', 1500, 'afi', 'staff', '${T}'),
        ('s3', 'rq3', 'st', 1, 'cash', null, null, 'cash', 1000, 'afi', 'staff', '${T}');
    `);
    const day = T.slice(0, 10);
    const q = `?from=${day}&to=${day}`;
    expect((await call(env, "edem", "GET", `/api/fleet/stats${q}`)).body).toEqual({ error: "fleet_locked" });
    expect((await call(env, "kwame", "GET", `/api/fleet/stats${q}`)).status).toBe(200);
    expect((await call(env, "admin", "GET", `/api/fleet/stats${q}`)).status).toBe(200);
    const statement = await call<FleetStatement>(env, "edem", "GET", `/api/fleet/statement${q}`);
    expect(statement.body.swaps).toMatchObject([{ id: "s1", stationName: "Bè", driverName: "Kofi", amountXof: 1000 }]);
    expect(statement.body.totalXof).toBe(1000);
    expect((await call<FleetStatement>(env, "admin", "GET", `/api/fleet/statement${q}`)).body.totalXof).toBe(2500);
    await call(env, "admin", "POST", "/api/admin/fleets/edem/tier", { tier: "unlocked" });
    expect((await call(env, "edem", "GET", `/api/fleet/stats${q}`)).body).toMatchObject({ drivers: [{ userId: "kofi", fleetSwaps: 1, fleetSwapsXof: 1000 }] });
    expect(db.prepare("select count(*) as n from swap_log").get()).toEqual({ n: 3 });
  });
});

describe("role matrix of the fleet routes (R2)", () => {
  const q = "?from=2026-10-01&to=2026-10-31";
  // customer, staff, driver, fleet manager (approved, standard), fleet manager (pending), admin
  const AS = ["ama", "afi", "kofi", "edem", "efua", "admin"] as const;
  const MATRIX: [string, string, unknown, number[]][] = [
    ["GET", "/api/fleet", undefined, [403, 403, 403, 200, 200, 200]],
    ["GET", `/api/fleet/stats${q}`, undefined, [403, 403, 403, 403, 403, 200]],
    ["GET", `/api/fleet/statement${q}`, undefined, [403, 403, 403, 200, 403, 200]],
    ["POST", "/api/fleet/invites", { phone: "91000001" }, [403, 403, 403, 200, 403, 403]],
    ["POST", "/api/fleet/drivers/kofi/remove", undefined, [403, 403, 403, 404, 403, 404]],
    ["GET", "/api/admin/fleets", undefined, [403, 403, 403, 403, 403, 200]],
    ["POST", "/api/admin/fleets/efua/tier", { tier: "unlocked" }, [403, 403, 403, 403, 403, 200]],
    ["GET", "/api/fleet-invites", undefined, [200, 200, 200, 200, 200, 200]],
  ];

  it.each(MATRIX)("%s %s", async (method, path, body, expected) => {
    const { env } = await setup();
    const got: number[] = [];
    for (const as of AS) got.push((await call(env, as, method, path, body)).status);
    expect(got).toEqual(expected);
  });
});
