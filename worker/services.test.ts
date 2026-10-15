import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ParcelInfo } from "../src/lib/parcels";
import type { StationService, StationServiceInfo } from "../src/lib/station-services";
import type { StationView } from "../src/lib/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { setDriversEnabled, setLiteEnabled, setParcelsEnabled } from "./features";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { serviceActive } from "./services";
import { fakeD1 } from "./test-d1";

// Service unlock per station (plan W11, invariant R8, and R9 for what Lite switches off).
// Runs the API on the SQLite D1 of worker/test-d1.ts with the real migrations.

const OP_A = "op-a"; // run by Yao
const OP_B = "op-b"; // run by Kossi
const USERS = [
  { id: "admin", phone: "+22890000001", role: "admin" as const },
  { id: "yao", phone: "+22890000002", role: "operator" as const }, // owner of OP_A
  { id: "kossi", phone: "+22890000003", role: "operator" as const }, // owner of OP_B
  { id: "afi", phone: "+22890000004", role: "operator" as const }, // staff at Bè (OP_A)
  { id: "ama", phone: "+22890000005", role: "customer" as const }, // rider
  { id: "edem", phone: "+22890000006", role: "fleet_manager" as const },
];
const ADMIN = { id: "admin", phone: "+22890000001", email: null, fullName: null, role: "admin" as const };

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, role, created_at) values (?, ?, ?, ?)").run(u.id, u.phone, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`token-of-${u.id}-0123456789`), u.id, now, expires);
  }
  db.exec(`
    insert into operators (id, name, created_at) values ('${OP_A}', 'Togo Moto', '${now}'), ('${OP_B}', 'Kara Énergie', '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OP_A}', 'yao', '${now}'), ('${OP_B}', 'kossi', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, created_at) values
      ('be', '${OP_A}', 'Bè', 6.13, 1.22, 'both', 10, '00:00-24:00', '${now}'),
      ('kara', '${OP_B}', 'Kara', 9.55, 1.19, 'swap', 10, '00:00-24:00', '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('be', 1, 5, 10, '${now}'), ('kara', 1, 0, 10, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('be', 1, '', 0, '${now}');
  `);
  return { db, env };
}

