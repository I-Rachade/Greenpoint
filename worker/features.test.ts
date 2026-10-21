import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Profile } from "../src/lib/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { driversEnabled, getFeatures, PARCEL_ROUTE, setDriversEnabled, setLiteEnabled, setParcelsEnabled } from "./features";
import { walletAccess } from "./wallet";

// --- A minimal D1 on top of SQLite, with the real migrations (as in wallet.test.ts) ---

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

function setup() {
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
  db.prepare("insert into users (id, phone, full_name, role, created_at) values ('admin', '+22890000001', 'Admin', 'admin', ?)").run(
    new Date().toISOString(),
  );
  return { db, env: { DB: d1 } as unknown as Env };
}

const ADMIN: Profile = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" };

/** What the full version adds to the parcel and driver switches. */
const FULL = { wallet: true, evChargers: true, share: false, lite: false };

const get = (env: Env, path: string) => handleApi(new Request(`https://app.poinderecharge.com${path}`), env);

describe("parcel module switch", () => {
  it("starts on", async () => {
    const { env } = setup();
    expect(await getFeatures(env)).toEqual({ parcels: true, drivers: false, ...FULL });
    expect((await get(env, "/api/parcels/info")).status).toBe(200);
  });

  it("hides parcel and partner routes when off, and logs who switched", async () => {
    const { db, env } = setup();
    await setParcelsEnabled(env, ADMIN, false);
    expect(await getFeatures(env)).toEqual({ parcels: false, drivers: false, ...FULL });
    expect(await (await get(env, "/api/features")).json()).toEqual({ parcels: false, drivers: false, ...FULL });

    for (const path of ["/api/parcels/info", "/api/parcels/mine", "/api/stations/s1/parcels", "/api/stations/s1/bookings", "/api/partner/v1/stations"]) {
      const res = await get(env, path);
      expect(res.status, path).toBe(404);
      expect(await res.json(), path).toEqual({ error: "not_found" });
    }
    // The backoffice keeps its pages (they still ask for an admin).
    expect((await get(env, "/api/admin/parcels")).status).toBe(401);

    const log = db.prepare("select actor, table_name, row_id, changes from audit_log where row_id = 'parcels_enabled'").get();
    expect(log).toEqual({ actor: "admin", table_name: "parcels", row_id: "parcels_enabled", changes: '{"enabled":false}' });

    await setParcelsEnabled(env, ADMIN, true);
    expect((await get(env, "/api/parcels/info")).status).toBe(200);
  });

  it("counts as on before the migration added the row", async () => {
    const { db, env } = setup();
    db.exec("delete from app_settings where key = 'parcels_enabled'");
    expect(await getFeatures(env)).toEqual({ parcels: true, drivers: false, ...FULL });
    await setParcelsEnabled(env, ADMIN, false);
    expect(await getFeatures(env)).toEqual({ parcels: false, drivers: false, ...FULL });
  });

  it("matches only customer and staff parcel routes", () => {
    for (const path of ["/api/parcels/info", "/api/parcels/x/cancel", "/api/stations/a-1/parcels/pickup", "/api/stations/a/bookings/b/accept"]) {
      expect(PARCEL_ROUTE.test(path), path).toBe(true);
    }
    for (const path of ["/api/admin/parcels", "/api/stations", "/api/stations/a/status", "/api/parcelsx", "/api/features"]) {
      expect(PARCEL_ROUTE.test(path), path).toBe(false);
    }
  });
});

describe("Lite version switch", () => {
  it("hides parcels, drivers and car chargers but keeps Green Credit, and brings them back as they were", async () => {
    const { db, env } = setup();
    await setDriversEnabled(env, ADMIN, true);
    await setLiteEnabled(env, ADMIN, true);

    const lite = { parcels: false, drivers: false, wallet: true, evChargers: false, share: false, lite: true };
    expect(await getFeatures(env)).toEqual(lite);
    expect(await (await get(env, "/api/features")).json()).toEqual(lite);
    expect(await driversEnabled(env.DB)).toBe(false);
    expect((await get(env, "/api/parcels/info")).status).toBe(404);
    await expect(walletAccess(env, ADMIN)).resolves.toMatchObject({ enabled: true });

    const log = db.prepare("select actor, table_name, row_id, changes from audit_log where row_id = 'lite_mode'").get();
    expect(log).toEqual({ actor: "admin", table_name: "settings", row_id: "lite_mode", changes: '{"enabled":true}' });

    await setLiteEnabled(env, ADMIN, false);
    expect(await getFeatures(env)).toEqual({ parcels: true, drivers: true, ...FULL });
    expect((await get(env, "/api/parcels/info")).status).toBe(200);
    await expect(walletAccess(env, ADMIN)).resolves.toMatchObject({ enabled: true });
  });
});

describe("Lite version and car chargers", () => {
  it("leaves car chargers out of the public station list", async () => {
    const { db, env } = setup();
    const now = new Date().toISOString();
    db.exec(`
      insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, created_at) values ('st', '00000000-0000-4000-8000-000000000001', 'Bè', 6.13, 1.22, 'both', 10, '${now}');
      insert into station_status (station_id, free_slots, full_batteries, updated_at) values ('st', 0, 10, '${now}');
      insert into ev_chargers (id, name, connector, power_kw, station_id, created_at) values ('ev1', 'Borne 1', 'type2', 22, 'st', '${now}');
    `);
    const chargers = async () => ((await (await get(env, "/api/stations")).json()) as { evChargers?: unknown[] }[])[0].evChargers ?? [];
    expect(await chargers()).toHaveLength(1);
    await setLiteEnabled(env, ADMIN, true);
    expect(await chargers()).toEqual([]);
  });
});
