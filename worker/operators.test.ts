import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AdminOperator, OwnerView } from "../src/lib/operators";
import type { StationInput, StationView } from "../src/lib/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";

// Operator accounts: an admin links an account to an operator; that account runs all the operator's stations.
// Runs the API on a minimal D1 on top of SQLite, with the real migrations (as in stations.test.ts).

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
    const res = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(res.changes) } };
  }
}

const USERS = [
  { id: "admin", phone: "+22890000001", role: "admin" as const },
  { id: "yao", phone: "+22890000002", role: "customer" as const }, // will run Togo Moto
  { id: "afi", phone: "+22890000003", role: "customer" as const }, // will work at a station
  { id: "kossi", phone: "+22890000004", role: "customer" as const }, // runs nothing
];

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
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, role, created_at) values (?, ?, ?, ?)").run(u.id, u.phone, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`session-token-of-${u.id}-0123456789`), u.id, now, expires);
  }
  return { db, env: { DB: d1 } as unknown as Env };
}

async function call(env: Env, as: string, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { Authorization: `Bearer session-token-of-${as}-0123456789`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

function station(operatorId: string, name: string): StationInput {
  return {
    operatorId,
    name,
    address: "",
    lat: 6.13,
    lng: 1.22,
    kind: "swap",
    vehicleTypes: ["scooter"],
    chargingSlots: 0,
    batteryCapacity: 10,
    openingHours: "7h-19h",
    phone: null,
  };
}

/** An operator "Togo Moto" with stations in Lomé and Kara, run by Yao; Bè belongs to another operator. */
async function withOperator() {
  const { db, env } = await setup();
  const created = await call(env, "admin", "POST", "/api/admin/operators", { id: null, input: { name: "Togo Moto", contactPhone: "90 11 22 33" } });
  expect(created.status).toBe(200);
  const operatorId = (created.body as { id: string }).id;
  await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: station(operatorId, "Lomé Centre") });
  await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: station(operatorId, "Kara Gare") });
  await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: station("00000000-0000-4000-8000-000000000001", "Bè") });
  const all = (await call(env, "admin", "GET", "/api/stations")).body as StationView[];
  const id = (name: string) => all.find((s) => s.name === name)!.id;
  expect(await call(env, "admin", "POST", `/api/admin/operators/${operatorId}/owners`, { contact: "90 00 00 02" })).toEqual({ status: 200, body: null });
  return { db, env, operatorId, lome: id("Lomé Centre"), kara: id("Kara Gare"), be: id("Bè") };
}

describe("operator accounts", () => {
  it("lets an admin create an operator and link an account", async () => {
    const { env, operatorId } = await withOperator();
    const ops = (await call(env, "admin", "GET", "/api/admin/operators")).body as AdminOperator[];
    const op = ops.find((o) => o.id === operatorId)!;
    expect(op).toMatchObject({ name: "Togo Moto", isOwn: false, contactPhone: "+22890112233", stationCount: 2 });
    expect(op.owners.map((o) => o.userId)).toEqual(["yao"]);
    const me = (await call(env, "yao", "GET", "/api/me")).body as { ownerOf?: string[] } | null;
    expect(me?.ownerOf).toEqual([operatorId]);
  });

  it("refuses an unknown account and non-admins", async () => {
    const { env, operatorId } = await withOperator();
    expect(await call(env, "admin", "POST", `/api/admin/operators/${operatorId}/owners`, { contact: "90 99 99 99" })).toEqual({
      status: 404,
      body: { error: "account_not_found" },
    });
    expect((await call(env, "yao", "GET", "/api/admin/operators")).status).toBe(403);
    expect((await call(env, "yao", "POST", "/api/admin/operators", { id: null, input: { name: "X", contactPhone: null } })).status).toBe(403);
  });

  it("shows the owner all the operator's stations and no others", async () => {
    const { env, lome, kara } = await withOperator();
    const view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.operators.map((o) => o.name)).toEqual(["Togo Moto"]);
    expect(view.stations.map((s) => s.id).sort()).toEqual([lome, kara].sort());
    const staffStations = (await call(env, "yao", "GET", "/api/staff/stations")).body as StationView[];
    expect(staffStations.map((s) => s.id).sort()).toEqual([lome, kara].sort());
    expect((await call(env, "kossi", "GET", "/api/owner")).status).toBe(403);
  });

  it("lets the owner run station status, choose staff and edit details only at their stations", async () => {
    const { env, lome, be } = await withOperator();
    expect((await call(env, "yao", "PATCH", `/api/stations/${lome}/status`, { isOpen: false })).status).toBe(200);
    expect((await call(env, "yao", "PATCH", `/api/stations/${be}/status`, { isOpen: false })).status).toBe(403);

    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" })).status).toBe(200);
    expect((await call(env, "afi", "GET", "/api/staff/stations")).body).toMatchObject([{ id: lome }]);
    let view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.staff).toEqual([{ stationId: lome, userId: "afi", label: "+228 90 •• •• 03" }]);
    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: be, contact: "90000003" })).status).toBe(403);

    expect((await call(env, "yao", "POST", `/api/owner/stations/${lome}`, { openingHours: "6h-22h", phone: "90 11 22 33" })).status).toBe(200);
    expect((await call(env, "yao", "POST", `/api/owner/stations/${be}`, { openingHours: "6h-22h", phone: null })).status).toBe(403);
    view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.stations.find((s) => s.id === lome)).toMatchObject({ openingHours: "6h-22h", phone: "90 11 22 33" });

    expect((await call(env, "yao", "DELETE", "/api/owner/staff", { stationId: lome, userId: "afi" })).status).toBe(200);
    expect((await call(env, "afi", "GET", "/api/staff/stations")).body).toEqual([]);
  });

  it("takes the rights away when the admin removes the owner", async () => {
    const { env, operatorId, lome } = await withOperator();
    await call(env, "admin", "DELETE", `/api/admin/operators/${operatorId}/owners/yao`);
    expect((await call(env, "yao", "GET", "/api/owner")).status).toBe(403);
    expect((await call(env, "yao", "PATCH", `/api/stations/${lome}/status`, { isOpen: false })).status).toBe(403);
  });
});
