import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { StationInput, StationView } from "../src/lib/types";
import { handleApi } from "./api";
import { createDevice, deleteDevice } from "./devices";
import type { Env } from "./env";
import { sha256 } from "./http";
import { DB_CUSTOMER } from "./roles";

// Station points: swap, charging (connected sockets), parcel counter, parcel lockers.
// Runs the API on a minimal D1 on top of SQLite, with the real migrations (as in features.test.ts).

type Value = string | number | null;

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : (p as Value))));
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run() {
    return this.db.prepare(this.sql).run(...this.params);
  }
}

const TOKEN = "admin-session-token-0123456789";

async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  const dir = new URL("./migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("begin");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("commit");
        return out;
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
    },
  };
  const now = new Date().toISOString();
  db.prepare("insert into users (id, phone, full_name, role, created_at) values ('admin', '+22890000001', 'Admin', 'admin', ?)").run(now);
  db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, 'admin', ?, ?)").run(
    await sha256(TOKEN),
    now,
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  return { db, d1: d1 as unknown as D1Database, env: { DB: d1 } as unknown as Env };
}

const OPERATOR = "00000000-0000-4000-8000-000000000001"; // created by 0001_init.sql

function station(name: string, patch: Partial<StationInput> = {}): StationInput {
  return {
    operatorId: OPERATOR,
    name,
    address: "",
    lat: 6.13,
    lng: 1.22,
    kind: "both",
    vehicleTypes: ["scooter"],
    chargingSlots: 0,
    batteryCapacity: 0,
    openingHours: "00:00-24:00",
    phone: null,
    ...patch,
  };
}

