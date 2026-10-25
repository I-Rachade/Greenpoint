import type { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { BatteryDetail, BatteryList, BatteryLookup, RegisterBatteriesResult } from "../shared/batteries";
import type { SwapEntry } from "../shared/station-work";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { applyMigration, fakeD1 } from "./test-d1";

// Battery register (migration 0041): batteries per brand with their own history, registered
// by an admin or added by the first swap that names them. Runs the API on the SQLite D1.

const OWN = "00000000-0000-4000-8000-000000000001"; // poinderecharge, from 0001_init.sql
const PARTNER = "op-partner";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "yao", phone: "+22890000002", name: "Yao", role: "operator" as const }, // owner of be and lome
  { id: "kossi", phone: "+22890000003", name: "Kossi", role: "operator" as const }, // owner of kara
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const }, // staff at lome
  { id: "ama", phone: "+22890000005", name: "Ama", role: "customer" as const },
  { id: "esi", phone: "+22890000006", name: "Esi", role: "customer" as const },
];

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at) values (?, ?, ?, ?, ?)").run(u.id, u.phone, u.name, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  // be: no battery types (numbers optional); lome and kara swap Spiro and Omnivoltaic.
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('${PARTNER}', 'Kara Énergie', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}'), ('${PARTNER}', 'kossi', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 20, '00:00-24:00', 500, '${now}'),
      ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'swap', 20, '00:00-24:00', 500, '${now}'),
      ('kara', '${PARTNER}', 'Kara', 9.55, 1.19, 'swap', 20, '00:00-24:00', 400, '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values
      ('be', 1, 0, 8, '${now}'), ('lome', 1, 0, 8, '${now}'), ('kara', 1, 0, 8, '${now}');
    insert into station_staff (station_id, user_id) values ('lome', 'afi');
    insert into battery_types (id, brand, name, created_at) values ('sp72', 'Spiro', '72 V', '${now}'), ('ov60', 'Omnivoltaic', '60 V', '${now}');
    insert into station_battery_types (station_id, battery_type_id, full_batteries) values
      ('lome', 'sp72', 4), ('lome', 'ov60', 4), ('kara', 'sp72', 4), ('kara', 'ov60', 4);
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

const swap = (env: Env, as: string, station: string, body: Record<string, unknown>, active = station) =>
  call<SwapEntry>(env, as, "POST", `/api/stations/${station}/swaps`, { requestId: rid(), customerType: "cash", ...body }, active);
const list = async (env: Env, as = "admin", query = "") => call<BatteryList>(env, as, "GET", `/api/batteries${query}`);
const detail = async (env: Env, id: string, as = "admin") => call<BatteryDetail>(env, as, "GET", `/api/batteries/${id}`);
const idOf = (db: DatabaseSync, brand: string, serial: string) =>
  (db.prepare("select id from batteries where brand = ? and serial = ?").get(brand, serial) as { id: string } | undefined)?.id;
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;

describe("battery numbers at a swap", () => {
  it("are required at a station with battery types, the one brought back except for a first purchase", async () => {
    const { env, db } = await setup();
    expect((await swap(env, "afi", "lome", { batteryTypeId: "sp72" })).body).toEqual({ error: "battery_number_required" });
    expect((await swap(env, "afi", "lome", { batteryTypeId: "sp72", batteryOut: "SP-1" })).body).toEqual({ error: "battery_number_required" });
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
    expect((await swap(env, "afi", "lome", { batteryTypeId: "sp72", customerType: "first_purchase", batteryOut: "SP-1" })).status).toBe(200);
    // Without battery types they stay optional.
    expect((await swap(env, "yao", "be", {})).status).toBe(200);
  });

  it("adds an unknown number automatically, with its type, and follows it out and back in", async () => {
    const { env, db } = await setup();
    const first = await swap(env, "afi", "lome", { customerType: "app", contact: "90000005", payment: "cash", batteryTypeId: "sp72", batteryIn: "sp-0001", batteryOut: "sp-0002" });
    expect(first.body).toMatchObject({ batteryIn: "SP-0001", batteryOut: "SP-0002" });
    const out = idOf(db, "Spiro", "SP-0002")!;
    const back = idOf(db, "Spiro", "SP-0001")!;
    expect(db.prepare("select battery_in_id, battery_out_id from swap_log").get()).toEqual({ battery_in_id: back, battery_out_id: out });

    let b = (await detail(env, out)).body;
    expect(b).toMatchObject({ serial: "SP-0002", brand: "Spiro", typeLabel: "Spiro 72 V", source: "swap", location: "customer", holder: "Ama", swaps: 1 });
    expect(b.history.map((h) => h.type)).toEqual(["out", "added_at_swap"]);
    expect(b.history[0]).toMatchObject({ stationName: "Lomé", holder: "Ama", person: "Afi", role: "staff", payment: "cash", amountXof: 500 });
    expect((await detail(env, back)).body).toMatchObject({ location: "station", stationName: "Lomé", holder: null });

    // Esi brings SP-0002 back at Kara: the same battery, now at Kara.
    await swap(env, "kossi", "kara", { customerType: "app", contact: "90000006", payment: "cash", batteryTypeId: "sp72", batteryIn: "SP-0002", batteryOut: "SP-0001" });
    b = (await detail(env, out)).body;
    expect(b).toMatchObject({ location: "station", stationName: "Kara", swaps: 2 });
    expect(b.history.map((h) => [h.type, h.stationName])).toEqual([
      ["in", "Kara"],
      ["out", "Lomé"],
      ["added_at_swap", "Lomé"],
    ]);
    expect(count(db, "select count(*) as n from batteries")).toBe(2);
  });

  it("refuses a number registered under another brand, and changes nothing", async () => {
    const { env, db } = await setup();
    await call(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "ov60", serials: ["X-77"] });
    const before = count(db, "select full_batteries as n from station_status where station_id = 'lome'");
    expect((await swap(env, "afi", "lome", { batteryTypeId: "sp72", batteryIn: "X-77", batteryOut: "SP-9" })).body).toEqual({ error: "battery_wrong_brand" });
    expect(count(db, "select count(*) as n from swap_log")).toBe(0);
    expect(count(db, "select count(*) as n from batteries")).toBe(1);
    expect(count(db, "select full_batteries as n from station_status where station_id = 'lome'")).toBe(before);
    // The same number swapped as an Omnivoltaic battery is that one.
    expect((await swap(env, "afi", "lome", { batteryTypeId: "ov60", batteryIn: "X-77", batteryOut: "OV-1" })).status).toBe(200);
    expect(count(db, "select count(*) as n from batteries where serial = 'X-77'")).toBe(1);
  });

  it("gives a battery added without brand the brand of its first typed swap", async () => {
    const { env, db } = await setup();
    await swap(env, "yao", "be", { batteryIn: "N-5", batteryOut: "N-6" });
    expect(idOf(db, "", "N-6")).toBeTruthy();
    expect((await list(env)).body.brands).toEqual([
      { brand: "Omnivoltaic", count: 0 },
      { brand: "Spiro", count: 0 },
      { brand: "", count: 2 },
    ]);
    await swap(env, "afi", "lome", { batteryTypeId: "sp72", batteryIn: "N-6", batteryOut: "SP-3" });
    expect(idOf(db, "", "N-6")).toBeUndefined();
    const b = (await detail(env, idOf(db, "Spiro", "N-6")!)).body;
    expect(b.history.map((h) => [h.type, h.stationName])).toEqual([
      ["in", "Lomé"],
      ["out", "Bè"],
      ["added_at_swap", "Bè"],
    ]);
    // A later swap without types finds it under its brand.
    await swap(env, "yao", "be", { batteryOut: "N-6", batteryIn: "N-7" });
    expect(count(db, "select count(*) as n from batteries where serial = 'N-6'")).toBe(1);
  });

  it("tells the swap form whether a number is known, new or of another brand", async () => {
    const { env } = await setup();
    await call(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "sp72", serials: ["SP-1"] });
    const look = (serial: string, type: string, as = "afi") =>
      call<BatteryLookup>(env, as, "GET", `/api/stations/lome/batteries/lookup?serial=${serial}&batteryTypeId=${type}`);
    expect((await look("sp-1", "sp72")).body).toEqual({ state: "known", brand: "Spiro", status: "in_service" });
    expect((await look("SP-2", "sp72")).body).toEqual({ state: "new", brand: null, status: null });
    expect((await look("SP-1", "ov60")).body).toEqual({ state: "wrong_brand", brand: "Spiro", status: "in_service" });
    expect((await look("SP-1", "sp72", "ama")).status).toBe(403);
  });
});

