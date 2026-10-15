import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { applyBatteryEvent, type BatteryEventView, type StationCounter, type SwapEntry } from "../src/lib/station-work";
import type { StationView } from "../src/lib/types";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { setLiteEnabled } from "./features";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Station work (plan phase 3): battery counter (W9, R3, R4, R5), swaps (W7, R6, R9, R10)
// and the active station (W3, W4, R7). Runs the API on the SQLite D1 of worker/test-d1.ts.

const OWN = "00000000-0000-4000-8000-000000000001"; // poinderecharge, from 0001_init.sql
const PARTNER = "op-partner";
const PIN = "2580";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "yao", phone: "+22890000002", name: "Yao", role: "operator" as const }, // owner of OWN (be, lome)
  { id: "kossi", phone: "+22890000003", name: "Kossi", role: "operator" as const }, // owner of PARTNER (kara)
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const }, // staff at be
  { id: "ama", phone: "+22890000005", name: "Ama", role: "customer" as const }, // rider with a wallet
  { id: "edem", phone: "+22890000006", name: "Edem", role: "fleet_manager" as const },
  { id: "kofi", phone: "+22890000007", name: "Kofi", role: "customer" as const }, // driver in Edem's fleet
  { id: "yawa", phone: "+22890000008", name: "Yawa", role: "customer" as const }, // driver without fleet
];
const KOFI_CODE = "ABCDEFGH";
const YAWA_CODE = "HGFEDCBA";

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
    insert into operators (id, name, is_own, created_at) values ('${PARTNER}', 'Kara Énergie', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}'), ('${PARTNER}', 'kossi', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', 500, '${now}'),
      ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'swap', 10, '00:00-24:00', 500, '${now}'),
      ('kara', '${PARTNER}', 'Kara', 9.55, 1.19, 'swap', 10, '00:00-24:00', 400, '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values
      ('be', 1, 0, 3, '${now}'), ('lome', 1, 0, 5, '${now}'), ('kara', 1, 0, 2, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 2000, 'x', 'x');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', '${KOFI_CODE}', '${now}'),
      ('yawa', 'active', 'Yawa', 'ID002', 'LIC002', 'moto', '${YAWA_CODE}', '${now}');
    insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${now}');
  `);
  return { db, env };
}

let seq = 0;
const rid = () => `req-${String(++seq).padStart(8, "0")}`;

async function call<T = unknown>(env: Env, as: string | null, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers.Authorization = `Bearer token-of-${as}-0123456789`;
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T };
}

const event = (env: Env, as: string, station: string, body: Record<string, unknown>, active?: string) =>
  call<BatteryEventView>(env, as, "POST", `/api/stations/${station}/battery-events`, { requestId: rid(), ...body }, active);
const swap = (env: Env, as: string, station: string, body: Record<string, unknown>, active?: string) =>
  call<SwapEntry>(env, as, "POST", `/api/stations/${station}/swaps`, { requestId: rid(), ...body }, active);
const counter = async (env: Env, station: string, as = "admin") => (await call<StationCounter>(env, as, "GET", `/api/stations/${station}/counter`)).body;
const full = (db: DatabaseSync, station: string) =>
  (db.prepare("select full_batteries from station_status where station_id = ?").get(station) as { full_batteries: number }).full_batteries;
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe("active station (W3, W4, R7)", () => {
  it("lets staff act at their one station, refuses other stations with 403", async () => {
    const { env } = await setup();
    expect((await event(env, "afi", "be", { type: "full" })).status).toBe(200);
    expect((await event(env, "afi", "lome", { type: "full" }, "lome")).status).toBe(403);
    expect((await event(env, "afi", "kara", { type: "full" })).status).toBe(403);
    // Staff sending another active station than the one they act at: 409.
    expect((await event(env, "afi", "be", { type: "full" }, "lome")).status).toBe(409);
  });

  it("needs the owner's active station on every action (409 without it), and only at own stations", async () => {
    const { env } = await setup();
    expect((await event(env, "yao", "be", { type: "full" })).body).toEqual({ error: "active_station_required" });
    expect((await event(env, "yao", "be", { type: "full" }, "lome")).status).toBe(409);
    const ok = await event(env, "yao", "be", { type: "full" }, "be");
    expect(ok.status).toBe(200);
    expect(ok.body.role).toBe("owner");
    expect((await event(env, "yao", "kara", { type: "full" }, "kara")).status).toBe(403);
    expect((await call(env, "yao", "PATCH", "/api/stations/be/status", { isOpen: false })).status).toBe(409);
    expect((await call(env, "yao", "PATCH", "/api/stations/be/status", { isOpen: false }, "be")).status).toBe(200);
  });

  it("lets an admin act at any station once chosen, logged as admin", async () => {
    const { env, db } = await setup();
    expect((await event(env, "admin", "kara", { type: "full" })).status).toBe(409);
    expect((await event(env, "admin", "kara", { type: "full" }, "kara")).body).toMatchObject({ role: "admin", person: "Admin" });
    const s = await swap(env, "admin", "kara", { customerType: "cash" }, "kara");
    expect(s.body).toMatchObject({ role: "admin", person: "Admin" });
    expect(db.prepare("select station_id, person_id, role from battery_events where swap_id = ?").all(s.body.id)).toEqual([
      { station_id: "kara", person_id: "admin", role: "admin" },
      { station_id: "kara", person_id: "admin", role: "admin" },
    ]);
  });

  it("gives staff several stations (older data) the same rule as owners", async () => {
    const { env, db } = await setup();
    db.exec("insert into station_staff (station_id, user_id) values ('lome', 'afi')");
    expect((await event(env, "afi", "be", { type: "full" })).status).toBe(409);
    expect((await event(env, "afi", "be", { type: "full" }, "be")).body).toMatchObject({ role: "staff" });
  });

  it("lists the stations with their active services and the person's role there", async () => {
    const { env } = await setup();
    const yao = (await call<StationView[]>(env, "yao", "GET", "/api/staff/stations")).body;
    expect(yao.map((s) => [s.id, s.myRole, s.activeServices])).toEqual([
      ["be", "owner", ["swap"]],
      ["lome", "owner", ["swap"]],
    ]);
    const afi = (await call<StationView[]>(env, "afi", "GET", "/api/staff/stations")).body;
    expect(afi.map((s) => [s.id, s.myRole])).toEqual([["be", "staff"]]);
  });
});

describe("battery counter (W9, R3, R4, R5)", () => {
  it("never goes below 0 (R4)", async () => {
    const { env, db } = await setup();
    for (let i = 0; i < 3; i++) expect((await event(env, "afi", "be", { type: "issue" })).status).toBe(200);
    expect((await event(env, "afi", "be", { type: "issue" })).body).toEqual({ error: "no_full_battery" });
    expect(full(db, "be")).toBe(0);
    expect((await event(env, "yao", "be", { type: "correction", delta: -1, reason: "inventaire" }, "be")).body).toEqual({ error: "no_full_battery" });
    expect((await swap(env, "afi", "be", { customerType: "cash" })).body).toEqual({ error: "no_full_battery" });
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
    expect(count(db, "select count(*) as n from battery_events where full_after < 0")).toBe(0);
  });

  it("counts a request id once, however often it is sent (R5)", async () => {
    const { env, db } = await setup();
    const body = { type: "full", requestId: "tap-00000001" };
    const a = await call<BatteryEventView>(env, "afi", "POST", "/api/stations/be/battery-events", body);
    const b = await call<BatteryEventView>(env, "afi", "POST", "/api/stations/be/battery-events", body);
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(full(db, "be")).toBe(4);
    const s1 = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: "swap-0000001", customerType: "cash" });
    const s2 = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: "swap-0000001", customerType: "cash" });
    expect(s2.body.id).toBe(s1.body.id);
    expect(full(db, "be")).toBe(3);
    expect(count(db, "select count(*) as n from swap_log")).toBe(1);
    // The same id at another station is a conflict, not a second change.
    expect((await call(env, "admin", "POST", "/api/stations/kara/battery-events", body, "kara")).status).toBe(409);
  });

  it("only moves by events: counter = start + full − issued ± corrections (R3, random sequences)", async () => {
    let random = 42;
    const next = () => (random = (random * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 5; run++) {
      const { env, db } = await setup();
      const start = full(db, "lome");
      let state = { full: start, empty: 0 };
      let fulls = 0;
      let issued = 0;
      let corrections = 0;
      for (let i = 0; i < 40; i++) {
        const r = next();
        const type = r < 0.4 ? "full" : r < 0.85 ? "issue" : "correction";
        const delta = type === "correction" ? Math.floor(next() * 7) - 3 || 1 : type === "issue" ? -1 : 1;
        const res = await event(env, "yao", "lome", { type, ...(type === "correction" ? { delta, reason: "inventaire" } : {}) }, "lome");
        const expected = applyBatteryEvent(state, type, delta, { total: state.full, capacity: 10 });
        expect(res.status === 200).toBe(expected !== null);
        if (!expected) continue;
        state = expected;
        if (type === "full") fulls++;
        else if (type === "issue") issued++;
        else corrections += delta;
      }
      expect(full(db, "lome")).toBe(start + fulls - issued + corrections);
      expect(full(db, "lome")).toBe(state.full);
      const sum = db.prepare("select coalesce(sum(delta), 0) as n from battery_events where station_id = 'lome' and type <> 'empty_in'").get() as { n: number };
      expect(start + sum.n).toBe(state.full);
      expect((await counter(env, "lome")).rows).toEqual([{ batteryTypeId: "", label: null, full: state.full, empty: 0 }]);
    }
  });

  it("keeps a full battery within capacity and moves it out of the charging stock", async () => {
    const { env, db } = await setup();
    await swap(env, "afi", "be", { customerType: "cash" });
    await swap(env, "afi", "be", { customerType: "cash" });
    expect((await counter(env, "be")).rows[0]).toMatchObject({ full: 1, empty: 2 });
    await event(env, "afi", "be", { type: "full" });
    expect((await counter(env, "be")).rows[0]).toMatchObject({ full: 2, empty: 1 });
    db.exec("update stations set battery_capacity = 2 where id = 'be'");
    expect((await event(env, "afi", "be", { type: "full" })).body).toEqual({ error: "counter_full" });
  });

  it("lets only the owner or an admin correct, always with a reason", async () => {
    const { env, db } = await setup();
    expect((await event(env, "afi", "be", { type: "correction", delta: 2, reason: "inventaire" })).status).toBe(403);
    expect((await event(env, "yao", "be", { type: "correction", delta: 2 }, "be")).body).toEqual({ error: "reason_required" });
    expect((await event(env, "yao", "be", { type: "correction", delta: 0, reason: "x" }, "be")).status).toBe(400);
    const ok = await event(env, "yao", "be", { type: "correction", delta: -2, reason: "défectueuse" }, "be");
    expect(ok.body).toMatchObject({ type: "correction", delta: -2, fullAfter: 1, reason: "défectueuse", role: "owner" });
    expect(full(db, "be")).toBe(1);
    expect((await counter(env, "be", "afi")).canCorrect).toBe(false);
    expect((await counter(env, "be", "yao")).canCorrect).toBe(true);
  });

  it("works per battery type and keeps the stock customers see in sync", async () => {
    const { env, db } = await setup();
    const now = new Date().toISOString();
    db.exec(`
      insert into battery_types (id, brand, name, created_at) values ('ov72', 'Omnivoltaic', '72 V', '${now}'), ('sp72', 'Spiro', '72 V', '${now}');
      insert into station_battery_types (station_id, battery_type_id, full_batteries) values ('be', 'ov72', 2), ('be', 'sp72', 1);
    `);
    expect((await event(env, "afi", "be", { type: "issue" })).body).toEqual({ error: "battery_type_required" });
    expect((await event(env, "afi", "be", { type: "issue", batteryTypeId: "nope" })).status).toBe(400);
    await event(env, "afi", "be", { type: "issue", batteryTypeId: "sp72" });
    await swap(env, "afi", "be", { customerType: "cash", batteryTypeId: "ov72" });
    expect((await counter(env, "be")).rows).toEqual([
      { batteryTypeId: "ov72", label: "Omnivoltaic 72 V", full: 1, empty: 1 },
      { batteryTypeId: "sp72", label: "Spiro 72 V", full: 0, empty: 0 },
    ]);
    expect(full(db, "be")).toBe(1);
    const be = (await call<StationView[]>(env, "ama", "GET", "/api/stations")).body.find((s) => s.id === "be")!;
    expect(be.status.fullBatteries).toBe(1);
    expect(be.batteryTypes!.map((t) => [t.id, t.fullBatteries])).toEqual([
      ["ov72", 1],
      ["sp72", 0],
    ]);
  });
});

describe("swaps (W7, R6, R9, R10)", () => {
  it("records one battery in and one out per swap, except a first purchase (R6)", async () => {
    const { env, db } = await setup();
    const s = await swap(env, "afi", "be", { customerType: "cash", batteryIn: "ov72-0193", batteryOut: "OV72-0071", amountXof: 450 });
    expect(s.body).toMatchObject({ customerType: "cash", batteryIn: "OV72-0193", batteryOut: "OV72-0071", payment: "cash", amountXof: 450, person: "Afi", role: "staff" });
    const first = await swap(env, "afi", "be", { customerType: "first_purchase", batteryIn: "X1", amountXof: 30000 });
    expect(first.body).toMatchObject({ customerType: "first_purchase", batteryIn: null });
    const events = (id: string) => (db.prepare("select type from battery_events where swap_id = ? order by type").all(id) as { type: string }[]).map((e) => e.type);
    expect(events(s.body.id)).toEqual(["empty_in", "issue"]);
    expect(events(first.body.id)).toEqual(["issue"]);
    // Every swap row has exactly one issue, and one empty_in unless it is a first purchase.
    expect(
      count(
        db,
        `select count(*) as n from swap_log l where (select count(*) from battery_events e where e.swap_id = l.id and e.type = 'issue') <> 1
           or (select count(*) from battery_events e where e.swap_id = l.id and e.type = 'empty_in') <> l.has_battery_in`,
      ),
    ).toBe(0);
    expect((await counter(env, "be")).rows[0]).toMatchObject({ full: 1, empty: 1 });
    expect((await swap(env, "afi", "be", { customerType: "cash", batteryIn: "A1", batteryOut: "a1" })).body).toEqual({ error: "same_battery" });
  });

  it("takes an app customer's swap price from the wallet with their PIN", async () => {
    const { env, db } = await setup();
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005", pin: "1111" })).body).toEqual({ error: "invalid_pin" });
    const ok = await swap(env, "afi", "be", { customerType: "app", contact: "poinderecharge:id:+22890000005", pin: PIN });
    expect(ok.body).toMatchObject({ customerType: "app", customer: "Ama", payment: "wallet", amountXof: 500 });
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 1500 });
    expect(db.prepare("select type, amount_xof, counterparty_label from wallet_transactions").all()).toEqual([{ type: "charge", amount_xof: 500, counterparty_label: "Bè" }]);
    // Cash is fine for an app customer too; staff, drivers' managers and unknown numbers are not customers.
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005", payment: "cash" })).body).toMatchObject({ payment: "cash", amountXof: 500 });
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000006", pin: PIN })).body).toEqual({ error: "not_a_customer" });
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000004", pin: PIN })).body).toEqual({ error: "own_reservation" });
    // App payments only at our own stations, as for charges.
    expect((await swap(env, "kossi", "kara", { customerType: "app", contact: "90000005", pin: PIN }, "kara")).body).toEqual({ error: "payment_not_offered" });
  });

  it("refuses a wallet swap the balance cannot pay, and takes nothing", async () => {
    const { env, db } = await setup();
    db.exec("update wallets set balance_xof = 100 where user_id = 'ama'");
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005", pin: PIN })).body).toEqual({ error: "insufficient_balance" });
    expect(full(db, "be")).toBe(3);
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
  });

  it("bills a fleet swap to the fleet of a valid driver QR only (R10)", async () => {
    const { env, db } = await setup();
    const ok = await swap(env, "afi", "be", { customerType: "fleet", driverCode: `POINDERECHARGE-CHAUFFEUR:${KOFI_CODE}` });
    expect(ok.body).toMatchObject({ customerType: "fleet", payment: "fleet", amountXof: 500, driver: "Kofi" });
    expect(db.prepare("select fleet_manager_id from swap_log").get()).toEqual({ fleet_manager_id: "edem" });
    expect((await swap(env, "afi", "be", { customerType: "fleet", driverCode: YAWA_CODE })).body).toEqual({ error: "wrong_fleet" });
    expect((await swap(env, "afi", "be", { customerType: "fleet", driverCode: "ZZZZZZZZ" })).status).toBe(404);
    db.exec("update drivers set status = 'suspended' where user_id = 'kofi'");
    expect((await swap(env, "afi", "be", { customerType: "fleet", driverCode: KOFI_CODE })).body).toEqual({ error: "driver_not_found" });
  });

  it("takes only cash in the Lite version (W8, R9)", async () => {
    const { env } = await setup();
    await setLiteEnabled(env, { id: "admin", phone: null, email: null, fullName: null, role: "admin" }, true);
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005", pin: PIN })).body).toEqual({ error: "cash_only" });
    expect((await swap(env, "afi", "be", { customerType: "fleet", driverCode: KOFI_CODE })).body).toEqual({ error: "cash_only" });
    expect((await swap(env, "afi", "be", { customerType: "cash" })).status).toBe(200);
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005", payment: "cash" })).status).toBe(200);
  });

  it("works only while the station runs the swap service", async () => {
    const { env } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/station-services/set", { stationId: "be", service: "swap", unlocked: false })).status).toBe(200);
    expect((await swap(env, "afi", "be", { customerType: "cash" })).body).toEqual({ error: "service_not_offered" });
    expect((await event(env, "afi", "be", { type: "full" })).body).toEqual({ error: "service_not_offered" });
    expect((await call(env, "afi", "GET", "/api/stations/be/counter")).body).toEqual({ error: "service_not_offered" });
    expect((await call<StationView[]>(env, "afi", "GET", "/api/staff/stations")).body[0].activeServices).toEqual([]);
  });

  it("lists today's swaps of the station with a filter; staff only see their own", async () => {
    const { env } = await setup();
    await swap(env, "afi", "be", { customerType: "cash" });
    await swap(env, "yao", "be", { customerType: "fleet", driverCode: KOFI_CODE }, "be");
    const all = (await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps")).body;
    expect(all.map((s) => s.customerType).sort()).toEqual(["cash", "fleet"]);
    expect((await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps?customerType=fleet")).body.map((s) => s.customerType)).toEqual(["fleet"]);
    expect((await call<SwapEntry[]>(env, "afi", "GET", "/api/stations/be/swaps")).body.map((s) => s.person)).toEqual(["Afi"]);
  });
});

describe("role matrix of the station work routes (R2)", () => {
  const routes = [
    { name: "counter", method: "GET", path: "/api/stations/be/counter", body: undefined },
    { name: "full", method: "POST", path: "/api/stations/be/battery-events", body: () => ({ type: "full", requestId: rid() }) },
    { name: "issue", method: "POST", path: "/api/stations/be/battery-events", body: () => ({ type: "issue", requestId: rid() }) },
    { name: "correction", method: "POST", path: "/api/stations/be/battery-events", body: () => ({ type: "correction", delta: 1, reason: "inventaire", requestId: rid() }) },
    { name: "swap", method: "POST", path: "/api/stations/be/swaps", body: () => ({ customerType: "cash", requestId: rid() }) },
    { name: "swap log", method: "GET", path: "/api/stations/be/swaps", body: undefined },
    { name: "open/close", method: "PATCH", path: "/api/stations/be/status", body: () => ({ isOpen: true }) },
  ];
  // Expected status per role, each sending "be" as its active station.
  const expected: Record<string, Record<string, number>> = {
    admin: { counter: 200, full: 200, issue: 200, correction: 200, swap: 200, "swap log": 200, "open/close": 200 },
    yao: { counter: 200, full: 200, issue: 200, correction: 200, swap: 200, "swap log": 200, "open/close": 200 }, // owner
    afi: { counter: 200, full: 200, issue: 200, correction: 403, swap: 200, "swap log": 200, "open/close": 200 }, // staff
    kossi: { counter: 403, full: 403, issue: 403, correction: 403, swap: 403, "swap log": 403, "open/close": 403 }, // owner elsewhere
    ama: { counter: 403, full: 403, issue: 403, correction: 403, swap: 403, "swap log": 403, "open/close": 403 }, // rider
    edem: { counter: 403, full: 403, issue: 403, correction: 403, swap: 403, "swap log": 403, "open/close": 403 }, // fleet manager
  };
  for (const [who, row] of Object.entries(expected)) {
    it(`${who}`, async () => {
      const { env } = await setup();
      for (const r of routes) {
        const res = await call(env, who, r.method, r.path, r.body?.(), "be");
        expect([r.name, res.status]).toEqual([r.name, row[r.name]]);
      }
    });
  }
  it("nobody signed in", async () => {
    const { env } = await setup();
    for (const r of routes) expect((await call(env, null, r.method, r.path, r.body?.(), "be")).status).toBe(401);
  });
});
