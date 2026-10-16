import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { GreenpointReceipt, GreenpointRedemption, GreenpointView } from "../src/lib/greenpoint";
import type { Reservation } from "../src/lib/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { tripStatement } from "./greenpoint";
import { sha256 } from "./http";

// greenpoint: CO2 and points for swaps and charges (automatic, only for customers with the app), reward codes.
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
    const r = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(r.changes) } };
  }
}

const OPERATOR = "00000000-0000-4000-8000-000000000001"; // created by 0001_init.sql
const TOKENS = { staff: "staff-session-token-0123456789", kofi: "kofi-session-token-0123456789", admin: "admin-session-token-0123456789" };

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
  const users = [
    ["staff", "+22890000002", "Afi", "operator"],
    ["kofi", "+22896123456", "Kofi Mensah", "rider"],
    ["admin", "+22890000001", "Admin", "admin"],
  ];
  for (const [id, phone, name, role] of users) {
    // Everyone here has signed into the app once (hasApp in greenpoint.ts).
    db.prepare("insert into users (id, phone, full_name, role, created_at, last_sign_in_at) values (?, ?, ?, ?, ?, ?)").run(id, phone, name, role, now, now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(TOKENS[id as keyof typeof TOKENS]),
      id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, is_solar, price_battery_xof, created_at) values ('st', '${OPERATOR}', 'Bè', 6.13, 1.22, 'both', 10, 1, 500, '${now}');
    insert into station_status (station_id, free_slots, full_batteries, updated_at) values ('st', 0, 10, '${now}');
    insert into station_staff (station_id, user_id) values ('st', 'staff');
  `);
  return { db, env: { DB: d1 } as unknown as Env };
}

async function call<T = unknown>(env: Env, who: keyof typeof TOKENS, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKENS[who]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T };
}

const mine = async (env: Env) => (await call<GreenpointView>(env, "kofi", "GET", "/api/greenpoint")).body;

async function swapWithReservation(env: Env) {
  const r = (await call<Reservation>(env, "kofi", "POST", "/api/reservations", { stationId: "st", type: "battery" })).body;
  // A battery reservation is completed by its swap (worker/station-work.ts).
  return call(env, "staff", "POST", "/api/stations/st/swaps", {
    requestId: `req-${r.id.slice(0, 12)}`,
    customerType: "app",
    reservationId: r.id,
    pickupCode: r.pickupCode,
    payment: "cash",
  });
}

let counter = 0;
/** A swap at the counter without reservation, the customer's phone number typed by staff. */
const counterSwap = (env: Env, contact = "+22896123456") =>
  call<{ error?: string }>(env, "staff", "POST", "/api/stations/st/swaps", { requestId: `counter-${++counter}`, customerType: "app", contact, payment: "cash" });

describe("greenpoint", () => {
  it("credits CO2 and points when staff complete a reservation, by the rider's vehicle", async () => {
    const { env } = await setup();
    expect((await call(env, "kofi", "POST", "/api/greenpoint/vehicle", { vehicle: "moped" })).status).toBe(200);
    expect((await swapWithReservation(env)).status).toBe(200);
    const view = await mine(env);
    expect(view.co2Grams).toBe(2000);
    expect(view.points).toBe(20);
    expect(view.level).toBe("pousse");
    expect(view.history[0]).toMatchObject({ kind: "swap", vehicle: "moped", stationName: "Bè" });
  });

  it("credits a counter swap automatically when the customer has the app, even with a typed phone number", async () => {
    const { env } = await setup();
    await call(env, "kofi", "POST", "/api/greenpoint/vehicle", { vehicle: "tricycle" });
    expect((await counterSwap(env, "96 12 34 56")).status).toBe(200);
    expect(await mine(env)).toMatchObject({ co2Grams: 4000, points: 40 });
    expect((await mine(env)).history[0]).toMatchObject({ kind: "visit", stationName: "Bè" });
  });

  it("gives no greenpoints to an account that never opened the app (e.g. made for a parcel)", async () => {
    const { env, db } = await setup();
    db.exec("update users set last_sign_in_at = null where id = 'kofi'");
    expect((await counterSwap(env)).status).toBe(200);
    expect((await swapWithReservation(env)).status).toBe(200);
    expect(db.prepare("select count(*) as n from greenpoint_ledger").get()).toEqual({ n: 0 });
    // Once the person signs in, the next swap counts.
    db.exec(`update users set last_sign_in_at = '${new Date().toISOString()}' where id = 'kofi'`);
    expect((await counterSwap(env)).status).toBe(200);
    expect((await mine(env)).points).toBe(15);
  });

  it("lets nobody add greenpoints by hand: the staff visit form is gone", async () => {
    const { env } = await setup();
    const body = { contact: "+22896123456", service: "swap" };
    expect((await call(env, "staff", "POST", "/api/stations/st/greenpoint/visits", body)).status).toBe(404);
    expect((await call(env, "admin", "POST", "/api/stations/st/greenpoint/visits", body)).status).toBe(404);
    expect((await mine(env)).points).toBe(0);
  });

  it("only gives greenpoints at stations the admin marked as solar", async () => {
    const { env, db } = await setup();
    db.exec("update stations set is_solar = 0 where id = 'st'");
    // A reservation still completes, it just earns nothing.
    expect((await swapWithReservation(env)).status).toBe(200);
    expect((await mine(env)).points).toBe(0);

    const input = { operatorId: OPERATOR, name: "Bè", address: "", lat: 6.13, lng: 1.22, kind: "both", vehicleTypes: ["scooter"], chargingSlots: 0, batteryCapacity: 10, openingHours: "00:00-24:00", phone: null };
    expect((await call(env, "admin", "POST", "/api/admin/stations", { id: "st", input: { ...input, isSolar: true } })).status).toBe(200);
    const st = (await call<{ id: string; isSolar: boolean }[]>(env, "kofi", "GET", "/api/stations")).body.find((s) => s.id === "st");
    expect(st?.isSolar).toBe(true);
    expect((await counterSwap(env)).status).toBe(200);
    expect((await mine(env)).points).toBe(15);
    // Saving without isSolar keeps the mark.
    await call(env, "admin", "POST", "/api/admin/stations", { id: "st", input });
    expect(db.prepare("select is_solar from stations where id = 'st'").get()).toEqual({ is_solar: 1 });
  });

  it("counts at most 3 swaps or charges per day", async () => {
    const { env } = await setup();
    for (let i = 0; i < 4; i++) expect((await counterSwap(env)).status).toBe(200);
    // Swaps over the limit still go through, they just earn nothing.
    expect((await swapWithReservation(env)).status).toBe(200);
    expect((await mine(env)).points).toBe(45);
  });

  it("redeems a reward with a code: points only go once staff confirm, and only once", async () => {
    const { env, db } = await setup();
    db.exec("update greenpoint_rewards set stock = 5 where id = 'free-swap'");
    expect((await call(env, "kofi", "POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" })).body).toEqual({ error: "not_enough_points" });
    await call(env, "kofi", "POST", "/api/greenpoint/vehicle", { vehicle: "tricycle" });
    for (let i = 0; i < 3; i++) await counterSwap(env);
    expect((await mine(env)).points).toBe(120);
    db.exec("update greenpoint_ledger set points = 60");

    const code = (await call<GreenpointRedemption>(env, "kofi", "POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" })).body;
    expect(code.code).toMatch(/^\d{6}$/);
    expect((await call(env, "kofi", "POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" })).body).toEqual({ error: "redemption_open" });
    expect((await mine(env)).points).toBe(180);

    const done = await call<GreenpointReceipt>(env, "staff", "POST", "/api/stations/st/greenpoint/redeem", { code: code.code });
    expect(done.body).toMatchObject({ points: -150, rewardTitle: "Échange de batterie offert" });
    expect((await call(env, "staff", "POST", "/api/stations/st/greenpoint/redeem", { code: code.code })).body).toEqual({ error: "invalid_code" });
    const view = await mine(env);
    expect(view.points).toBe(30);
    // Spending points never lowers the CO2 total or the level.
    expect(view.co2Grams).toBe(12000);
    expect(view.redemption).toBeNull();
    expect(db.prepare("select stock from greenpoint_rewards where id = 'free-swap'").get()).toEqual({ stock: 4 });
  });

  it("lets admins change factors and rewards; others may not", async () => {
    const { env } = await setup();
    const factors = { batteryGrams: { scooter: 1000, moped: 2500, tricycle: 5000, ebike: 300 }, kwhGrams: 1200 };
    expect((await call(env, "kofi", "POST", "/api/admin/greenpoint/factors", factors)).status).toBe(403);
    expect((await call(env, "admin", "POST", "/api/admin/greenpoint/factors", factors)).status).toBe(200);
    expect((await call(env, "admin", "POST", "/api/admin/greenpoint/factors", { batteryGrams: {}, kwhGrams: 1 })).status).toBe(400);
    expect((await counterSwap(env)).status).toBe(200);
    expect(await mine(env)).toMatchObject({ co2Grams: 1000, points: 10 });

    const reward = { title: "Jus offert", description: "", costPoints: 30, provider: "partner", partnerName: "Café Bè", stock: null, validUntil: null, isActive: true };
    expect((await call(env, "admin", "POST", "/api/admin/greenpoint/rewards", { id: null, input: reward })).status).toBe(200);
    const admin = (await call<{ rewards: { title: string }[]; totals: { co2Grams: number } }>(env, "admin", "GET", "/api/admin/greenpoint")).body;
    expect(admin.rewards.map((r) => r.title)).toContain("Jus offert");
    expect(admin.totals.co2Grams).toBe(1000);
    expect((await call(env, "kofi", "GET", "/api/greenpoint/total")).body).toEqual({ co2Grams: 1000 });
  });

  it("counts drivers' CO2 per km on our vehicles for the fleet, but no greenpoints (W10), and no points for the fleet's batteries", async () => {
    const { env, db } = await setup();
    const now = new Date().toISOString();
    db.exec(`
      insert into fleet_vehicles (id, type, plate, created_at) values ('v1', 'tricycle', 'TG-1234', '${now}');
      insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at)
        values ('kofi', 'active', 'Kofi Mensah', 'ID123', 'LIC123', 'tricycle', 'v1', 'K1', '${now}');
    `);
    const d1 = env.DB;
    const trip = await tripStatement(d1, { driverId: "kofi", jobId: "job-1", distanceMeters: 12_500, stationId: "st", createdBy: "kofi" });
    await trip!.run();
    // The same trip again earns nothing.
    await (await tripStatement(d1, { driverId: "kofi", jobId: "job-1", distanceMeters: 12_500, stationId: "st", createdBy: "kofi" }))!.run();
    const view = await mine(env);
    expect(view.co2Grams).toBe(750);
    expect(view.points).toBe(0);
    expect(view.history[0]).toMatchObject({ kind: "delivery", vehicle: "tricycle" });
    expect(await tripStatement(d1, { driverId: "staff", jobId: "job-2", distanceMeters: 1000, stationId: null, createdBy: null })).toBeNull();
  });

  it("gives station staff no greenpoints: no balance, no rewards", async () => {
    const { env } = await setup();
    expect((await call(env, "staff", "GET", "/api/greenpoint")).status).toBe(403);
    expect((await call(env, "staff", "POST", "/api/greenpoint/redemptions", { rewardId: "x" })).status).toBe(403);
    expect((await call(env, "staff", "POST", "/api/greenpoint/vehicle", { vehicle: "moped" })).status).toBe(403);
    // Their customers' swaps still earn.
    expect((await counterSwap(env)).status).toBe(200);
    expect((await mine(env)).points).toBe(15);
  });
});