describe("battery register", () => {
  it("registers numbers for a type in advance; known ones and empty entries are reported", async () => {
    const { env, db } = await setup();
    const res = await call<RegisterBatteriesResult>(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "sp72", serials: ["sp-1", "SP-2", "sp-1", " "] });
    expect(res.body).toEqual({ added: 2, existing: [], invalid: [" "] });
    expect((await call<RegisterBatteriesResult>(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "sp72", serials: ["SP-2", "SP-3"] })).body).toEqual({
      added: 1,
      existing: ["SP-2"],
      invalid: [],
    });
    // The swap links the registered battery instead of adding one.
    await swap(env, "afi", "lome", { batteryTypeId: "sp72", batteryIn: "SP-9", batteryOut: "SP-1" });
    const sp1 = (await detail(env, idOf(db, "Spiro", "SP-1")!)).body;
    expect(sp1).toMatchObject({ source: "registered", location: "customer", swaps: 1 });
    expect(sp1.history.map((h) => [h.type, h.role])).toEqual([
      ["out", "staff"],
      ["registered", "admin"],
    ]);
    expect((await call(env, "yao", "POST", "/api/admin/batteries", { batteryTypeId: "sp72", serials: ["SP-4"] })).status).toBe(403);
  });

  it("lists batteries per brand with search and filters", async () => {
    const { env } = await setup();
    await call(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "sp72", serials: ["SP-1", "SP-2", "SP-3"] });
    await call(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "ov60", serials: ["OV-1"] });
    await swap(env, "afi", "lome", { batteryTypeId: "sp72", batteryIn: "SP-1", batteryOut: "SP-2" });
    const all = (await list(env)).body;
    expect(all.canEdit).toBe(true);
    expect(all.brands).toEqual([
      { brand: "Omnivoltaic", count: 1 },
      { brand: "Spiro", count: 3 },
    ]);
    expect((await list(env, "admin", "?brand=Spiro")).body.batteries.map((b) => b.serial).sort()).toEqual(["SP-1", "SP-2", "SP-3"]);
    expect((await list(env, "admin", "?q=p-3")).body.batteries.map((b) => b.serial)).toEqual(["SP-3"]);
    expect((await list(env, "admin", "?stationId=lome")).body.batteries.map((b) => b.serial).sort()).toEqual(["SP-1", "SP-2"]);
  });

  it("lets an admin change the status, which goes into the history", async () => {
    const { env, db } = await setup();
    await call(env, "admin", "POST", "/api/admin/batteries", { batteryTypeId: "sp72", serials: ["SP-1"] });
    const id = idOf(db, "Spiro", "SP-1")!;
    expect((await call(env, "admin", "PATCH", `/api/admin/batteries/${id}`, { status: "repair", reason: "Cellule gonflée" })).status).toBe(200);
    expect((await call(env, "admin", "PATCH", `/api/admin/batteries/${id}`, { status: "broken" })).status).toBe(400);
    expect((await call(env, "admin", "PATCH", "/api/admin/batteries/nope", { status: "lost" })).status).toBe(404);
    expect((await call(env, "yao", "PATCH", `/api/admin/batteries/${id}`, { status: "lost" })).status).toBe(403);
    const b = (await detail(env, id)).body;
    expect(b.status).toBe("repair");
    expect(b.history[0]).toMatchObject({ type: "status", status: "repair", reason: "Cellule gonflée", person: "Admin" });
    expect((await list(env, "admin", "?status=repair")).body.batteries.map((x) => x.serial)).toEqual(["SP-1"]);
  });

  it("shows an owner the batteries of their stations only, without the people of other operators", async () => {
    const { env, db } = await setup();
    await swap(env, "afi", "lome", { customerType: "app", contact: "90000005", payment: "cash", batteryTypeId: "sp72", batteryIn: "SP-1", batteryOut: "SP-2" });
    await swap(env, "kossi", "kara", { customerType: "app", contact: "90000006", payment: "cash", batteryTypeId: "sp72", batteryIn: "SP-2", batteryOut: "SP-3" });
    const mine = (await list(env, "yao")).body;
    expect(mine.canEdit).toBe(false);
    expect(mine.batteries.map((b) => b.serial).sort()).toEqual(["SP-1", "SP-2"]);
    expect(mine.brands.find((b) => b.brand === "Spiro")?.count).toBe(2);
    // SP-3 never came through Yao's stations.
    expect((await detail(env, idOf(db, "Spiro", "SP-3")!, "yao")).status).toBe(404);
    expect((await list(env, "yao", "?stationId=kara")).status).toBe(403);
    const sp2 = (await detail(env, idOf(db, "Spiro", "SP-2")!, "yao")).body;
    expect(sp2.history.map((h) => [h.type, h.stationName, h.holder, h.person])).toEqual([
      ["in", "Kara", null, ""],
      ["out", "Lomé", "Ama", "Afi"],
      ["added_at_swap", "Lomé", null, "Afi"],
    ]);
    // Kossi sees who has SP-3 (handed out at Kara), Yao does not see SP-3 at all.
    expect((await list(env, "kossi")).body.batteries.find((b) => b.serial === "SP-3")?.holder).toBe("Esi");
    // Staff and riders get nothing.
    expect((await list(env, "afi")).status).toBe(403);
    expect((await list(env, "ama")).status).toBe(403);
  });
});