async function call(env: Env, as: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers.Authorization = `Bearer token-of-${as}-0123456789`;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

const request = (env: Env, as: string | null, stationId: string, service: string) =>
  call(env, as, "POST", "/api/station-services/request", { stationId, service });
const decide = (env: Env, as: string, stationId: string, service: string, approve: boolean) =>
  call(env, as, "POST", "/api/admin/station-services/decide", { stationId, service, approve });
const setUnlocked = (env: Env, as: string, stationId: string, service: string, unlocked: boolean) =>
  call(env, as, "POST", "/api/admin/station-services/set", { stationId, service, unlocked });

async function list(env: Env, as: string) {
  const res = await call(env, as, "GET", "/api/station-services");
  expect(res.status).toBe(200);
  return res.body as StationServiceInfo[];
}

const row = (rows: StationServiceInfo[], stationId: string, service: StationService) => rows.find((r) => r.stationId === stationId && r.service === service)!;

const unlocked = (db: DatabaseSync, stationId: string) =>
  (db.prepare("select service from station_services where station_id = ? and unlocked = 1 order by service").all(stationId) as { service: string }[]).map(
    (r) => r.service,
  );

async function station(env: Env, id: string) {
  return ((await call(env, null, "GET", "/api/stations")).body as StationView[]).find((s) => s.id === id);
}

describe("backfill and set-up by an admin", () => {
  it("unlocks what every existing station offers today (migration 0026)", () => {
    // Migrations up to 0025, stations as they are today, then 0026.
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    const dir = new URL("./migrations/", import.meta.url);
    const files = readdirSync(dir).sort();
    for (const file of files.filter((f) => f < "0026")) db.exec(readFileSync(new URL(file, dir), "utf8"));
    const now = new Date().toISOString();
    db.exec(`
      insert into operators (id, name, created_at) values ('op', 'Op', '${now}');
      insert into stations (id, operator_id, name, lat, lng, kind, has_battery, created_at) values
        ('swap', 'op', 'S', 6, 1, 'swap', 1, '${now}'),
        ('charge', 'op', 'C', 6, 1, 'charging', 1, '${now}'),
        ('both', 'op', 'B', 6, 1, 'both', 1, '${now}'),
        ('parcel', 'op', 'P', 6, 1, 'charging', 0, '${now}'),
        ('swap-outlet', 'op', 'SO', 6, 1, 'swap', 1, '${now}'),
        ('off-depot', 'op', 'OD', 6, 1, 'swap', 1, '${now}');
      insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('parcel', 1, '', 0, '${now}'), ('both', 1, '', 0, '${now}'), ('off-depot', 0, '', 0, '${now}');
      insert into charging_points (id, station_id, label, created_at) values ('cp', 'swap-outlet', '1', '${now}');
      insert into ev_chargers (id, name, connector, power_kw, station_id, created_at) values ('ev', 'Borne', 'type2', 22, 'charge', '${now}');
    `);
    db.exec(readFileSync(new URL(files.find((f) => f.startsWith("0026"))!, dir), "utf8"));
    expect(unlocked(db, "swap")).toEqual(["swap"]);
    expect(unlocked(db, "charge")).toEqual(["charging", "ev"]);
    expect(unlocked(db, "both")).toEqual(["charging", "drivers", "parcels", "swap"]);
    expect(unlocked(db, "parcel")).toEqual(["drivers", "parcels"]);
    expect(unlocked(db, "swap-outlet")).toEqual(["charging", "swap"]);
    expect(unlocked(db, "off-depot")).toEqual(["swap"]);
  });

  it("unlocks what an admin sets up later, but keeps what an admin switched off", async () => {
    const { db, env } = await setup();
    expect(unlocked(db, "be")).toEqual(["charging", "drivers", "parcels", "swap"]);
    expect(unlocked(db, "kara")).toEqual(["swap"]);
    expect((await setUnlocked(env, "admin", "kara", "swap", false)).status).toBe(200);
    // Saving the station again (same kind) does not bring it back; a new kind brings the new service.
    db.exec("update stations set kind = 'both' where id = 'kara'");
    expect(unlocked(db, "kara")).toEqual(["charging"]);
    // A depot switched on (an upsert, as in worker/parcels.ts) and a car charger assigned.
    const now = new Date().toISOString();
    const upsert = `insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('kara', ?, '', 0, '${now}')
      on conflict (station_id) do update set is_active = excluded.is_active`;
    db.prepare(upsert).run(0);
    expect(unlocked(db, "kara")).toEqual(["charging"]);
    db.prepare(upsert).run(1);
    db.exec(`insert into ev_chargers (id, name, connector, power_kw, station_id, created_at) values ('ev', 'Borne', 'type2', 22, 'kara', '${now}')`);
    expect(unlocked(db, "kara")).toEqual(["charging", "drivers", "ev", "parcels"]);
  });
});

describe("R8: a service is active only with its global switch on AND the station unlocked", () => {
  for (const service of ["parcels", "drivers"] as const) {
    for (const globalOn of [true, false]) {
      for (const stationOn of [true, false]) {
        it(`${service}: global ${globalOn ? "on" : "off"}, station ${stationOn ? "unlocked" : "locked"}`, async () => {
          const { env } = await setup();
          await setParcelsEnabled(env, ADMIN, service === "parcels" ? globalOn : true);
          await setDriversEnabled(env, ADMIN, service === "drivers" ? globalOn : true);
          if (!stationOn) await setUnlocked(env, "admin", "be", service, false);
          expect(await serviceActive(env.DB, "be", service)).toBe(globalOn && stationOn);
          // Owner and admin lists say the same.
          const r = row(await list(env, "yao"), "be", service);
          expect({ globalOn: r.globalOn, unlocked: r.unlocked, active: r.active }).toEqual({ globalOn, unlocked: stationOn, active: globalOn && stationOn });
          if (service === "parcels") {
            // What customers see.
            expect((await station(env, "be"))?.parcelPoint ?? null).toEqual(globalOn && stationOn ? { counter: true, lockers: 0 } : null);
            if (globalOn) {
              const info = (await call(env, "ama", "GET", "/api/parcels/info")).body as ParcelInfo;
              expect(info.depots.map((d) => d.stationId)).toEqual(stationOn ? ["be"] : []);
            }
          }
        });
      }
    }
  }

  it("swap and outlets have no global switch: only the station unlock counts", async () => {
    const { env } = await setup();
    expect(await serviceActive(env.DB, "be", "swap")).toBe(true);
    expect((await call(env, "ama", "POST", "/api/reservations", { stationId: "be", type: "battery" })).status).toBe(200);
    await setUnlocked(env, "admin", "be", "charging", false);
    expect(await serviceActive(env.DB, "be", "charging")).toBe(false);
    expect((await station(env, "be"))?.kind).toBe("swap");
    await setUnlocked(env, "admin", "be", "swap", false);
    // Only the parcel point is left for customers.
    expect((await station(env, "be"))?.kind).toBe("parcel");
  });

  it("refuses a reservation for a locked service", async () => {
    const { env } = await setup();
    await setUnlocked(env, "admin", "be", "charging", false);
    expect(await call(env, "ama", "POST", "/api/reservations", { stationId: "be", type: "slot" })).toEqual({
      status: 400,
      body: { error: "service_not_offered" },
    });
  });

  it("refuses a new parcel at a station locked for parcels", async () => {
    const { db, env } = await setup();
    const now = new Date().toISOString();
    db.exec(`insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('kara', 1, '', 0, '${now}')`);
    await setUnlocked(env, "admin", "kara", "parcels", false);
    const parcel = {
      senderPhone: "90000010",
      recipientPhone: "90000011",
      toStationId: "kara",
      content: "Livres",
      measures: { lengthCm: 20, widthCm: 20, heightCm: 20, weightKg: 1 },
    };
    expect(await call(env, "afi", "POST", "/api/stations/be/parcels", parcel)).toEqual({ status: 400, body: { error: "depot_inactive" } });
  });

  it("hides a station with no active service left", async () => {
    const { env } = await setup();
    expect(await station(env, "kara")).toBeTruthy();
    await setUnlocked(env, "admin", "kara", "swap", false);
    expect(await station(env, "kara")).toBeUndefined();
  });
});

describe("R9: Lite switches parcels and drivers off everywhere", () => {
  it("whatever the module switches and the station unlock say", async () => {
    const { env } = await setup();
    await setDriversEnabled(env, ADMIN, true);
    expect(await serviceActive(env.DB, "be", "parcels")).toBe(true);
    expect(await serviceActive(env.DB, "be", "drivers")).toBe(true);
    await setLiteEnabled(env, ADMIN, true);
    for (const service of ["parcels", "drivers", "ev"] as const) expect(await serviceActive(env.DB, "be", service), service).toBe(false);
    // Swap and outlets keep running (cash only in Lite).
    expect(await serviceActive(env.DB, "be", "swap")).toBe(true);
    expect(await serviceActive(env.DB, "be", "charging")).toBe(true);
    const r = row(await list(env, "admin"), "be", "parcels");
    expect({ unlocked: r.unlocked, globalOn: r.globalOn, active: r.active }).toEqual({ unlocked: true, globalOn: false, active: false });
    await setLiteEnabled(env, ADMIN, false);
    expect(await serviceActive(env.DB, "be", "drivers")).toBe(true);
  });
});

describe("owner requests, admin decides", () => {
  it("runs request, approval and rejection", async () => {
    const { env } = await setup();
    expect(row(await list(env, "kossi"), "kara", "parcels")).toMatchObject({ unlocked: false, status: null, active: false });

    expect(await request(env, "kossi", "kara", "parcels")).toEqual({ status: 200, body: null });
    expect(row(await list(env, "kossi"), "kara", "parcels")).toMatchObject({ unlocked: false, status: "pending", requestedBy: "+228 90 •• •• 03" });
    expect(await request(env, "kossi", "kara", "parcels")).toEqual({ status: 409, body: { error: "service_request_pending" } });
    // The admin sees it too.
    expect(row(await list(env, "admin"), "kara", "parcels").status).toBe("pending");

    expect(await decide(env, "admin", "kara", "parcels", true)).toEqual({ status: 200, body: null });
    expect(row(await list(env, "kossi"), "kara", "parcels")).toMatchObject({ unlocked: true, status: "approved", active: true });
    expect(await serviceActive(env.DB, "kara", "parcels")).toBe(true);
    expect(await request(env, "kossi", "kara", "parcels")).toEqual({ status: 409, body: { error: "service_already_unlocked" } });
    expect(await decide(env, "admin", "kara", "parcels", true)).toEqual({ status: 409, body: { error: "no_pending_request" } });

    await request(env, "kossi", "kara", "charging");
    expect(await decide(env, "admin", "kara", "charging", false)).toEqual({ status: 200, body: null });
    expect(row(await list(env, "kossi"), "kara", "charging")).toMatchObject({ unlocked: false, status: "rejected" });
    // Asking again after a refusal is allowed.
    expect((await request(env, "kossi", "kara", "charging")).status).toBe(200);
    // Switching directly settles the pending request.
    await setUnlocked(env, "admin", "kara", "charging", true);
    expect(row(await list(env, "kossi"), "kara", "charging")).toMatchObject({ unlocked: true, status: "approved" });
  });

  it("logs every step with the station", async () => {
    const { db, env } = await setup();
    await request(env, "kossi", "kara", "ev");
    await decide(env, "admin", "kara", "ev", true);
    await setUnlocked(env, "admin", "kara", "ev", false);
    const log = db.prepare("select actor, row_id, station_id, changes from audit_log where table_name = 'station_services' order by id").all();
    expect(log).toEqual([
      { actor: "kossi", row_id: "kara:ev", station_id: "kara", changes: '{"service":"ev","status":[null,"pending"]}' },
      { actor: "admin", row_id: "kara:ev", station_id: "kara", changes: '{"service":"ev","status":["pending","approved"],"unlocked":[false,true]}' },
      { actor: "admin", row_id: "kara:ev", station_id: "kara", changes: '{"service":"ev","unlocked":[true,false]}' },
    ]);
  });

  it("refuses unknown services and stations", async () => {
    const { env } = await setup();
    expect((await request(env, "kossi", "kara", "teleport")).status).toBe(400);
    expect((await setUnlocked(env, "admin", "nowhere", "swap", true)).status).toBe(404);
  });
});

describe("role checks", () => {
  it("request: the station's owner only", async () => {
    const { env } = await setup();
    expect((await request(env, "yao", "be", "ev")).status).toBe(200);
    // Wrong owner: Kossi runs another operator.
    expect(await request(env, "kossi", "be", "ev")).toEqual({ status: 403, body: { error: "forbidden" } });
    // Staff of the station, rider, fleet manager, admin (an admin switches directly), nobody signed in.
    for (const as of ["afi", "ama", "edem", "admin"]) expect((await request(env, as, "be", "drivers")).status, as).toBe(403);
    expect((await request(env, null, "be", "drivers")).status).toBe(401);
  });

  it("decide and set: admins only", async () => {
    const { env } = await setup();
    await request(env, "kossi", "kara", "ev");
    for (const as of ["yao", "kossi", "afi", "ama", "edem"]) {
      expect((await decide(env, as, "kara", "ev", true)).status, as).toBe(403);
      expect((await setUnlocked(env, as, "kara", "ev", true)).status, as).toBe(403);
    }
    expect(row(await list(env, "kossi"), "kara", "ev")).toMatchObject({ unlocked: false, status: "pending" });
  });

  it("list: owners their own stations, admins all, nobody else", async () => {
    const { env } = await setup();
    expect(new Set((await list(env, "yao")).map((r) => r.stationId))).toEqual(new Set(["be"]));
    expect(new Set((await list(env, "kossi")).map((r) => r.stationId))).toEqual(new Set(["kara"]));
    expect(new Set((await list(env, "admin")).map((r) => r.stationId))).toEqual(new Set(["be", "kara"]));
    expect((await list(env, "admin")).filter((r) => r.stationId === "be")).toHaveLength(5);
    for (const as of ["afi", "ama", "edem"]) expect((await call(env, as, "GET", "/api/station-services")).status, as).toBe(403);
    expect((await call(env, null, "GET", "/api/station-services")).status).toBe(401);
  });
});
