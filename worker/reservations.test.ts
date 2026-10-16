import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { SwapEntry } from "../src/lib/station-work";
import type { Reservation, StationView } from "../src/lib/types";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Reservation by type (plan phase 4, migration 0029): a swap reservation names a battery
// type with a free full battery, a charging reservation a free outlet or car charger; the
// staff complete it from the reservation list through the swap or the outlet start, once;
// wrong pickup codes lock the reservation after 5. Runs the API on worker/test-d1.ts.

const OWN = "00000000-0000-4000-8000-000000000001"; // poinderecharge, from 0001_init.sql
const PIN = "2580";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const }, // staff at be, solo
  { id: "efo", phone: "+22890000009", name: "Efo", role: "operator" as const }, // staff at ch, cnt
  { id: "ama", phone: "+22890000005", name: "Ama", role: "customer" as const },
  { id: "kofi", phone: "+22890000007", name: "Kofi", role: "customer" as const },
  { id: "yawa", phone: "+22890000008", name: "Yawa", role: "customer" as const },
  { id: "esi", phone: "+22890000010", name: "Esi", role: "customer" as const },
  { id: "edem", phone: "+22890000006", name: "Edem", role: "fleet_manager" as const },
];

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
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
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', 500, '${now}'),
      ('solo', '${OWN}', 'Solo', 6.15, 1.21, 'swap', 10, '00:00-24:00', 500, '${now}'),
      ('ch', '${OWN}', 'Charge', 6.14, 1.23, 'charging', 0, '00:00-24:00', null, '${now}'),
      ('cnt', '${OWN}', 'Compteur', 6.16, 1.24, 'charging', 0, '00:00-24:00', null, '${now}');
    insert into battery_types (id, brand, name, is_active, created_at) values
      ('spiro', 'Spiro', '72V', 1, '${now}'), ('ov', 'Omnivoltaic', '72V', 1, '${now}');
    insert into station_battery_types (station_id, battery_type_id, full_batteries) values ('be', 'spiro', 0), ('be', 'ov', 2);
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values
      ('be', 1, 0, 2, '${now}'), ('solo', 1, 0, 1, '${now}'), ('ch', 1, 0, 0, '${now}'), ('cnt', 1, 1, 0, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi'), ('ch', 'efo');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 2000, 'x', 'x');
    insert into devices (external_id, station_id, vendor, link, outlets, last_seen_at, created_at) values ('123456', 'ch', 'Xingke', 'own_server', 3, '${now}', '${now}');
    insert into charging_points (id, station_id, label, status, device_id, outlet, last_seen_at, created_at) values
      ('p1', 'ch', '3456-1', 'free', '123456', 1, '${now}', '${now}'),
      ('p2', 'ch', '3456-2', 'free', '123456', 2, '${now}', '${now}'),
      ('p3', 'ch', '3456-3', 'charging', '123456', 3, '${now}', '${now}');
    insert into ev_chargers (id, name, connector, power_kw, station_id, is_active, created_at) values ('ev1', 'Borne VE 1', 'type2', 22, 'ch', 1, '${now}');
  `);
  return { db, env };
}

let seq = 0;
const rid = () => `req-${String(++seq).padStart(8, "0")}`;

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

const reserve = (env: Env, as: string, body: Record<string, unknown>) => call<Reservation & { error?: string }>(env, as, "POST", "/api/reservations", body);
const swap = (env: Env, as: string, station: string, body: Record<string, unknown>) =>
  call<SwapEntry & { error?: string }>(env, as, "POST", `/api/stations/${station}/swaps`, { requestId: rid(), ...body });
const typeFull = (db: DatabaseSync, type: string) =>
  (db.prepare("select full_batteries as n from station_battery_types where station_id = 'be' and battery_type_id = ?").get(type) as { n: number }).n;
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const status = (db: DatabaseSync, id: string) => (db.prepare("select status from reservations where id = ?").get(id) as { status: string }).status;
const stationOf = async (env: Env, id: string) => (await call<StationView[]>(env, "ama", "GET", "/api/stations")).body.find((s) => s.id === id)!;

describe("swap reservations name an available battery type", () => {
  it("refuses a type the station has no free full battery of (the Spiro-where-only-Omnivoltaic case)", async () => {
    const { env } = await setup();
    expect((await reserve(env, "ama", { stationId: "be", kind: "swap" })).body).toEqual({ error: "battery_type_required" });
    expect((await reserve(env, "ama", { stationId: "be", kind: "swap", target: "spiro" })).body).toEqual({ error: "battery_type_unavailable" });
    expect((await reserve(env, "ama", { stationId: "be", kind: "swap", target: "nope" })).body).toEqual({ error: "battery_type_unavailable" });
    const ok = await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ kind: "swap", type: "battery", target: "ov", targetLabel: "Omnivoltaic 72V", targetKind: "battery_type" });
    expect(ok.body.pickupCode).toMatch(/^\d{4}$/);
  });

  it("counts holds per type, without touching the counter", async () => {
    const { env, db } = await setup();
    expect((await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" })).status).toBe(200);
    expect((await reserve(env, "kofi", { stationId: "be", type: "battery", target: "ov" })).status).toBe(200);
    expect((await reserve(env, "yawa", { stationId: "be", kind: "swap", target: "ov" })).body).toEqual({ error: "battery_type_unavailable" });
    // The counter still shows the 2 full batteries; the station list shows them held.
    expect(typeFull(db, "ov")).toBe(2);
    const be = await stationOf(env, "be");
    expect(be.reservedBatteries).toBe(2);
    expect(be.batteryTypes?.find((t) => t.id === "ov")).toMatchObject({ fullBatteries: 2, reserved: 2 });
    // A swap without reservation cannot take a held battery.
    expect((await swap(env, "afi", "be", { customerType: "cash", batteryTypeId: "ov", batteryIn: "OV-1", batteryOut: "OV-2" })).body).toEqual({ error: "battery_reserved" });
    expect(typeFull(db, "ov")).toBe(2);
  });

  it("takes the station's one type, or no type at a station without types (older type field)", async () => {
    const { env, db } = await setup();
    const r = await reserve(env, "ama", { stationId: "solo", type: "battery" });
    expect(r.body).toMatchObject({ kind: "swap", target: null });
    expect((await reserve(env, "kofi", { stationId: "solo", kind: "swap", target: "ov" })).body).toEqual({ error: "battery_type_unavailable" });
    expect((await reserve(env, "kofi", { stationId: "solo", kind: "swap" })).body).toEqual({ error: "none_available" });
    db.exec("delete from station_battery_types where battery_type_id = 'spiro'");
    expect((await reserve(env, "kofi", { stationId: "be", kind: "swap" })).body).toMatchObject({ target: "ov" });
  });

  it("is for riders only", async () => {
    const { env } = await setup();
    for (const who of ["afi", "edem", "admin"]) {
      expect((await reserve(env, who, { stationId: "be", kind: "swap", target: "ov" })).status).toBe(403);
    }
  });

  it("refuses services the station does not run (swap, motorbike outlets, car chargers)", async () => {
    const { env } = await setup();
    const lock = (stationId: string, service: string) => call(env, "admin", "POST", "/api/admin/station-services/set", { stationId, service, unlocked: false });
    expect((await lock("be", "swap")).status).toBe(200);
    expect((await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" })).body).toEqual({ error: "service_not_offered" });
    expect((await lock("ch", "ev")).status).toBe(200);
    expect((await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "ev1" })).body).toEqual({ error: "service_not_offered" });
    expect((await lock("ch", "charging")).status).toBe(200);
    expect((await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "p1" })).body).toEqual({ error: "service_not_offered" });
    expect((await lock("cnt", "charging")).status).toBe(200);
    expect((await reserve(env, "ama", { stationId: "cnt", kind: "charging_point" })).body).toEqual({ error: "service_not_offered" });
  });

  it("keeps the rules: one active, pause at a station after cancelling, 3 unused a day, expiry", async () => {
    const { env, db } = await setup();
    const r = (await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" })).body;
    expect((await reserve(env, "ama", { stationId: "solo", kind: "swap" })).body).toEqual({ error: "already_reserved" });
    expect((await call(env, "ama", "POST", `/api/reservations/${r.id}/cancel`)).status).toBe(200);
    expect((await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" })).body).toEqual({ error: "cooldown" });
    // Expired: frees the rider and the battery.
    const s = (await reserve(env, "ama", { stationId: "solo", kind: "swap" })).body;
    db.exec(`update reservations set expires_at = '2020-01-01T00:00:00.000Z' where id = '${s.id}'`);
    const c = (await reserve(env, "ama", { stationId: "cnt", kind: "charging_point" })).body;
    expect(c).toMatchObject({ kind: "charging_point", targetKind: "place" });
    expect((await call(env, "ama", "POST", `/api/reservations/${c.id}/cancel`)).status).toBe(200);
    expect((await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "p1" })).body).toEqual({ error: "daily_limit" });
  });
});

describe("charging reservations name a free outlet or car charger", () => {
  it("needs a free connected outlet where the station has them, and holds it", async () => {
    const { env, db } = await setup();
    expect((await reserve(env, "ama", { stationId: "ch", kind: "charging_point" })).body).toEqual({ error: "outlet_required" });
    expect((await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "p3" })).body).toEqual({ error: "outlet_busy" });
    const r = await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "p1" });
    expect(r.body).toMatchObject({ kind: "charging_point", type: "slot", target: "p1", targetLabel: "3456-1", targetKind: "outlet" });
    expect((await reserve(env, "kofi", { stationId: "ch", kind: "charging_point", target: "p1" })).body).toEqual({ error: "outlet_busy" });
    db.exec("update charging_points set last_seen_at = '2020-01-01T00:00:00.000Z' where id = 'p2'");
    expect((await reserve(env, "kofi", { stationId: "ch", kind: "charging_point", target: "p2" })).body).toEqual({ error: "outlet_busy" });
    expect((await reserve(env, "kofi", { stationId: "ch", kind: "charging_point", target: "zz" })).status).toBe(404);
    const ch = await stationOf(env, "ch");
    expect(ch.chargingPoints?.find((p) => p.id === "p1")?.reserved).toBe(true);
    expect(ch.reservedSlots).toBe(1);
  });

  it("holds a car charger by itself, apart from the outlets", async () => {
    const { env } = await setup();
    const r = await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "ev1" });
    expect(r.body).toMatchObject({ target: "ev1", targetLabel: "Borne VE 1", targetKind: "ev" });
    expect((await reserve(env, "kofi", { stationId: "ch", kind: "charging_point", target: "ev1" })).body).toEqual({ error: "outlet_busy" });
    const ch = await stationOf(env, "ch");
    expect(ch.evChargers?.[0].reserved).toBe(true);
    expect(ch.reservedSlots).toBe(0);
    expect((await reserve(env, "kofi", { stationId: "ch", kind: "charging_point", target: "p1" })).status).toBe(200);
  });

  it("keeps kind in step with type for rows the previous Worker writes", async () => {
    const { db } = await setup();
    db.exec(`insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code)
             values ('old', 'ama', 'cnt', 'slot', 'active', 'x', '2999-01-01T00:00:00.000Z', '1234')`);
    expect(db.prepare("select kind, target from reservations where id = 'old'").get()).toEqual({ kind: "charging_point", target: null });
  });
});

describe("staff jump from the reservation into the flow", () => {
  it("lists who reserved what for the staff, never the code", async () => {
    const { env } = await setup();
    await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" });
    const list = (await call<Reservation[]>(env, "afi", "GET", "/api/stations/be/reservations")).body;
    expect(list).toEqual([expect.objectContaining({ customer: "Ama", kind: "swap", target: "ov", targetLabel: "Omnivoltaic 72V" })]);
    expect(list[0].pickupCode).toBeUndefined();
    const mine = (await call<Reservation[]>(env, "ama", "GET", "/api/reservations/mine")).body;
    expect(mine[0]).toMatchObject({ kind: "swap", targetLabel: "Omnivoltaic 72V" });
    expect(mine[0].pickupCode).toMatch(/^\d{4}$/);
  });

  it("completes a swap reservation by its swap, exactly once, paid in the app", async () => {
    const { env, db } = await setup();
    const r = (await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" })).body;
    expect((await call(env, "afi", "POST", `/api/reservations/${r.id}/complete`, { pickupCode: r.pickupCode })).body).toEqual({ error: "swap_required" });
    const base = { customerType: "app", reservationId: r.id, pickupCode: r.pickupCode, pin: PIN, batteryIn: "OV-1", batteryOut: "OV-2" };
    expect((await swap(env, "afi", "be", { ...base, batteryTypeId: "spiro" })).body).toEqual({ error: "battery_type_mismatch" });
    expect((await swap(env, "afi", "solo", base)).status).toBe(403);
    const requestId = rid();
    const done = await swap(env, "afi", "be", { ...base, requestId });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ customer: "Ama", batteryTypeId: "ov", payment: "wallet", amountXof: 500, reservationId: r.id });
    expect(status(db, r.id)).toBe("completed");
    expect(typeFull(db, "ov")).toBe(1);
    // Repeating the same request returns the same swap; another one is refused.
    expect((await swap(env, "afi", "be", { ...base, requestId })).body.id).toBe(done.body.id);
    expect((await swap(env, "afi", "be", base)).body).toEqual({ error: "reservation_not_active" });
    expect(count(db, "select count(*) as n from swap_log")).toBe(1);
    expect(count(db, "select count(*) as n from battery_events where type = 'issue'")).toBe(1);
    expect(typeFull(db, "ov")).toBe(1);
    expect((db.prepare("select balance_xof from wallets where user_id = 'ama'").get() as { balance_xof: number }).balance_xof).toBe(1500);
  });

  it("completes an outlet reservation by starting the charge, on the outlet the staff choose", async () => {
    const { env, db } = await setup();
    const r = (await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "p1" })).body;
    const start = (pointId: string, pickupCode: string) =>
      call<{ customer?: string; pointLabel?: string; error?: string }>(env, "efo", "POST", "/api/stations/ch/charging", { pointId, reservationId: r.id, pickupCode });
    expect((await start("p2", "0000" === r.pickupCode ? "1111" : "0000")).body).toEqual({ error: "wrong_pickup_code" });
    const ok = await start("p2", r.pickupCode!);
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ customer: "Ama", pointLabel: "3456-2" });
    expect(db.prepare("select status, charging_point_id from reservations where id = ?").get(r.id)).toEqual({ status: "completed", charging_point_id: "p2" });
    expect((await start("p1", r.pickupCode!)).body).toEqual({ error: "reservation_not_active" });
    expect(count(db, "select count(*) as n from charging_sessions")).toBe(1);
  });

  it("completes a car charger or a counted place with the code; only the place comes off the count", async () => {
    const { env, db } = await setup();
    const ev = (await reserve(env, "ama", { stationId: "ch", kind: "charging_point", target: "ev1" })).body;
    expect((await call(env, "efo", "POST", "/api/stations/ch/charging", { pointId: "p1", reservationId: ev.id, pickupCode: ev.pickupCode })).status).toBe(403);
    expect((await call(env, "efo", "POST", `/api/reservations/${ev.id}/complete`, { pickupCode: ev.pickupCode })).status).toBe(200);
    expect(status(db, ev.id)).toBe("completed");
    db.exec("update station_staff set station_id = 'cnt' where user_id = 'afi'");
    const place = (await reserve(env, "kofi", { stationId: "cnt", kind: "charging_point" })).body;
    expect((await call(env, "admin", "POST", `/api/reservations/${place.id}/complete`, { pickupCode: place.pickupCode })).body).toEqual({ error: "active_station_required" });
    const done = await handleApi(
      new Request(`https://app.poinderecharge.com/api/reservations/${place.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer token-of-admin-0123456789", "X-Active-Station": "cnt" },
        body: JSON.stringify({ pickupCode: place.pickupCode }),
      }),
      env,
    );
    expect(done.status).toBe(200);
    expect(db.prepare("select free_slots from station_status where station_id = 'cnt'").get()).toEqual({ free_slots: 0 });
    expect((await call(env, "efo", "POST", `/api/reservations/${ev.id}/complete`, { pickupCode: ev.pickupCode })).body).toEqual({ error: "reservation_not_active" });
  });
});

