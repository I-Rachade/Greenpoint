import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { API_ROUTES, OPEN_ROUTES, handleApi, routeName } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { d1Of, fakeD1 } from "./test-d1";

// R2 (plan phase 8, capstone): every /api route × every role. The server enforces the role
// matrix of the plan (bauplan "Role matrix"); a role the matrix leaves out gets 401 (not signed
// in) or 403, a role it allows never does. Each call runs on a fresh copy of the same database.

type Role = "anonymous" | "rider" | "staff" | "owner" | "driver" | "fleet_manager" | "merchant" | "admin";
const ROLES: Record<Role, string | null> = {
  anonymous: null,
  rider: "ama",
  staff: "afi", // staff at Bè
  owner: "yao", // owns Bè and Lomé
  driver: "yawa",
  fleet_manager: "edem",
  merchant: "kofi", // the merchant of an approved shop
  admin: "admin",
};

const SIGNED: Role[] = ["rider", "staff", "owner", "driver", "fleet_manager", "merchant", "admin"];
const ALL: Role[] = ["anonymous", ...SIGNED];
/** Wallet, greenpoints, payments, reservations, bookings: customers; an admin keeps them, to test. */
const CUSTOMER: Role[] = ["rider", "admin"];
/** Station service buttons: staff at their station, the owner at the active station, an admin anywhere. */
const STATION: Role[] = ["staff", "owner", "admin"];
/** Backoffice of the owner's stations; an admin sees all. */
const OWNER: Role[] = ["owner", "admin"];
const ADMIN: Role[] = ["admin"];
const DRIVER: Role[] = ["driver"];
const FLEET: Role[] = ["fleet_manager", "admin"];
/** Shop bookings (planung/marchand.md): customers, members of an approved shop, an admin. */
const BOOKING: Role[] = ["rider", "merchant", "admin"];
const MERCHANT: Role[] = ["merchant"];
/** Assignments to a shop are approved by the driver, their fleet manager or an admin (decision 9). */
const APPROVER: Role[] = ["driver", "fleet_manager", "admin"];

