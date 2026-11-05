import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import { DRIVER_PASS_MINUTES, signDriverPass, type DriverPass } from "../shared/drivers";
import { applyBatteryEvent, type BatteryEventView, type StationCounter, type SwapEntry } from "../shared/station-work";
import type { StationView } from "../shared/types";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { passSecret } from "./drivers";
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
  { id: "kofi", phone: "+22890000007", name: "Kofi", role: "driver" as const }, // driver in Edem's fleet
  { id: "yawa", phone: "+22890000008", name: "Yawa", role: "driver" as const }, // driver without fleet
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
    update stations set green_credit = 1 where id in ('be', 'kara');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 2000, 'x', 'x');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', '${KOFI_CODE}', '${now}'),
      ('yawa', 'active', 'Yawa', 'ID002', 'LIC002', 'moto', '${YAWA_CODE}', '${now}');
    insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${now}');
  `);
  return { db, env };
}

/** The signed QR the driver's app shows (GET /api/driver/pass). */
async function pass(env: Env, driver: string): Promise<string> {
  return (await call<DriverPass>(env, driver, "GET", "/api/driver/pass")).body.payload;
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
/** The one-time Green Credit code the customer's app shows after they typed their PIN (0047). */
const creditCode = async (env: Env, as: string, pin = PIN) => (await call<{ code: string }>(env, as, "POST", "/api/wallet/code", { pin })).body.code;
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

  it("keeps staff at one station (W2): a second assignment breaks the unique index", async () => {
    const { env, db } = await setup();
    expect(() => db.exec("insert into station_staff (station_id, user_id) values ('lome', 'afi')")).toThrow(/UNIQUE/);
    expect((await event(env, "afi", "be", { type: "full" })).body).toMatchObject({ role: "staff" });
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
      expect((await counter(env, "lome")).rows).toEqual([{ batteryTypeId: "", label: null, full: state.full, empty: 0, capacity: 10 }]);
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
    await swap(env, "afi", "be", { customerType: "cash", batteryTypeId: "ov72", batteryIn: "OV-1", batteryOut: "OV-2" });
    // A station with battery types registers every battery it swaps (0041).
    expect((await swap(env, "afi", "be", { customerType: "cash", batteryTypeId: "ov72" })).body).toEqual({ error: "battery_number_required" });
    expect((await counter(env, "be")).rows).toEqual([
      { batteryTypeId: "ov72", label: "Omnivoltaic 72 V", full: 1, empty: 1, capacity: 0, energy: null },
      { batteryTypeId: "sp72", label: "Spiro 72 V", full: 0, empty: 0, capacity: 0, energy: null },
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

describe("places per battery type (0064)", () => {
  async function typedStation(db: DatabaseSync) {
    const now = new Date().toISOString();
    db.exec(`
      insert into battery_types (id, brand, name, created_at) values ('ov60', 'Omnivoltaic', '60 V', '${now}'), ('ov72', 'Omnivoltaic', '72 V', '${now}');
      insert into station_battery_types (station_id, battery_type_id, full_batteries, capacity) values ('be', 'ov60', 2, 3), ('be', 'ov72', 1, 0);
    `);
  }

  it("keeps a type within its own places, a type without places within the station's", async () => {
    const { env, db } = await setup();
    await typedStation(db);
    expect((await counter(env, "be")).rows.map((r) => [r.batteryTypeId, r.full, r.capacity])).toEqual([
      ["ov60", 2, 3],
      ["ov72", 1, 0],
    ]);
    expect((await event(env, "afi", "be", { type: "full", batteryTypeId: "ov60" })).status).toBe(200);
    expect((await event(env, "afi", "be", { type: "full", batteryTypeId: "ov60" })).body).toEqual({ error: "counter_full" });
    // The other type has no places of its own: the station's 10 count all its batteries (3 + 1 now).
    for (let i = 0; i < 6; i++) expect((await event(env, "afi", "be", { type: "full", batteryTypeId: "ov72" })).status).toBe(200);
    expect((await event(env, "afi", "be", { type: "full", batteryTypeId: "ov72" })).body).toEqual({ error: "counter_full" });
    expect(full(db, "be")).toBe(10);
  });
});

describe("swaps priced by energy (Omnivoltaic, 0065)", () => {
  const USSD = { ussdTmoney: "*145*5*{montant}*1088722#", ussdFlooz: "*155*2*2*22879392818*22879392818*{montant}#" };

  /** Bè swaps Omnivoltaic 30 Ah and 45 Ah, priced by energy through the admin route, and Spiro at the station's price. */
  async function energyStation(env: Env, db: DatabaseSync) {
    const now = new Date().toISOString();
    db.exec(`
      insert into battery_types (id, brand, name, created_at) values
        ('ov30', 'Omnivoltaic', '30 Ah', '${now}'), ('ov45', 'Omnivoltaic', '45 Ah', '${now}'), ('sp72', 'Spiro', '72 V', '${now}');
      insert into station_battery_types (station_id, battery_type_id, full_batteries) values ('be', 'ov30', 3), ('be', 'ov45', 2), ('be', 'sp72', 2);
    `);
    for (const [id, name, price] of [["ov30", "30 Ah", 900], ["ov45", "45 Ah", 1200]] as const) {
      const saved = await call(env, "admin", "POST", "/api/admin/battery-types", { id, input: { brand: "Omnivoltaic", name, isActive: true, pricing: "energy", priceFullXof: price, ...USSD } });
      expect(saved.status).toBe(200);
    }
  }

  const walkIn = (extra: Record<string, unknown> = {}) => ({
    customerType: "cash",
    batteryTypeId: "ov30",
    batteryIn: "OV30-0001",
    batteryOut: "OV30-0002",
    inPct: 20,
    outPct: 100,
    plate: " tg 1234 ab ",
    batteryInCondition: "ok",
    batteryOutChecked: true,
    mmNetwork: "tmoney",
    mmRef: "tm 2611 0212 34",
    ...extra,
  });

  it("charges (% OUT − % IN) × the price for 100 %, paid by Mobile Money with its transaction id", async () => {
    const { env, db } = await setup();
    await energyStation(env, db);
    const rows = (await counter(env, "be")).rows;
    expect(rows.find((r) => r.batteryTypeId === "ov30")?.energy).toEqual({ priceFullXof: 900, ussd: { tmoney: USSD.ussdTmoney, flooz: USSD.ussdFlooz } });
    expect(rows.find((r) => r.batteryTypeId === "sp72")?.energy).toBeNull();
    // The procedure's examples: 30 Ah 20 % → 100 % = 720 F; 45 Ah 35 % → 100 % = 780 F.
    const a = await swap(env, "afi", "be", walkIn({ customerName: "Koffi" }));
    expect(a.body).toMatchObject({ payment: "mobile_money", amountXof: 720, inPct: 20, outPct: 100, plate: "TG 1234 AB", customerName: "Koffi", mmNetwork: "tmoney", mmRef: "TM2611021234" });
    const b = await swap(env, "afi", "be", walkIn({ batteryTypeId: "ov45", batteryIn: "OV45-1", batteryOut: "OV45-2", inPct: 35, mmNetwork: "flooz", mmRef: "FL-778899" }));
    expect(b.body).toMatchObject({ payment: "mobile_money", amountXof: 780 });
    // Rounded to the nearest 5 F: 33 % × 1 200 = 396 → 395.
    const c = await swap(env, "afi", "be", walkIn({ batteryTypeId: "ov45", batteryIn: "OV45-3", batteryOut: "OV45-4", inPct: 50, outPct: 83, mmRef: "TM-000003" }));
    expect(c.body).toMatchObject({ amountXof: 395 });
    // An app customer pays by Mobile Money too, never from Green Credit.
    const d = await swap(env, "afi", "be", walkIn({ customerType: "app", contact: "90000005", payment: "wallet", batteryIn: "OV30-3", batteryOut: "OV30-4", mmRef: "TM-000004" }));
    expect(d.body).toMatchObject({ customer: "Ama", payment: "mobile_money", amountXof: 720 });
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 2000 });
    // The other types keep the station's price.
    expect((await swap(env, "afi", "be", { customerType: "cash", batteryTypeId: "sp72", batteryIn: "SP-1", batteryOut: "SP-2" })).body).toMatchObject({ payment: "cash", amountXof: 500 });
    // Mobile Money goes to the brand: only the Spiro swap is cash at the station.
    const cash = await call<{ dueXof: number }>(env, "afi", "GET", "/api/stations/be/cash", undefined, "be");
    expect(cash.body).toMatchObject({ dueXof: 500 });
  });

  it("refuses a swap the procedure says to check first, and records nothing", async () => {
    const { env, db } = await setup();
    await energyStation(env, db);
    const refused = async (extra: Record<string, unknown>) => (await swap(env, "afi", "be", walkIn(extra))).body;
    expect(await refused({ outPct: 20 })).toEqual({ error: "energy_out_not_above_in" });
    expect(await refused({ inPct: 90, outPct: 80 })).toEqual({ error: "energy_out_not_above_in" });
    expect(await refused({ inPct: null })).toEqual({ error: "energy_pct_required" });
    expect(await refused({ outPct: 101 })).toEqual({ error: "energy_pct_required" });
    expect(await refused({ plate: "" })).toEqual({ error: "plate_required" });
    expect(await refused({ batteryInCondition: null })).toEqual({ error: "battery_condition_required" });
    expect(await refused({ batteryOutChecked: false })).toEqual({ error: "battery_out_check_required" });
    expect(await refused({ mmRef: "" })).toEqual({ error: "mm_ref_required" });
    expect(await refused({ mmNetwork: "orange" })).toEqual({ error: "mm_network_invalid" });
    expect(await refused({ customerType: "first_purchase", batteryIn: null })).toEqual({ error: "energy_customer_type" });
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
    // One transaction id pays one swap.
    expect((await swap(env, "afi", "be", walkIn())).status).toBe(200);
    expect(await refused({ batteryIn: "OV30-5", batteryOut: "OV30-6", mmRef: "TM261102 1234" })).toEqual({ error: "mm_ref_used" });
    // The same id on the other network is another transaction.
    expect((await swap(env, "afi", "be", walkIn({ batteryIn: "OV30-5", batteryOut: "OV30-6", mmNetwork: "flooz" }))).body).toMatchObject({ amountXof: 720 });
    expect(() => db.prepare("insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, payment, staff_id, role, created_at) values ('x', 'req-x-000000', 'be', 1, 'cash', 'mobile_money', 'afi', 'staff', 'x')").run()).toThrow(/CHECK/);
  });

  it("puts a battery brought back damaged in repair, and never hands it out", async () => {
    const { env, db } = await setup();
    await energyStation(env, db);
    expect((await swap(env, "afi", "be", walkIn({ batteryIn: "OV30-HOT", batteryInCondition: "hot" }))).status).toBe(200);
    expect(db.prepare("select status from batteries where serial = 'OV30-HOT'").get()).toEqual({ status: "repair" });
    expect(db.prepare("select h.type, h.status, h.reason from battery_history h join batteries b on b.id = h.battery_id where b.serial = 'OV30-HOT' order by h.type").all()).toEqual([
      { type: "added_at_swap", status: null, reason: null },
      { type: "in", status: null, reason: null },
      { type: "status", status: "repair", reason: "Swap : rendue anormalement chaude" },
    ]);
    expect((await swap(env, "afi", "be", walkIn({ batteryIn: "OV30-7", batteryOut: "OV30-HOT", mmRef: "TM-000009" }))).body).toEqual({ error: "battery_out_not_in_service" });
  });

  it("lets only an admin set a type's price by energy, with a price and a USSD code", async () => {
    const { env, db } = await setup();
    await energyStation(env, db);
    const save = (as: string, input: Record<string, unknown>) => call(env, as, "POST", "/api/admin/battery-types", { id: "ov30", input: { brand: "Omnivoltaic", name: "30 Ah", isActive: true, ...input } });
    expect((await save("yao", { pricing: "energy", priceFullXof: 1, ...USSD })).status).toBe(403);
    expect((await save("admin", { pricing: "energy", priceFullXof: null, ...USSD })).body).toEqual({ error: "energy_price_required" });
    expect((await save("admin", { pricing: "energy", priceFullXof: 900, ussdTmoney: "*145*5*1088722#", ussdFlooz: "" })).body).toEqual({ error: "invalid_ussd" });
    expect((await save("admin", { pricing: "energy", priceFullXof: 900, ussdTmoney: "", ussdFlooz: "" })).body).toEqual({ error: "ussd_required" });
    // Only T-Money offered: Flooz is refused at the counter.
    expect((await save("admin", { pricing: "energy", priceFullXof: 950, ussdTmoney: USSD.ussdTmoney, ussdFlooz: "" })).status).toBe(200);
    expect((await swap(env, "afi", "be", walkIn({ mmNetwork: "flooz" }))).body).toEqual({ error: "mm_network_invalid" });
    expect((await swap(env, "afi", "be", walkIn())).body).toMatchObject({ amountXof: 760 });
    // A save without pricing keeps it; back to the station's price clears it.
    expect((await save("admin", { isActive: true })).status).toBe(200);
    expect(db.prepare("select pricing, price_full_xof from battery_types where id = 'ov30'").get()).toEqual({ pricing: "energy", price_full_xof: 950 });
    expect((await save("admin", { pricing: "station" })).status).toBe(200);
    expect(db.prepare("select pricing, price_full_xof, ussd_tmoney from battery_types where id = 'ov30'").get()).toEqual({ pricing: "station", price_full_xof: null, ussd_tmoney: null });
    expect(db.prepare("select changes from audit_log where table_name = 'battery_types' and changes like '%950%'").all()).toHaveLength(2);
  });
});

describe("swaps (W7, R6, R9, R10)", () => {
  it("records one battery in and one out per swap, except a first purchase (R6)", async () => {
    const { env, db } = await setup();
    const s = await swap(env, "afi", "be", { customerType: "cash", batteryIn: "ov72-0193", batteryOut: "OV72-0071", amountXof: 450 });
    // The swap costs the station's price from the backoffice, whatever amount the form sends.
    expect(s.body).toMatchObject({ customerType: "cash", batteryIn: "OV72-0193", batteryOut: "OV72-0071", payment: "cash", amountXof: 500, person: "Afi", role: "staff" });
    const first = await swap(env, "afi", "be", { customerType: "first_purchase", batteryIn: "X1", amountXof: 30000 });
    expect(first.body).toMatchObject({ customerType: "first_purchase", batteryIn: null, amountXof: 30000 });
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

  it("takes an app customer's swap price from Green Credit with the code their phone shows", async () => {
    const { env, db } = await setup();
    // The PIN is typed on the customer's own phone; a wrong one gives no code.
    expect((await call(env, "ama", "POST", "/api/wallet/code", { pin: "1111" })).body).toEqual({ error: "invalid_pin" });
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005" })).body).toEqual({ error: "credit_code_invalid" });
    const ok = await swap(env, "afi", "be", { customerType: "app", creditCode: await creditCode(env, "ama") });
    expect(ok.body).toMatchObject({ customerType: "app", customer: "Ama", payment: "wallet", amountXof: 500 });
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 1500 });
    expect(db.prepare("select type, amount_xof, counterparty_label from wallet_transactions").all()).toEqual([{ type: "charge", amount_xof: 500, counterparty_label: "Bè" }]);
    // Cash is fine for an app customer too; staff, drivers' managers and unknown numbers are not customers.
    expect((await swap(env, "afi", "be", { customerType: "app", contact: "90000005", payment: "cash" })).body).toMatchObject({ payment: "cash", amountXof: 500 });
    // Staff have no Green Credit of their own: only customers get a code.
    expect((await call(env, "afi", "POST", "/api/wallet/code", { pin: PIN })).status).toBe(403);
    // App payments only where the swap is ours, as for charges, even at a Green Credit station.
    expect((await swap(env, "kossi", "kara", { customerType: "app", creditCode: await creditCode(env, "ama") }, "kara")).body).toEqual({ error: "payment_not_offered" });
  });

  it("uses a counter code once, and only at a Green Credit station", async () => {
    const { env, db } = await setup();
    const code = await creditCode(env, "ama");
    // Without a reservation the code may come in the contact field (the scanned QR).
    expect((await swap(env, "afi", "be", { customerType: "app", contact: `GC-${code}` })).body).toMatchObject({ payment: "wallet", amountXof: 500 });
    expect((await swap(env, "afi", "be", { customerType: "app", creditCode: code })).body).toEqual({ error: "credit_code_invalid" });
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 1500 });
    // Lomé is ours but not designated for Green Credit: the code stays open for elsewhere.
    const next = await creditCode(env, "ama");
    expect((await swap(env, "yao", "lome", { customerType: "app", creditCode: next }, "lome")).body).toEqual({ error: "credit_not_accepted" });
    expect(db.prepare("select used_at from credit_codes where used_at is null").all()).toHaveLength(1);
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 1500 });
  });

  it("refuses a cash swap at a station without a swap price, but not a first purchase", async () => {
    const { env, db } = await setup();
    db.prepare("update stations set price_battery_xof = null where id = 'be'").run();
    expect((await swap(env, "afi", "be", { customerType: "cash", batteryIn: "A1", batteryOut: "A2", amountXof: 450 })).body).toEqual({ error: "swap_price_missing" });
    expect((await swap(env, "afi", "be", { customerType: "first_purchase", batteryIn: "X1", amountXof: 30000 })).body).toMatchObject({ payment: "cash", amountXof: 30000 });
  });

  it("refuses a wallet swap the balance cannot pay, and takes nothing", async () => {
    const { env, db } = await setup();
    db.exec("update wallets set balance_xof = 100 where user_id = 'ama'");
    expect((await swap(env, "afi", "be", { customerType: "app", creditCode: await creditCode(env, "ama") })).body).toEqual({ error: "insufficient_balance" });
    expect(full(db, "be")).toBe(3);
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
  });

  it("bills a fleet swap to the fleet of a valid driver QR only (R10)", async () => {
    const { env, db } = await setup();
    const kofi = await pass(env, "kofi");
    const ok = await swap(env, "afi", "be", { customerType: "fleet", driverCode: kofi });
    expect(ok.body).toMatchObject({ customerType: "fleet", payment: "fleet", amountXof: 500, driver: "Kofi" });
    expect(db.prepare("select fleet_manager_id from swap_log").get()).toEqual({ fleet_manager_id: "edem" });
    const refused = async (driverCode: string) => (await swap(env, "afi", "be", { customerType: "fleet", driverCode })).body;
    // The typed code or the old static QR are not enough: the swap is billed to the fleet.
    expect(await refused(KOFI_CODE)).toEqual({ error: "driver_pass_invalid" });
    expect(await refused(`POINDERECHARGE-CHAUFFEUR:${KOFI_CODE}`)).toEqual({ error: "driver_pass_invalid" });
    // Tampered: another driver's code under Kofi's signature, or a later expiry.
    expect(await refused(kofi.replace(KOFI_CODE, YAWA_CODE))).toEqual({ error: "driver_pass_invalid" });
    const parts = kofi.split(":");
    expect(await refused([...parts.slice(0, 3), (parseInt(parts[3], 36) + 3600).toString(36).toUpperCase(), parts[4]].join(":"))).toEqual({
      error: "driver_pass_invalid",
    });
    // Expired.
    const old = await signDriverPass(await passSecret(env.DB), KOFI_CODE, "edem", Date.now() - (DRIVER_PASS_MINUTES + 1) * 60_000);
    expect(await refused(old.payload)).toEqual({ error: "driver_pass_expired" });
    // A driver without a fleet.
    expect(await refused(await pass(env, "yawa"))).toEqual({ error: "wrong_fleet" });
    // Moved to another fleet since the pass was made, then removed from it.
    db.exec("update fleet_manager_drivers set manager_id = 'yao' where driver_id = 'kofi'");
    expect(await refused(kofi)).toEqual({ error: "wrong_fleet" });
    db.exec("delete from fleet_manager_drivers where driver_id = 'kofi'");
    expect(await refused(kofi)).toEqual({ error: "wrong_fleet" });
    db.exec("insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', 'x')");
    expect((await swap(env, "afi", "be", { customerType: "fleet", driverCode: kofi })).status).toBe(200);
    // Suspended, or not a driver account any more.
    db.exec("update drivers set status = 'suspended' where user_id = 'kofi'");
    expect(await refused(kofi)).toEqual({ error: "driver_not_found" });
    db.exec("update drivers set status = 'active' where user_id = 'kofi'; update users set role = 'rider' where id = 'kofi'");
    expect(await refused(kofi)).toEqual({ error: "driver_not_found" });
    expect(count(db, "select count(*) as n from swap_log")).toBe(2);
  });

  it("gives the driver pass to active drivers only", async () => {
    const { env, db } = await setup();
    const res = await call<DriverPass>(env, "kofi", "GET", "/api/driver/pass");
    expect(res.status).toBe(200);
    expect(res.body.payload).toMatch(new RegExp(`^POINDERECHARGE-CHAUFFEUR:${KOFI_CODE}:`));
    expect(new Date(res.body.expiresAt).getTime() - Date.now()).toBeGreaterThan((DRIVER_PASS_MINUTES - 1) * 60_000);
    for (const as of ["ama", "afi", "edem", "admin"]) expect((await call(env, as, "GET", "/api/driver/pass")).status).toBe(403);
    db.exec("update drivers set status = 'suspended' where user_id = 'kofi'");
    expect((await call(env, "kofi", "GET", "/api/driver/pass")).status).toBe(403);
  });

  it("takes no fleet swaps in the Lite version, but cash and Green Credit (W8, R9)", async () => {
    const { env } = await setup();
    await setLiteEnabled(env, { id: "admin", phone: null, email: null, fullName: null, role: "admin" }, true);
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
    await swap(env, "yao", "be", { customerType: "fleet", driverCode: await pass(env, "kofi") }, "be");
    const all = (await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps")).body;
    expect(all.map((s) => s.customerType).sort()).toEqual(["cash", "fleet"]);
    expect((await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps?customerType=fleet")).body.map((s) => s.customerType)).toEqual(["fleet"]);
    expect((await call<SwapEntry[]>(env, "afi", "GET", "/api/stations/be/swaps")).body.map((s) => s.person)).toEqual(["Afi"]);
  });

  it("reads a range of days for the swap sheet: owners and admins only, valid dates only", async () => {
    const { env, db } = await setup();
    const old = await swap(env, "afi", "be", { customerType: "cash" });
    await swap(env, "afi", "be", { customerType: "cash" });
    const day = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
    db.prepare("update swap_log set created_at = ? where id = ?").run(`${day(3)}T09:15:00.000Z`, (old.body as SwapEntry).id);
    const list = async (as: string, q: string) => (await call<SwapEntry[] & { error?: string }>(env, as, "GET", `/api/stations/be/swaps?${q}`)).body;
    expect((await list("yao", `from=${day(3)}&to=${day(3)}`)).map((s) => s.id)).toEqual([(old.body as SwapEntry).id]);
    expect(await list("yao", `from=${day(3)}&to=${day(0)}`)).toHaveLength(2);
    expect(await list("yao", `from=${day(2)}&to=${day(0)}`)).toHaveLength(1);
    // Backwards, impossible or too long ranges are refused.
    expect(await list("yao", `from=${day(0)}&to=${day(3)}`)).toEqual({ error: "invalid_date_range" });
    expect(await list("yao", "from=2026-02-30&to=2026-03-01")).toEqual({ error: "invalid_date_range" });
    expect(await list("yao", `from=${day(400)}&to=${day(0)}`)).toEqual({ error: "invalid_date_range" });
    // Staff keep today's own swaps whatever they ask.
    expect(await list("afi", `from=${day(3)}&to=${day(3)}`)).toHaveLength(1);
  });
});

describe("Green Credit held by a charge (0052)", () => {
  const BOX = "0123456789abcdef0123456789abcdef";
  /** A connected socket at Bè whose outlet starts by QR code, paid from Green Credit. */
  async function withSocket() {
    const s = await setup();
    const now = new Date().toISOString();
    s.db.exec(`
      insert or replace into station_services (station_id, service, unlocked) values ('be', 'charging', 1);
      insert into devices (external_id, station_id, vendor, link, outlets, last_seen_at, qr_token, created_at) values ('123456', 'be', 'Xingke', 'own_server', 1, '${now}', '${BOX}', '${now}');
      insert into charging_points (id, station_id, label, status, device_id, outlet, last_seen_at, qr_start, created_at) values ('p1', 'be', '3456-1', 'free', '123456', 1, '${now}', 1, '${now}');
    `);
    return s;
  }
  const selfStart = (env: Env) => call<{ id?: string; error?: string }>(env, "ama", "POST", `/api/charging/outlets/${BOX}/start`, { pointId: "p1", pin: PIN });
  const credit = (db: DatabaseSync) => (db.prepare("select balance_xof from wallets where user_id = 'ama'").get() as { balance_xof: number }).balance_xof;
  const held = (db: DatabaseSync) => count(db, "select coalesce(sum(credit_held_xof), 0) as n from charging_sessions where status = 'charging'");
  const swapped = (db: DatabaseSync) => count(db, "select coalesce(sum(amount_xof), 0) as n from wallet_transactions where details like '%swap%'");

  it("lets a swap and a charge started at the same time never spend the credit twice", async () => {
    const { db, env } = await withSocket();
    const code = await creditCode(env, "ama");
    const [charge, paid] = await Promise.all([selfStart(env), swap(env, "afi", "be", { customerType: "app", creditCode: code })]);
    // Whichever came first: the credit never goes below 0 and every FCFA is either left, held or spent.
    expect(credit(db)).toBeGreaterThanOrEqual(0);
    expect(credit(db) + held(db) + swapped(db)).toBe(2000);
    expect([charge.status, paid.status]).toContain(200);
    if (charge.status === 200 && paid.status !== 200) expect(paid.body).toEqual({ error: "insufficient_balance" });
  });

  it("refuses a swap while a charge holds the whole credit (below the cap), and a charge after a swap holds what is left", async () => {
    const { db, env } = await withSocket();
    expect((await selfStart(env)).status).toBe(200);
    expect(credit(db)).toBe(0);
    expect((await swap(env, "afi", "be", { customerType: "app", creditCode: await creditCode(env, "ama") })).body).toEqual({ error: "insufficient_balance" });
    expect(held(db)).toBe(2000);

    const other = await withSocket();
    expect((await swap(other.env, "afi", "be", { customerType: "app", creditCode: await creditCode(other.env, "ama") })).status).toBe(200);
    expect((await selfStart(other.env)).status).toBe(200);
    expect([credit(other.db), held(other.db)]).toEqual([0, 1500]);
  });

  it("holds at most the backoffice's cap, so a swap during the charge spends the rest", async () => {
    const { db, env } = await withSocket();
    db.exec("update wallets set balance_xof = 10000 where user_id = 'ama'");
    const started = await selfStart(env);
    expect(started.status).toBe(200);
    // 3000 FCFA by default (app_settings.green_credit_charge_hold_xof): the charge stops there.
    expect(db.prepare("select credit_limit_xof, credit_held_xof from charging_sessions").get()).toEqual({ credit_limit_xof: 3000, credit_held_xof: 3000 });
    expect([credit(db), held(db)]).toEqual([7000, 3000]);
    // A battery swap meanwhile is paid from the 7000 FCFA still free.
    expect((await swap(env, "afi", "be", { customerType: "app", creditCode: await creditCode(env, "ama") })).status).toBe(200);
    expect([credit(db), held(db), swapped(db)]).toEqual([6500, 3000, 500]);
  });

  it("applies a cap the admin changed to the next charge, and only an admin may change it", async () => {
    const { db, env } = await withSocket();
    db.exec("update wallets set balance_xof = 10000 where user_id = 'ama'");
    for (const who of ["ama", "afi", "yao", "edem"]) {
      expect((await call(env, who, "POST", "/api/admin/wallet/charge-hold", { chargeHoldXof: 9000 })).status).toBe(403);
    }
    expect((await call(env, "admin", "POST", "/api/admin/wallet/charge-hold", { chargeHoldXof: 0 })).status).toBe(400);
    expect((await call(env, "admin", "POST", "/api/admin/wallet/charge-hold", { chargeHoldXof: 4500 })).status).toBe(200);
    expect((await call<{ chargeHoldXof: number }>(env, "admin", "GET", "/api/admin/wallet")).body.chargeHoldXof).toBe(4500);
    const first = await selfStart(env);
    expect(db.prepare("select credit_held_xof from charging_sessions where id = ?").get(first.body.id!)).toEqual({ credit_held_xof: 4500 });
    expect(credit(db)).toBe(5500);
    // A cap below the outlet's minimum price refuses the charge, as a too small balance does.
    db.exec("update charging_sessions set status = 'cancelled'");
    expect((await call(env, "admin", "POST", "/api/admin/wallet/charge-hold", { chargeHoldXof: 50 })).status).toBe(200);
    expect((await selfStart(env)).body).toEqual({ error: "insufficient_balance" });
  });
});

describe("editing and deleting a swap (backoffice history)", () => {
  const edit = (env: Env, as: string, station: string, id: string, body: Record<string, unknown>) =>
    call<SwapEntry>(env, as, "PATCH", `/api/stations/${station}/swaps/${id}`, body);
  const remove = (env: Env, as: string, station: string, id: string, query = "") => call(env, as, "DELETE", `/api/stations/${station}/swaps/${id}${query}`);

  it("lets the owner and admins correct the name, plate and amount; staff and other owners not", async () => {
    const { env, db } = await setup();
    const s = (await swap(env, "afi", "be", { customerType: "cash" })).body;
    expect((await edit(env, "afi", "be", s.id, { amountXof: 300 })).status).toBe(403);
    expect((await edit(env, "kossi", "be", s.id, { amountXof: 300 })).status).toBe(403);
    expect((await edit(env, "kossi", "kara", s.id, { amountXof: 300 })).body).toEqual({ error: "swap_not_found" });
    const ok = await edit(env, "yao", "be", s.id, { amountXof: 300, customerName: "  Malik  ", plate: "tg 12 ab" });
    expect(ok.body).toMatchObject({ id: s.id, amountXof: 300, customerName: "Malik", plate: "TG 12 AB" });
    expect((await edit(env, "admin", "be", s.id, { plate: "" })).body).toMatchObject({ plate: null });
    expect((await edit(env, "admin", "be", s.id, { amountXof: -1 })).body).toEqual({ error: "invalid_amount" });
    // Only a Mobile Money swap has a transaction id.
    expect((await edit(env, "admin", "be", s.id, { mmRef: "TM12345" })).body).toEqual({ error: "bad_request" });
    const log = db.prepare("select actor, action, row_id, station_id, changes from audit_log where table_name = 'swap_log' order by id").all() as { changes: string }[];
    expect(log).toHaveLength(2);
    expect(JSON.parse(log[0].changes)).toEqual({ customer_name: [null, "Malik"], plate: [null, "TG 12 AB"], amount_xof: [500, 300] });
  });

  it("keeps the amount of a swap paid from Green Credit; deleting it refunds the credit (admins only)", async () => {
    const { env, db } = await setup();
    const s = (await swap(env, "afi", "be", { customerType: "app", creditCode: await creditCode(env, "ama") })).body;
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 1500 });
    expect((await edit(env, "yao", "be", s.id, { amountXof: 100 })).body).toEqual({ error: "swap_amount_locked" });
    expect((await remove(env, "yao", "be", s.id)).body).toEqual({ error: "swap_credit_admin_only" });
    expect((await remove(env, "admin", "be", s.id)).status).toBe(200);
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 2000 });
    expect(db.prepare("select type, attribute, amount_xof, balance_after_xof from wallet_transactions order by created_at, attribute desc").all()).toEqual([
      { type: "charge", attribute: "send", amount_xof: 500, balance_after_xof: 1500 },
      { type: "charge", attribute: "received", amount_xof: 500, balance_after_xof: 2000 },
    ]);
    expect((await remove(env, "admin", "be", s.id)).body).toEqual({ error: "swap_not_found" });
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 2000 });
  });

  it("puts the battery back on the counter when deleting, unless told not to", async () => {
    const { env, db } = await setup();
    const a = (await swap(env, "afi", "be", { customerType: "cash" })).body;
    const b = (await swap(env, "afi", "be", { customerType: "cash" })).body;
    expect(full(db, "be")).toBe(1);
    expect((await counter(env, "be")).rows[0]).toMatchObject({ full: 1, empty: 2 });
    expect((await remove(env, "afi", "be", a.id)).status).toBe(403);
    expect((await remove(env, "yao", "be", a.id)).status).toBe(200);
    expect(full(db, "be")).toBe(2);
    expect((await counter(env, "be")).rows[0]).toMatchObject({ full: 2, empty: 1 });
    expect(db.prepare("select type, delta, reason, swap_id from battery_events where request_id = ?").get(`swap-delete:${a.id}`)).toEqual({
      type: "correction",
      delta: 1,
      reason: "Échange supprimé",
      swap_id: a.id,
    });
    expect((await remove(env, "admin", "be", b.id, "?restoreCounter=0")).status).toBe(200);
    expect((await counter(env, "be")).rows[0]).toMatchObject({ full: 2, empty: 1 });
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
    expect((await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps")).body).toEqual([]);
    expect(count(db, "select count(*) as n from audit_log where table_name = 'swap_log' and action = 'delete'")).toBe(2);
  });

  it("moves the batteries back in the register and drops numbers only this swap brought in", async () => {
    const { env, db } = await setup();
    const now = new Date().toISOString();
    db.exec(`
      insert into battery_types (id, brand, name, created_at) values ('sp72', 'Spiro', '72 V', '${now}');
      insert into station_battery_types (station_id, battery_type_id, full_batteries) values ('be', 'sp72', 3);
    `);
    // SP-1 comes in at the first swap and goes out at the second; SP-2 and SP-3 are new at the second.
    await swap(env, "afi", "be", { customerType: "cash", batteryTypeId: "sp72", batteryIn: "SP-1", batteryOut: "SP-0" });
    const second = (await swap(env, "afi", "be", { customerType: "app", contact: "90000005", payment: "cash", batteryTypeId: "sp72", batteryIn: "SP-2", batteryOut: "SP-1" })).body;
    const where = (serial: string) => db.prepare("select location, station_id, holder_user_id from batteries where serial = ?").get(serial);
    expect(where("SP-1")).toEqual({ location: "customer", station_id: null, holder_user_id: "ama" });
    expect((await remove(env, "yao", "be", second.id)).status).toBe(200);
    expect(where("SP-1")).toEqual({ location: "station", station_id: "be", holder_user_id: null });
    expect(where("SP-2")).toBeUndefined();
    expect(count(db, `select count(*) as n from battery_history where swap_id = '${second.id}'`)).toBe(0);
    expect(count(db, "select count(*) as n from batteries")).toBe(2);
  });

  it("corrects a Mobile Money transaction id, never to one that paid another swap", async () => {
    const { env, db } = await setup();
    const now = new Date().toISOString();
    db.exec(`
      insert into battery_types (id, brand, name, created_at) values ('ov30', 'Omnivoltaic', '30 Ah', '${now}');
      insert into station_battery_types (station_id, battery_type_id, full_batteries) values ('be', 'ov30', 3);
    `);
    const priced = await call(env, "admin", "POST", "/api/admin/battery-types", {
      id: "ov30",
      input: { brand: "Omnivoltaic", name: "30 Ah", isActive: true, pricing: "energy", priceFullXof: 900, ussdTmoney: "*145*{montant}#", ussdFlooz: "" },
    });
    expect(priced.status).toBe(200);
    const walkIn = (n: string, ref: string) => ({
      customerType: "cash", batteryTypeId: "ov30", batteryIn: `OV-${n}A`, batteryOut: `OV-${n}B`, inPct: 20, outPct: 100,
      plate: "TG 1", batteryInCondition: "ok", batteryOutChecked: true, mmNetwork: "tmoney", mmRef: ref,
    });
    const a = (await swap(env, "afi", "be", walkIn("1", "TM-0001"))).body;
    const b = (await swap(env, "afi", "be", walkIn("2", "TM-0002"))).body;
    expect(a.amountXof).toBe(720);
    expect((await edit(env, "yao", "be", b.id, { mmRef: "tm-0001" })).body).toEqual({ error: "mm_ref_used" });
    expect((await edit(env, "yao", "be", b.id, { plate: "" })).body).toEqual({ error: "plate_required" });
    expect((await edit(env, "yao", "be", b.id, { mmRef: "tm 0003", amountXof: 630, customerName: "Malik" })).body).toMatchObject({ mmRef: "TM0003", amountXof: 630, customerName: "Malik" });
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
