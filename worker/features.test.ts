import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { Profile } from "../src/lib/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { getFeatures, PARCEL_ROUTE, setParcelsEnabled } from "./features";

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

const get = (env: Env, path: string) => handleApi(new Request(`https://app.poinderecharge.com${path}`), env);

describe("parcel module switch", () => {
  it("starts on", async () => {
    const { env } = setup();
    expect(await getFeatures(env)).toEqual({ parcels: true, drivers: false });
    expect((await get(env, "/api/parcels/info")).status).toBe(200);
  });

  it("hides parcel and partner routes when off, and logs who switched", async () => {
    const { db, env } = setup();
    await setParcelsEnabled(env, ADMIN, false);
    expect(await getFeatures(env)).toEqual({ parcels: false, drivers: false });
    expect(await (await get(env, "/api/features")).json()).toEqual({ parcels: false, drivers: false });

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
    expect(await getFeatures(env)).toEqual({ parcels: true, drivers: false });
    await setParcelsEnabled(env, ADMIN, false);
    expect(await getFeatures(env)).toEqual({ parcels: false, drivers: false });
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