/** Who may call each route; every route of the Worker is listed (the first test checks it). */
const POLICY: Record<string, Role[]> = {
  "GET /api/stations": ALL,
  "GET /api/operators": ALL,
  "GET /api/stations/:id/reviews": ALL,
  "POST /api/stations/:id/reviews": SIGNED,
  "DELETE /api/reviews/:id": SIGNED, // one's own review
  "GET /api/me": ALL,
  "POST /api/auth/send": ALL,
  "POST /api/auth/register": ALL,
  "POST /api/auth/register-fleet": ALL,
  "POST /api/auth/register-merchant": ALL,
  "POST /api/auth/login": ALL,
  "POST /api/auth/contact/send": SIGNED,
  "POST /api/auth/contact": SIGNED,
  "POST /api/auth/delete-account/send": SIGNED,
  "POST /api/auth/delete-account": SIGNED,
  "POST /api/auth/logout": ALL,
  "GET /api/reservations/mine": ALL, // empty when signed out
  "POST /api/reservations": ["rider"],
  "POST /api/reservations/:id/cancel": CUSTOMER, // one's own; an admin any
  "POST /api/reservations/:id/complete": STATION,
  "GET /api/staff/stations": STATION,
  "GET /api/owner": OWNER,
  "POST /api/owner/staff": OWNER,
  "DELETE /api/owner/staff": OWNER,
  "POST /api/owner/stations/:id": OWNER,
  "POST /api/owner/staff/move": OWNER,
  "POST /api/owner/reassignments/:id/resolve": OWNER,
  "GET /api/owner/live": OWNER,
  "GET /api/owner/report": OWNER,
  "GET /api/station-services": OWNER,
  "POST /api/station-services/request": ["owner"], // the owner asks, the admin decides
  "POST /api/admin/station-services/decide": ADMIN,
  "POST /api/admin/station-services/set": ADMIN,
  "GET /api/admin/operators": ADMIN,
  "GET /api/admin/battery-types": ADMIN,
  "POST /api/admin/battery-types": ADMIN,
  "GET /api/batteries": OWNER, // battery register: owners read their stations' batteries
  "GET /api/batteries/:id": OWNER,
  "POST /api/admin/batteries": ADMIN,
  "PATCH /api/admin/batteries/:id": ADMIN,
  "GET /api/admin/ev-chargers": ADMIN,
  "POST /api/admin/ev-chargers": ADMIN,
  "DELETE /api/admin/ev-chargers/:id": ADMIN,
  "POST /api/admin/operators": ADMIN,
  "POST /api/admin/operators/:id/owners": ADMIN,
  "DELETE /api/admin/operators/:id/owners/:id": ADMIN,
  "PATCH /api/stations/:id/status": STATION,
  "GET /api/stations/:id/reservations": STATION,
  "GET /api/stations/:id/counter": STATION,
  "POST /api/stations/:id/battery-events": STATION, // corrections: owner and admin (station-work.test)
  "POST /api/stations/:id/swaps": STATION,
  "GET /api/stations/:id/swaps": STATION,
  "GET /api/stations/:id/battery-events": OWNER, // counter history: backoffice
  "GET /api/stations/:id/batteries/lookup": STATION, // the swap form: is this battery known?
  "GET /api/admin/reservations": ADMIN,
  "GET /api/promotions/current": ALL,
  "GET /api/features": ALL,
  "POST /api/admin/features/parcels": ADMIN,
  "POST /api/admin/features/drivers": ADMIN,
  "POST /api/admin/features/lite": ADMIN,
  "GET /api/wallet": CUSTOMER,
  "GET /api/wallet/recipient": CUSTOMER,
  "POST /api/wallet/send": CUSTOMER,
  "POST /api/wallet/topups": CUSTOMER,
  "POST /api/wallet/topups/:id/refresh": CUSTOMER,
  "GET /api/admin/wallet": ADMIN,
  "POST /api/admin/wallet/enabled": ADMIN,
  "POST /api/admin/wallet/fees": ADMIN,
  "POST /api/admin/wallet/adjust": ADMIN,
  "POST /api/admin/wallet/freeze": ADMIN,
  "GET /api/payments/mine": CUSTOMER,
  "POST /api/payments": CUSTOMER,
  "POST /api/payments/:id/refresh": CUSTOMER,
  "GET /api/greenpoint": CUSTOMER,
  "GET /api/greenpoint/total": ALL,
  "POST /api/greenpoint/vehicle": CUSTOMER,
  "POST /api/greenpoint/redemptions": CUSTOMER,
  "POST /api/greenpoint/redemptions/:id/cancel": CUSTOMER,
  "POST /api/stations/:id/greenpoint/redeem": STATION,
  "GET /api/stations/:id/charging": STATION,
  "POST /api/stations/:id/charging": STATION,
  "POST /api/stations/:id/charging/:id/:id": STATION,
  "GET /api/charging/mine": CUSTOMER,
  "POST /api/charging/:id/pay/wallet": CUSTOMER,
  "POST /api/charging/:id/pay/mobile": CUSTOMER,
  "GET /api/charging/points/:id": ALL,
  "POST /api/charging/points/:id/start": CUSTOMER,
  "POST /api/charging/:id/stop": CUSTOMER,
  "POST /api/admin/charging-points/:id/qr": ADMIN,
  "GET /api/admin/charging": ADMIN,
  "POST /api/admin/charging/tariff": ADMIN,
  "GET /api/admin/greenpoint": ADMIN,
  "POST /api/admin/greenpoint/factors": ADMIN,
  "POST /api/admin/greenpoint/rewards": ADMIN,
  "GET /api/parcels/info": ALL,
  "GET /api/parcels/mine": ALL, // empty when signed out
  "POST /api/parcels/:id/cancel": STATION,
  "POST /api/parcels/:id/resend": STATION,
  "GET /api/stations/:id/parcels": STATION,
  "POST /api/stations/:id/parcels": STATION,
  "GET /api/stations/:id/runs": STATION,
  "POST /api/stations/:id/runs": STATION,
  "POST /api/stations/:id/runs/:id/:id": STATION,
  "POST /api/stations/:id/parcels/receive": STATION,
  "POST /api/stations/:id/parcels/pickup": STATION,
  "GET /api/stations/:id/bookings": STATION,
  "POST /api/stations/:id/bookings/:id/accept": STATION,
  "GET /api/admin/partners": ADMIN,
  "POST /api/admin/partners": ADMIN,
  "POST /api/admin/partners/:id/keys": ADMIN,
  "POST /api/admin/partners/:id/keys/:id/revoke": ADMIN,
  "POST /api/admin/partners/:id/secret": ADMIN,
  "POST /api/admin/partner-events/:id/retry": ADMIN,
  "POST /api/admin/parcels/:id/:id": ADMIN,
  "GET /api/admin/parcels": ADMIN,
  "POST /api/admin/parcel-depots": ADMIN,
  "POST /api/admin/parcel-sizes": ADMIN,
  "GET /api/fleet": FLEET,
  "GET /api/fleet/stats": FLEET,
  "POST /api/fleet/jobs/:id/assign": FLEET,
  "GET /api/fleet/statement": FLEET,
  "POST /api/fleet/invites": ["fleet_manager"], // an admin links drivers in the backoffice instead
  "POST /api/fleet/invites/:id/revoke": FLEET,
  "POST /api/fleet/drivers/:id/remove": FLEET,
  "GET /api/fleet-invites": ALL, // empty when signed out
  "POST /api/fleet-invites/:id/accept": SIGNED, // an invite to the caller's own number
  "POST /api/fleet-invites/:id/decline": SIGNED,
  "GET /api/admin/fleets": ADMIN,
  "POST /api/admin/fleets/:id/review": ADMIN,
  "POST /api/admin/fleets/:id/tier": ADMIN,
  "POST /api/admin/drivers/:id/manager": ADMIN,
  "GET /api/driver": ["rider", "driver", "admin"], // a customer sees how to apply
  "GET /api/driver/pass": DRIVER,
  "POST /api/driver/former-account/code": DRIVER,
  "POST /api/driver/former-account/claim": DRIVER,
  "POST /api/driver/apply": ["rider", "driver"],
  "POST /api/driver/documents/:id": ["rider", "driver"],
  "POST /api/driver/queue": DRIVER,
  "DELETE /api/driver/queue": DRIVER,
  "POST /api/driver/jobs/:id/accept": DRIVER,
  "POST /api/driver/jobs/:id/decline": DRIVER,
  "POST /api/driver/jobs/:id/abandon": DRIVER,
  "POST /api/driver/jobs/:id/collect": DRIVER,
  "POST /api/driver/jobs/:id/door": DRIVER,
  "POST /api/driver/jobs/:id/photo": DRIVER,
  "POST /api/driver/jobs/:id/deliver": DRIVER,
  "POST /api/driver/jobs/:id/absent": DRIVER,
  "POST /api/driver/jobs/:id/board": DRIVER,
  "POST /api/driver/position": DRIVER,
  "POST /api/push/token": SIGNED,
  "POST /api/driver/payouts": DRIVER,
  "GET /api/admin/driver-payouts": ADMIN,
  "POST /api/admin/driver-payouts/:id": ADMIN,
  "POST /api/push/token/remove": SIGNED,
  "POST /api/driver/jobs/:id/finish": DRIVER,
  "GET /api/jobs/mine": ALL, // empty when signed out
  "POST /api/jobs/pickup": BOOKING,
  "POST /api/jobs/ride": BOOKING,
  "POST /api/jobs/courier": BOOKING,
  "POST /api/parcels/:id/delivery": CUSTOMER,
  "POST /api/jobs/:id/cancel": BOOKING, // a shop's member cancels the shop's trips
  "GET /api/merchant": MERCHANT,
  "POST /api/merchant/bookings": MERCHANT,
  "GET /api/merchant/activity": MERCHANT,
  "POST /api/merchant/stats": MERCHANT,
  "POST /api/merchant/addresses": MERCHANT,
  "DELETE /api/merchant/addresses/:id": MERCHANT,
  "POST /api/merchant/jobs/:id/returned": MERCHANT,
  "POST /api/merchant/shop": MERCHANT,
  "POST /api/merchant/invites": MERCHANT,
  "POST /api/merchant/invites/:id/revoke": MERCHANT,
  "POST /api/merchant/members/:id/remove": MERCHANT,
  "POST /api/merchant/drivers": MERCHANT,
  "POST /api/merchant/drivers/:id/pay": MERCHANT,
  "POST /api/merchant/drivers/:id/end": ["merchant", "driver", "admin"], // the driver may end it too
  "POST /api/merchant/drivers/:id/checkout": MERCHANT,
  "GET /api/merchant-invites": ALL, // empty when signed out
  "POST /api/merchant-invites/:id/accept": SIGNED, // an invite to the caller's own number
  "POST /api/merchant-invites/:id/decline": SIGNED,
  "GET /api/merchant-assignments": APPROVER,
  "POST /api/merchant-assignments/:id/:id": APPROVER,
  "GET /api/driver/shops": DRIVER,
  "POST /api/driver/shops/:id/checkin": DRIVER,
  "POST /api/driver/shops/checkout": DRIVER,
  "POST /api/driver/shops/hours/:id/received": DRIVER,
  "GET /api/admin/merchants": ADMIN,
  "POST /api/admin/merchants/:id/review": ADMIN,
  "POST /api/admin/merchants/:id/tier": ADMIN,
  "POST /api/admin/merchants/:id/owner": ADMIN,
  "POST /api/admin/merchants/:id/members/:id/remove": ADMIN,
  "GET /api/stations/:id/drivers": STATION,
  "POST /api/stations/:id/drivers/scan": STATION,
  "POST /api/stations/:id/drivers/:id": STATION,
  "POST /api/stations/:id/drivers/settle": STATION,
  "GET /api/admin/drivers": ADMIN,
  "POST /api/admin/drivers/:id/review": ADMIN,
  "POST /api/admin/fleet": ADMIN,
  "POST /api/admin/driver-settings": ADMIN,
  "POST /api/admin/jobs/:id/assign": ADMIN,
  "POST /api/admin/stations": ADMIN,
  "POST /api/admin/stations/:id/active": ADMIN,
  "GET /api/admin/snapshot": ADMIN,
  "GET /api/admin/audit": ADMIN,
  "POST /api/admin/users/:id/role": ADMIN,
  "POST /api/admin/staff": ADMIN,
  "DELETE /api/admin/staff": ADMIN,
  "GET /api/admin/promotions": ADMIN,
  "POST /api/admin/promotions": ADMIN,
  "DELETE /api/admin/promotions/:id": ADMIN,
  "POST /api/admin/media": ADMIN,
  "POST /api/admin/devices": ADMIN,
  "GET /api/admin/devices": ADMIN,
  "DELETE /api/admin/devices/:id": ADMIN,
  "POST /api/admin/devices/:id/outlets/:id/:id": ADMIN,
  "POST /api/admin/devices/:id/partner": ADMIN,
  "GET /api/admin/point-partners": ADMIN,
  "POST /api/admin/point-partners": ADMIN,
  "POST /api/admin/point-partners/:id/status": ADMIN,
  "POST /api/admin/point-partners/:id/accounts": ADMIN,
  "DELETE /api/admin/point-partners/:id/accounts/:id": ADMIN,
  // Only accounts an admin linked to a point partner; none of the roles here is one.
  "GET /api/point-partner": [],
};

