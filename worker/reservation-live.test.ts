import { beforeAll, describe, expect, it } from "vitest";
import type { Reservation } from "../shared/types";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { clearEndedPositions } from "./reservations";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Live trip to a reserved station (migration 0068, UI batch 4): with the customer's consent
// their position reaches the station's list while the reservation holds, with their phone;
// the station marks it ready or offers another station. Runs the API on worker/test-d1.ts.

const OWN = "00000000-0000-4000-8000-000000000001";
const USERS = [
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const }, // staff at be
  { id: "ama", phone: "+22890000005", name: "Ama", role: "customer" as const },
  { id: "kofi", phone: "+22890000007", name: "Kofi", role: "customer" as const },
];

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin("2580");
});

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(u.id, u.phone, u.name, roleToDb(u.role), now, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, phone, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', '+22822000001', '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('be', 1, 0, 4, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
  `);
  return { db, env };
}

async function call<T = unknown>(env: Env, as: string, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer token-of-${as}-0123456789` },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T };
}

const staffList = async (env: Env) => (await call<Reservation[]>(env, "afi", "GET", "/api/stations/be/reservations")).body;
const mine = async (env: Env, as = "ama") => (await call<Reservation[]>(env, as, "GET", "/api/reservations/mine")).body;

describe("sharing the position during a reservation", () => {
  it("reaches the station only after the customer shares it, with their phone, and stops on request", async () => {
    const { env } = await setup();
    const r = (await call<Reservation>(env, "ama", "POST", "/api/reservations", { stationId: "be", kind: "swap" })).body;
    let [row] = await staffList(env);
    expect(row).toMatchObject({ id: r.id, customerPosition: null, customerPhone: null, readyAt: null, redirectedAt: null });
    expect((await mine(env))[0].sharing).toBe(false);

    expect((await call(env, "ama", "POST", `/api/reservations/${r.id}/position`, { lat: 6.123456789, lng: 1.2 })).status).toBe(200);
    [row] = await staffList(env);
    expect(row.customerPosition).toMatchObject({ lat: 6.12346, lng: 1.2 });
    expect(row.customerPhone).toBe("+22890000005");
    expect(row.pickupCode).toBeUndefined();
    expect((await mine(env))[0]).toMatchObject({ sharing: true });
    expect((await mine(env))[0].customerPosition).toBeUndefined();

    await call(env, "ama", "POST", `/api/reservations/${r.id}/position`, { stop: true });
    [row] = await staffList(env);
    expect(row).toMatchObject({ customerPosition: null, customerPhone: null });
  });

  it("takes one's own active reservation and a real position only", async () => {
    const { env } = await setup();
    const r = (await call<Reservation>(env, "ama", "POST", "/api/reservations", { stationId: "be", kind: "swap" })).body;
    expect((await call(env, "kofi", "POST", `/api/reservations/${r.id}/position`, { lat: 6.1, lng: 1.2 })).status).toBe(403);
    expect((await call(env, "ama", "POST", `/api/reservations/${r.id}/position`, { lat: 95, lng: 1.2 })).body).toEqual({ error: "invalid_position" });
    expect((await call(env, "ama", "POST", `/api/reservations/${r.id}/position`, { lat: "6.1", lng: 1.2 })).body).toEqual({ error: "invalid_position" });
    await call(env, "ama", "POST", `/api/reservations/${r.id}/cancel`);
    expect((await call(env, "ama", "POST", `/api/reservations/${r.id}/position`, { lat: 6.1, lng: 1.2 })).body).toEqual({ error: "reservation_not_active" });
  });

  it("is hidden once the reservation ends and cleared by the minute cron", async () => {
    const { env, db } = await setup();
    const r = (await call<Reservation>(env, "ama", "POST", "/api/reservations", { stationId: "be", kind: "swap" })).body;
    await call(env, "ama", "POST", `/api/reservations/${r.id}/position`, { lat: 6.1, lng: 1.2 });
    db.prepare("update reservations set expires_at = ? where id = ?").run(new Date(Date.now() - 1000).toISOString(), r.id);
    expect((await staffList(env))[0]).toMatchObject({ customerPosition: null, customerPhone: null });
    await clearEndedPositions(env.DB);
    expect(db.prepare("select share_lat, share_lng, share_at from reservations where id = ?").get(r.id)).toEqual({ share_lat: null, share_lng: null, share_at: null });
  });
});

describe("the station marks a reservation ready or offers another station", () => {
  it("sets the time, logs it, and refuses customers and ended reservations", async () => {
    const { env, db } = await setup();
    const r = (await call<Reservation>(env, "ama", "POST", "/api/reservations", { stationId: "be", kind: "swap" })).body;
    expect((await call(env, "kofi", "POST", `/api/reservations/${r.id}/ready`)).status).toBe(403);
    expect((await call(env, "afi", "POST", `/api/reservations/${r.id}/ready`)).status).toBe(200);
    expect((await call(env, "afi", "POST", `/api/reservations/${r.id}/redirect`)).status).toBe(200);
    const [row] = await staffList(env);
    expect(row.readyAt).toBeTruthy();
    expect(row.redirectedAt).toBeTruthy();
    expect((await mine(env))[0]).toMatchObject({ readyAt: row.readyAt, redirectedAt: row.redirectedAt });
    const audits = db.prepare("select changes from audit_log where table_name = 'reservations' and row_id = ? and action = 'update'").all(r.id) as { changes: string }[];
    expect(audits.map((a) => Object.keys(JSON.parse(a.changes))[0]).sort()).toEqual(["ready_at", "redirected_at"]);
    await call(env, "ama", "POST", `/api/reservations/${r.id}/cancel`);
    expect((await call(env, "afi", "POST", `/api/reservations/${r.id}/ready`)).body).toEqual({ error: "reservation_not_active" });
  });
});