describe("wrong pickup codes (as parcels)", () => {
  it("locks a reservation after 5 wrong codes, also for the right one", async () => {
    const { env, db } = await setup();
    const r = (await reserve(env, "ama", { stationId: "cnt", kind: "charging_point" })).body;
    // afi works at one station (W2), now this one; the active station goes along all the same.
    db.exec("update station_staff set station_id = 'cnt' where user_id = 'afi'");
    const complete = (code: string) =>
      handleApi(
        new Request(`https://app.poinderecharge.com/api/reservations/${r.id}/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer token-of-afi-0123456789", "X-Active-Station": "cnt" },
          body: JSON.stringify({ pickupCode: code }),
        }),
        env,
      ).then(async (res) => ({ status: res.status, body: await res.json() }));
    const wrong = r.pickupCode === "0000" ? "1111" : "0000";
    for (let i = 0; i < 5; i++) expect((await complete(wrong)).body).toEqual({ error: "wrong_pickup_code" });
    expect(await complete(r.pickupCode!)).toEqual({ status: 429, body: { error: "code_locked" } });
    expect(status(db, r.id)).toBe("active");
  });

  it("counts wrong codes typed in the swap form too", async () => {
    const { env, db } = await setup();
    const r = (await reserve(env, "ama", { stationId: "be", kind: "swap", target: "ov" })).body;
    const wrong = r.pickupCode === "0000" ? "1111" : "0000";
    for (let i = 0; i < 5; i++) {
      expect((await swap(env, "afi", "be", { customerType: "app", reservationId: r.id, pickupCode: wrong, payment: "cash" })).body).toEqual({ error: "wrong_pickup_code" });
    }
    expect((await swap(env, "afi", "be", { customerType: "app", reservationId: r.id, pickupCode: r.pickupCode, payment: "cash" })).status).toBe(429);
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
    expect(typeFull(db, "ov")).toBe(2);
  });
});