const OWN = "00000000-0000-4000-8000-000000000001";
let dir = "";
let seedFile = "";
let copies = 0;

beforeAll(async () => {
  const pinHash = await hashPin("2580");
  const { db } = fakeD1();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const users: [string, string, string][] = [
    ["admin", "+22890000001", "admin"],
    ["yao", "+22890000002", "operator"],
    ["afi", "+22890000004", "operator"],
    ["ama", "+22890000006", "rider"],
    ["edem", "+22890000008", "fleet_manager"],
    ["yawa", "+22890000009", "driver"],
    ["kofi", "+22890000010", "merchant"],
  ];
  for (const [id, phone, role] of users) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(id, phone, id, role, now, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`token-of-${id}-0123456789`), id, now, later);
  }
  db.exec(`
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'both', 10, '00:00-24:00', 500, '${now}'),
      ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'both', 10, '00:00-24:00', 500, '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('be', 1, 2, 3, '${now}'), ('lome', 1, 2, 3, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('be', 1, '', 0, '${now}'), ('lome', 1, '', 0, '${now}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values ('yawa', 'active', 'Yawa', 'ID1', 'LIC1', 'moto', 'ABCDEFGH', '${now}');
    insert into fleets (manager_id, name, status, tier, created_at) values ('edem', 'Flotte Edem', 'approved', 'unlocked', '${now}');
    insert into app_settings (key, value, updated_at) values ('drivers_enabled', '1', '${now}');
    insert into merchants (id, owner_id, name, phone, address, lat, lng, status, tier, created_at) values ('shop', 'kofi', 'Boutique Kofi', '+22890000011', 'Bè', 6.13, 1.22, 'approved', 'unlocked', '${now}');
    insert into merchant_members (user_id, merchant_id, is_owner, created_at) values ('kofi', 'shop', 1, '${now}');
    -- Rows named "be", the id every path segment gets below: the rider's reservation at Bè.
    insert into reservations (id, user_id, station_id, type, status, pickup_code, created_at, expires_at) values ('be', 'ama', 'be', 'battery', 'active', '1234', '${now}', '${later}');
  `);
  dir = mkdtempSync(join(tmpdir(), "role-matrix-"));
  seedFile = join(dir, "seed.db");
  db.exec(`vacuum into '${seedFile}'`);
  db.close();
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** A fresh copy of the seeded database, so no call sees what an earlier one changed. */
function freshEnv(): Env {
  const file = join(dir, `copy-${copies++}.db`);
  copyFileSync(seedFile, file);
  const db = new DatabaseSync(file);
  db.exec("pragma foreign_keys = on");
  return { DB: d1Of(db), MEDIA: { get: async () => null, put: async () => null } } as unknown as Env;
}