async function call(env: Env, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" };
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

const save = (env: Env, input: StationInput, id: string | null = null) => call(env, "POST", "/api/admin/stations", { id, input });

async function stations(env: Env): Promise<StationView[]> {
  return (await call(env, "GET", "/api/stations")).body as StationView[];
}

async function byName(env: Env, name: string): Promise<StationView> {
  return (await stations(env)).find((s) => s.name === name)!;
}

describe("station points", () => {
  it("keeps a parcel point with lockers only", async () => {
    const { env } = await setup();
    const res = await save(env, station("Casiers Adewui", { kind: "parcel", parcelDepot: { isActive: true, counter: false, lockers: 12, note: "" } }));
    expect(res.status).toBe(200);
    const s = await byName(env, "Casiers Adewui");
    expect(s.kind).toBe("parcel");
    expect(s.parcelPoint).toEqual({ counter: false, lockers: 12 });
    expect(s.chargingSlots).toBe(0);
  });

  it("refuses a station without any point", async () => {
    const { env } = await setup();
    expect(await save(env, station("Rien", { kind: "parcel" }))).toEqual({ status: 400, body: { error: "station_without_point" } });
    expect(
      await save(env, station("Rien", { kind: "parcel", parcelDepot: { isActive: false, counter: true, lockers: 0, note: "" } })),
    ).toEqual({ status: 400, body: { error: "station_without_point" } });
  });

  it("does not let the depot of a parcel point be switched off on its own", async () => {
    const { env } = await setup();
    await save(env, station("Comptoir", { kind: "parcel", parcelDepot: { isActive: true, counter: true, lockers: 0, note: "au comptoir" } }));
    const s = await byName(env, "Comptoir");
    const res = await call(env, "POST", "/api/admin/parcel-depots", { stationId: s.id, input: { isActive: false, note: "", lockers: 0 } });
    expect(res.body).toEqual({ error: "station_without_point" });
    // Leaving `counter` out keeps it.
    await call(env, "POST", "/api/admin/parcel-depots", { stationId: s.id, input: { isActive: true, note: "", lockers: 4 } });
    expect((await byName(env, "Comptoir")).parcelPoint).toEqual({ counter: true, lockers: 4 });
  });

  it("counts charging places from the connected outlets, not from the form", async () => {
    const { db, d1, env } = await setup();
    await save(env, station("Recharge", { kind: "charging", chargingSlots: 10 }));
    let s = await byName(env, "Recharge");
    expect(s.chargingSlots).toBe(0);

    await createDevice(d1, { externalId: "A84041000181F0A1", stationId: s.id, outlets: 2 }, "admin");
    await createDevice(d1, { externalId: "A84041000181F0A2", stationId: s.id, outlets: 4 }, "admin");
    expect((await byName(env, "Recharge")).chargingSlots).toBe(6);

    // Saving the station again keeps the count.
    await save(env, station("Recharge", { kind: "charging", chargingSlots: 1 }), s.id);
    expect((await byName(env, "Recharge")).chargingSlots).toBe(6);

    db.prepare("update station_status set free_slots = 6 where station_id = ?").run(s.id);
    await deleteDevice(d1, "A84041000181F0A2", "admin");
    s = await byName(env, "Recharge");
    expect(s.chargingSlots).toBe(2);
    expect(s.status.freeSlots).toBeLessThanOrEqual(2);
  });

  it("makes a swap-only or parcel station a charging point when a socket is added", async () => {
    const { d1, env } = await setup();
    await save(env, station("Echange", { kind: "swap", batteryCapacity: 8 }));
    await save(env, station("Colis", { kind: "parcel", parcelDepot: { isActive: true, counter: true, lockers: 0, note: "" } }));
    await createDevice(d1, { externalId: "SOCKET01", stationId: (await byName(env, "Echange")).id, outlets: 2 }, "admin");
    await createDevice(d1, { externalId: "SOCKET02", stationId: (await byName(env, "Colis")).id, outlets: 2 }, "admin");
    expect((await byName(env, "Echange")).kind).toBe("both");
    const colis = await byName(env, "Colis");
    expect(colis.kind).toBe("charging");
    expect(colis.parcelPoint).toEqual({ counter: true, lockers: 0 });
  });

  it("offers no reservation at a parcel point", async () => {
    const { env, db } = await setup();
    await save(env, station("Colis", { kind: "parcel", parcelDepot: { isActive: true, counter: true, lockers: 0, note: "" } }));
    const s = await byName(env, "Colis");
    // A new station starts closed; staff open it.
    db.exec(`update station_status set is_open = 1 where station_id = '${s.id}'`);
    // Admins do not reserve (role matrix): as a rider.
    expect((await call(env, "POST", "/api/reservations", { stationId: s.id, type: "battery" })).body).toEqual({ error: "forbidden" });
    db.exec(`update users set role = '${DB_CUSTOMER}' where id = 'admin'`);
    for (const type of ["slot", "battery"]) {
      expect((await call(env, "POST", "/api/reservations", { stationId: s.id, type })).body).toEqual({ error: "service_not_offered" });
    }
  });

  it("hides parcel points from the app while the parcel module is off", async () => {
    const { db, env } = await setup();
    await save(env, station("Colis", { kind: "parcel", parcelDepot: { isActive: true, counter: true, lockers: 0, note: "" } }));
    await save(env, station("Mixte", { kind: "both", parcelDepot: { isActive: true, counter: true, lockers: 3, note: "" } }));
    db.exec("update app_settings set value = '0' where key = 'parcels_enabled'");
    const list = await stations(env);
    expect(list.map((s) => s.name)).toEqual(["Mixte"]);
    expect(list[0].parcelPoint).toBeNull();
  });
});

describe("battery types", () => {
  async function addType(env: Env, brand: string, name: string) {
    const res = await call(env, "POST", "/api/admin/battery-types", { id: null, input: { brand, name, isActive: true } });
    return (res.body as { id: string }).id;
  }

  it("lists the types a swap point swaps, and only active ones in the app", async () => {
    const { env } = await setup();
    const spiro = await addType(env, "Spiro", "72 V");
    const ovt = await addType(env, "Omnivoltaic", "60 V");
    expect((await call(env, "POST", "/api/admin/battery-types", { id: null, input: { brand: "Spiro", name: "72 V", isActive: true } })).body).toEqual({
      error: "battery_type_exists",
    });

    await save(env, station("Echange", { kind: "swap", batteryCapacity: 10, batteryTypeIds: [spiro, ovt] }));
    expect((await byName(env, "Echange")).batteryTypes!.map((t) => t.brand)).toEqual(["Omnivoltaic", "Spiro"]);

    // Switched off: gone from the app, still known to the backoffice.
    await call(env, "POST", "/api/admin/battery-types", { id: ovt, input: { brand: "Omnivoltaic", name: "60 V", isActive: false } });
    expect((await byName(env, "Echange")).batteryTypes!.map((t) => t.brand)).toEqual(["Spiro"]);
    const all = (await call(env, "GET", "/api/admin/battery-types")).body as { id: string; isActive: boolean }[];
    expect(all.find((t) => t.id === ovt)?.isActive).toBe(false);
  });

  it("keeps types only for a swap point, and refuses unknown ones", async () => {
    const { env } = await setup();
    const spiro = await addType(env, "Spiro", "72 V");
    await save(env, station("Recharge", { kind: "charging", batteryTypeIds: [spiro] }));
    expect((await byName(env, "Recharge")).batteryTypes).toEqual([]);
    expect((await save(env, station("X", { kind: "swap", batteryTypeIds: ["nope"] }))).status).toBe(400);

    // Leaving the list out keeps it.
    await save(env, station("Mixte", { kind: "both", batteryTypeIds: [spiro] }));
    const s = await byName(env, "Mixte");
    await save(env, station("Mixte", { kind: "both" }), s.id);
    expect((await byName(env, "Mixte")).batteryTypes!.map((t) => t.id)).toEqual([spiro]);
  });

  it("counts full batteries per type through counter events, the station total being their sum", async () => {
    const { env } = await setup();
    const spiro = await addType(env, "Spiro", "72 V");
    const ovt = await addType(env, "Omnivoltaic", "60 V");
    const other = await addType(env, "Omnivoltaic", "72 V");
    await save(env, station("Echange", { kind: "swap", batteryCapacity: 10, batteryTypeIds: [spiro, ovt] }));
    const { id } = await byName(env, "Echange");
    let n = 0;
    const event = (type: string, batteryTypeId: string) =>
      call(env, "POST", `/api/stations/${id}/battery-events`, { type, batteryTypeId, requestId: `req-${String(++n).padStart(6, "0")}` }, id);

    for (let i = 0; i < 4; i++) expect((await event("full", spiro)).status).toBe(200);
    for (let i = 0; i < 2; i++) expect((await event("full", ovt)).status).toBe(200);
    let s = await byName(env, "Echange");
    expect(s.batteryTypes!.map((t) => [t.brand, t.fullBatteries])).toEqual([["Omnivoltaic", 2], ["Spiro", 4]]);
    expect(s.status.fullBatteries).toBe(6);

    await event("issue", ovt);
    await event("issue", ovt);
    expect((await byName(env, "Echange")).status.fullBatteries).toBe(4);

    // A type the station does not swap is refused, and numbers are never set directly any more.
    expect((await event("full", other)).status).toBe(400);
    expect((await call(env, "PATCH", `/api/stations/${id}/status`, { typeBatteries: { [spiro]: 1 } }, id)).status).toBe(400);
    expect((await call(env, "PATCH", `/api/stations/${id}/status`, { fullBatteries: 1 }, id)).status).toBe(400);

    // Saving the station keeps the counts of the types it still swaps.
    await save(env, station("Echange", { kind: "swap", batteryCapacity: 10, batteryTypeIds: [spiro, other] }), id);
    s = await byName(env, "Echange");
    expect(s.batteryTypes!.map((t) => [t.name, t.fullBatteries])).toEqual([["72 V", 0], ["72 V", 4]]);
  });
});

describe("electric car chargers", () => {
  const charger = (stationId: string | null, patch: Record<string, unknown> = {}) => ({
    name: "Borne VE 1",
    connector: "type2",
    powerKw: 22,
    stationId,
    isActive: true,
    ...patch,
  });

  it("adds a charger, then assigns it to a station that then charges electric cars", async () => {
    const { env } = await setup();
    await save(env, station("Mixte"));
    const s = await byName(env, "Mixte");
    expect(s.evChargers).toEqual([]);

    // Added first without a station: nothing shows in the app yet.
    const res = await call(env, "POST", "/api/admin/ev-chargers", { id: null, input: charger(null) });
    expect(res.status).toBe(200);
    const id = (res.body as { id: string }).id;
    expect((await byName(env, "Mixte")).evChargers).toEqual([]);

    await call(env, "POST", "/api/admin/ev-chargers", { id, input: charger(s.id) });
    expect((await byName(env, "Mixte")).evChargers).toEqual([{ id, name: "Borne VE 1", connector: "type2", powerKw: 22 }]);
    const all = (await call(env, "GET", "/api/admin/ev-chargers")).body as { id: string; stationId: string | null }[];
    expect(all).toEqual([expect.objectContaining({ id, stationId: s.id })]);

    // Switched off: gone from the app, still in the backoffice.
    await call(env, "POST", "/api/admin/ev-chargers", { id, input: charger(s.id, { isActive: false }) });
    expect((await byName(env, "Mixte")).evChargers).toEqual([]);
    expect(((await call(env, "GET", "/api/admin/ev-chargers")).body as unknown[]).length).toBe(1);

    expect((await call(env, "DELETE", `/api/admin/ev-chargers/${id}`)).status).toBe(200);
    expect((await call(env, "GET", "/api/admin/ev-chargers")).body).toEqual([]);
  });

  it("refuses unknown stations and invalid chargers", async () => {
    const { env } = await setup();
    expect((await call(env, "POST", "/api/admin/ev-chargers", { id: null, input: charger("nope") })).body).toEqual({ error: "station_not_found" });
    expect((await call(env, "POST", "/api/admin/ev-chargers", { id: null, input: charger(null, { connector: "tesla" }) })).status).toBe(400);
    expect((await call(env, "POST", "/api/admin/ev-chargers", { id: null, input: charger(null, { powerKw: 0 }) })).status).toBe(400);
    expect((await call(env, "POST", "/api/admin/ev-chargers", { id: null, input: charger(null, { name: " " }) })).status).toBe(400);
  });

  it("accepts a household Schuko socket", async () => {
    const { env } = await setup();
    const res = await call(env, "POST", "/api/admin/ev-chargers", { id: null, input: charger(null, { connector: "schuko", powerKw: 2.3 }) });
    expect(res.status).toBe(200);
    expect((await call(env, "GET", "/api/admin/ev-chargers")).body).toEqual([expect.objectContaining({ connector: "schuko", powerKw: 2.3 })]);
  });
});
