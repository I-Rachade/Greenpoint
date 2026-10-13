import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { StationInput, StationView } from "../src/lib/types";
import { handleApi } from "./api";
import { createDevice, deleteDevice } from "./devices";
import type { Env } from "./env";
import { sha256 } from "./http";

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
    openingHours: "",
    phone: null,
    ...patch,
  };
}

async function call(env: Env, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
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
    const { env } = await setup();
    await save(env, station("Colis", { kind: "parcel", parcelDepot: { isActive: true, counter: true, lockers: 0, note: "" } }));
    const s = await byName(env, "Colis");
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