/** A path the pattern matches: "be" for ids, the first word of a choice, 1 for numbers. */
function pathFor(re: RegExp): string {
  return re.source
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .replace(/\\\//g, "/")
    .replace(/\(([^()]*)\)/g, (_, inner: string) => (/^[a-z|]+$/.test(inner) ? inner.split("|")[0] : inner.includes("\\d") ? "1" : "be"));
}

async function call(method: string, path: string, role: Role, body: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", "X-Active-Station": "be" };
  const who = ROLES[role];
  if (who) headers.Authorization = `Bearer token-of-${who}-0123456789`;
  const res = await handleApi(new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: method === "GET" ? undefined : body }), freshEnv());
  return { status: res.status, body: await res.text() };
}

describe("R2: route × role matrix", () => {
  it("has a rule for every route, and no rule for a route that does not exist", () => {
    const names = API_ROUTES.map(([method, re]) => routeName(method, re));
    expect(names.filter((n) => !(n in POLICY))).toEqual([]);
    expect(Object.keys(POLICY).filter((n) => !names.includes(n))).toEqual([]);
    // The routes open without signing in are exactly the ones open to everyone.
    expect([...OPEN_ROUTES].sort()).toEqual(Object.keys(POLICY).filter((n) => POLICY[n].includes("anonymous")).sort());
  });

  it("allows the matrix's roles and refuses all others with 401 or 403", async () => {
    const wrong: string[] = [];
    for (const [method, re] of API_ROUTES) {
      const name = routeName(method, re);
      const allowed = POLICY[name] ?? [];
      for (const role of Object.keys(ROLES) as Role[]) {
        const { status, body } = await call(method, pathFor(re), role, JSON.stringify({ stationId: "be" }));
        const refused = status === 401 || status === 403;
        if (allowed.includes(role) ? refused || status === 500 : role === "anonymous" ? status !== 401 : status !== 403) {
          wrong.push(`${name} as ${role}: ${status} ${body.slice(0, 80)}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  }, 120_000);

  it("asks a signed-out caller to sign in before it reads anything of the request", async () => {
    const wrong: string[] = [];
    for (const [method, re] of API_ROUTES) {
      const name = routeName(method, re);
      if (OPEN_ROUTES.has(name)) continue;
      const { status } = await call(method, pathFor(re), "anonymous", "not json");
      if (status !== 401) wrong.push(`${name}: ${status}`);
    }
    expect(wrong).toEqual([]);
  });
});