describe("migration 0041", () => {
  it("creates the batteries and history of the swaps already logged with numbers", () => {
    const { db } = fakeD1({ before: "0041" });
    const t = (m: number) => `2026-10-1${m}T10:00:00.000Z`;
    db.exec(`
      insert into users (id, phone, full_name, role, created_at) values ('afi', '+22890000004', 'Afi', 'operator', '${t(0)}'), ('ama', '+22890000005', 'Ama', 'rider', '${t(0)}');
      insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, created_at) values
        ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'swap', 10, '00:00-24:00', '${t(0)}'), ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', '${t(0)}');
      insert into battery_types (id, brand, name, created_at) values ('sp72', 'Spiro', '72 V', '${t(0)}');
      insert into swap_log (id, request_id, station_id, battery_type_id, has_battery_in, battery_in_label, battery_out_label, customer_type, customer_user_id, payment, amount_xof, staff_id, role, created_at) values
        ('s1', 'r1', 'lome', 'sp72', 0, null, 'SP-1', 'first_purchase', 'ama', 'cash', 30000, 'afi', 'staff', '${t(1)}'),
        ('s2', 'r2', 'lome', 'sp72', 1, 'SP-1', 'SP-2', 'app', 'ama', 'cash', 500, 'afi', 'staff', '${t(2)}'),
        ('s3', 'r3', 'be', '', 1, 'SP-1', 'B-1', 'cash', null, 'cash', 500, 'afi', 'staff', '${t(3)}'),
        ('s4', 'r4', 'be', '', 1, null, null, 'cash', null, 'cash', 500, 'afi', 'staff', '${t(4)}');
    `);
    applyMigration(db, "0041_batteries.sql");
    const batteries = db.prepare("select brand, serial, battery_type_id, source, location, station_id, holder_user_id, last_swap_at from batteries order by brand, serial").all();
    expect(batteries).toEqual([
      { brand: "", serial: "B-1", battery_type_id: null, source: "swap", location: "customer", station_id: null, holder_user_id: null, last_swap_at: t(3) },
      // SP-1 brought back at Bè (no types) is a battery without brand there, as the swap log knows it.
      { brand: "", serial: "SP-1", battery_type_id: null, source: "swap", location: "station", station_id: "be", holder_user_id: null, last_swap_at: t(3) },
      { brand: "Spiro", serial: "SP-1", battery_type_id: "sp72", source: "swap", location: "station", station_id: "lome", holder_user_id: null, last_swap_at: t(2) },
      { brand: "Spiro", serial: "SP-2", battery_type_id: "sp72", source: "swap", location: "customer", station_id: null, holder_user_id: "ama", last_swap_at: t(2) },
    ]);
    const sp1 = db.prepare("select id from batteries where brand = 'Spiro' and serial = 'SP-1'").get() as { id: string };
    expect(db.prepare("select type, swap_id from battery_history where battery_id = ? order by created_at, rowid").all(sp1.id)).toEqual([
      { type: "added_at_swap", swap_id: "s1" },
      { type: "out", swap_id: "s1" },
      { type: "in", swap_id: "s2" },
    ]);
    expect(db.prepare("select id, battery_in_id is not null as has_in, battery_out_id is not null as has_out from swap_log order by id").all()).toEqual([
      { id: "s1", has_in: 0, has_out: 1 },
      { id: "s2", has_in: 1, has_out: 1 },
      { id: "s3", has_in: 1, has_out: 1 },
      { id: "s4", has_in: 0, has_out: 0 },
    ]);
  });
});
