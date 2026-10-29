import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { AdminReservationPage } from "../shared/admin/types";
import type { MyStaffInvite, OwnerView } from "../shared/operators";
import type { OwnerLive, OwnerReport } from "../shared/owner-backoffice";
import type { BatteryEventView, StationCounter } from "../shared/station-work";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Plan phase 8: staff at exactly one station (W2, R15), the active-station rule on every
// remaining station action (R7, logged with station, person and role), the owner's
// backoffice (queue, handovers, settlement with W12, statistics), closing a station (R17)
// and the backoffice findings fixed with it (hours, prices, capacity, paging).

const OWN = "00000000-0000-4000-8000-000000000001";
const PARTNER = "op-partner";
const PIN = "2580";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "yao", phone: "+22890000002", name: "Yao", role: "operator" as const }, // owner of OWN (be, lome)
  { id: "kossi", phone: "+22890000003", name: "Kossi", role: "operator" as const }, // owner of PARTNER (kara)
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const }, // staff at be
  { id: "efo", phone: "+22890000005", name: "Efo", role: "operator" as const }, // staff at kara
  { id: "ama", phone: "+22890000006", name: "Ama", role: "customer" as const },
  { id: "kofi", phone: "+22890000007", name: "Kofi", role: "customer" as const },
  { id: "edem", phone: "+22890000008", name: "Edem", role: "fleet_manager" as const },
  { id: "yawa", phone: "+22890000009", name: "Yawa", role: "driver" as const },
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
    insert into operators (id, name, is_own, created_at) values ('${PARTNER}', 'Kara Énergie', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}'), ('${PARTNER}', 'kossi', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, is_solar, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'both', 10, '00:00-24:00', 500, 1, '${now}'),
      ('lome', '${OWN}', 'Lomé', 6.14, 1.23, 'both', 10, '00:00-24:00', 500, 1, '${now}'),
      ('kara', '${PARTNER}', 'Kara', 9.55, 1.19, 'both', 10, '00:00-24:00', 400, 1, '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values
      ('be', 1, 2, 3, '${now}'), ('lome', 1, 2, 5, '${now}'), ('kara', 1, 2, 2, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi'), ('kara', 'efo');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('be', 1, '', 0, '${now}'), ('lome', 1, '', 0, '${now}'), ('kara', 1, '', 0, '${now}');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 1500, 'x', 'x');
  `);
  return { db, env };
}

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

/** The owner invites, the person accepts their newest open staff invite (migration 0050). */
async function inviteAndAccept(env: Env, owner: string, stationId: string, contact: string, person: string) {
  expect((await call(env, owner, "POST", "/api/owner/staff", { stationId, contact })).status).toBe(200);
  const invites = (await call<MyStaffInvite[]>(env, person, "GET", "/api/staff-invites")).body;
  return call(env, person, "POST", `/api/staff-invites/${invites[invites.length - 1].id}/accept`);
}

const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const parcelInput = (to = "lome") => ({
  senderPhone: "91 00 00 00",
  recipientPhone: "92 00 00 00",
  toStationId: to,
  content: "Documents",
  measures: { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1 },
});

describe("staff at exactly one station (W2, R15)", () => {
  it("refuses a second station with 409 and moves the person instead", async () => {
    const { env, db } = await setup();
    expect((await inviteAndAccept(env, "yao", "lome", "90000004", "afi")).body).toEqual({ error: "staff_other_station" });
    expect((await inviteAndAccept(env, "yao", "be", "90000004", "afi")).status).toBe(200); // already there: nothing to do
    expect((await call(env, "afi", "POST", "/api/owner/staff/move", { userId: "afi", stationId: "lome" })).status).toBe(403); // staff: no backoffice
    expect((await call(env, "yao", "POST", "/api/owner/staff/move", { userId: "afi", stationId: "kara" })).status).toBe(403); // not Yao's station
    expect((await call(env, "kossi", "POST", "/api/owner/staff/move", { userId: "afi", stationId: "kara" })).status).toBe(403); // not Kossi's staff
    expect((await call(env, "yao", "POST", "/api/owner/staff/move", { userId: "afi", stationId: "lome" })).status).toBe(200);
    expect(db.prepare("select station_id from station_staff where user_id = 'afi'").all()).toEqual([{ station_id: "lome" }]);
    expect(db.prepare("select changes from audit_log where table_name = 'station_staff' and action = 'update'").get()).toEqual({
      changes: JSON.stringify({ station_id: ["be", "lome"] }),
    });
    // An admin may move anyone; the admin assignment route follows the same rule.
    expect((await call(env, "admin", "POST", "/api/admin/staff", { stationId: "be", userId: "efo" })).body).toEqual({ error: "staff_other_station" });
    expect((await call(env, "admin", "POST", "/api/owner/staff/move", { userId: "efo", stationId: "be" })).status).toBe(200);
  });

  it("makes a customer staff only with nothing open, and never an owner", async () => {
    const { env, db } = await setup();
    // Kofi has money in the wallet (R15).
    // The checks run when the invited person accepts (migration 0050).
    expect((await inviteAndAccept(env, "yao", "lome", "90000007", "kofi")).body).toEqual({ error: "role_change_blocked" });
    expect((await inviteAndAccept(env, "yao", "lome", "90000003", "kossi")).body).toEqual({ error: "has_other_role" });
    expect((await inviteAndAccept(env, "yao", "lome", "90000008", "edem")).body).toEqual({ error: "has_other_role" });
    expect((await inviteAndAccept(env, "yao", "lome", "90000006", "ama")).status).toBe(200);
    expect(db.prepare("select role from users where id = 'ama'").get()).toEqual({ role: "operator" });
  });

  it("changes staff to customer only after the removal", async () => {
    const { env } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/users/afi/role", { role: "customer" })).body).toEqual({ error: "role_change_blocked" });
    expect((await call(env, "yao", "DELETE", "/api/owner/staff", { stationId: "be", userId: "afi" })).status).toBe(200);
    // Removed from the last station, the account is a customer again.
    expect(((await call<{ role: string }>(env, "afi", "GET", "/api/me")).body).role).toBe("customer");
  });

  it("gives the owner the list to re-staff, resolved by a move or by hand", async () => {
    const { env, db } = await setup();
    const now = new Date().toISOString();
    db.exec(`insert into staff_reassignments (id, user_id, station_id, operator_id, created_at) values
      ('re1', 'afi', 'lome', '${OWN}', '${now}'), ('re2', 'efo', 'be', '${OWN}', '${now}'), ('re3', 'afi', 'kara', '${PARTNER}', '${now}')`);
    const view = (await call<OwnerView>(env, "yao", "GET", "/api/owner")).body;
    expect(view.reassignments.map((r) => [r.id, r.userId, r.stationId, r.currentStationId])).toEqual([
      ["re1", "afi", "lome", "be"],
      ["re2", "efo", "be", "kara"],
    ]);
    expect((await call<OwnerView>(env, "kossi", "GET", "/api/owner")).body.reassignments.map((r) => r.id)).toEqual(["re3"]);
    expect((await call(env, "kossi", "POST", "/api/owner/reassignments/re1/resolve")).status).toBe(403);
    // Moving Afi back to Lomé resolves her entry; Efo's is closed by hand.
    expect((await call(env, "yao", "POST", "/api/owner/staff/move", { userId: "afi", stationId: "lome" })).status).toBe(200);
    expect((await call(env, "yao", "POST", "/api/owner/reassignments/re2/resolve")).status).toBe(200);
    expect((await call<OwnerView>(env, "yao", "GET", "/api/owner")).body.reassignments).toEqual([]);
    expect(count(db, "select count(*) as n from staff_reassignments where resolved_at is null")).toBe(1);
  });

  it("shows an admin without a company of their own every operator (Atlas)", async () => {
    const { env } = await setup();
    const view = (await call<OwnerView>(env, "admin", "GET", "/api/owner")).body;
    expect(view.operators.map((o) => o.id).sort()).toEqual([OWN, PARTNER].sort());
    expect(view.stations.map((s) => s.id).sort()).toEqual(["be", "kara", "lome"]);
    expect((await call(env, "afi", "GET", "/api/owner")).status).toBe(403);
    expect((await call(env, "ama", "GET", "/api/owner")).status).toBe(403);
  });
});

describe("station details the owner keeps (hours, prices)", () => {
  it("saves opening hours as days and times only, never empty", async () => {
    const { env, db } = await setup();
    const save = (input: object) => call(env, "yao", "POST", "/api/owner/stations/be", { phone: null, ...input });
    expect((await save({ openingHours: "" })).body).toEqual({ error: "opening_hours_invalid" });
    expect((await save({ openingHours: "le matin" })).body).toEqual({ error: "opening_hours_invalid" });
    expect((await save({ openingHours: "Mo-Sa 25:00-21:00" })).body).toEqual({ error: "opening_hours_invalid" });
    expect((await save({ openingHours: "mo,tu,we,th,fr,sa 7:00-21:00" })).status).toBe(200);
    expect(db.prepare("select opening_hours from stations where id = 'be'").get()).toEqual({ opening_hours: "Mo-Sa 07:00-21:00" });
  });

  it("lets the owner set the swap and charging prices of their stations, validated and logged", async () => {
    const { env, db } = await setup();
    const save = (station: string, input: object, as = "yao") => call(env, as, "POST", `/api/owner/stations/${station}`, { openingHours: "00:00-24:00", phone: null, ...input });
    expect((await save("be", { swapXof: 333 })).status).toBe(400);
    expect((await save("be", { chargeKwhXof: 0 })).status).toBe(400);
    expect((await save("kara", { swapXof: 600 })).status).toBe(403);
    expect((await save("be", { swapXof: 600 }, "afi")).status).toBe(403);
    expect((await save("be", { swapXof: 600, chargeKwhXof: 175, chargeMinXof: 50 })).status).toBe(200);
    expect(db.prepare("select price_battery_xof, charge_kwh_xof, charge_min_xof from stations where id = 'be'").get()).toEqual({
      price_battery_xof: 600,
      charge_kwh_xof: 175,
      charge_min_xof: 50,
    });
    const view = (await call<OwnerView>(env, "yao", "GET", "/api/owner")).body;
    expect(view.prices.find((p) => p.stationId === "be")).toEqual({ stationId: "be", swapXof: 600, chargeKwhXof: 175, chargeMinXof: 50 });
    const log = db.prepare("select changes from audit_log where table_name = 'stations' and row_id = 'be' order by id desc").get() as { changes: string };
    expect(JSON.parse(log.changes)).toMatchObject({ price_battery_xof: [500, 600], charge_kwh_xof: [null, 175] });
  });

  it("logs a charging price change with the old value, and nothing for an unknown station (Atlas)", async () => {
    const { env, db } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/charging/tariff", { stationId: "nowhere", kwhXof: 200, minXof: 50 })).status).toBe(404);
    expect((await call(env, "admin", "POST", "/api/admin/charging/tariff", { stationId: "be", kwhXof: 203, minXof: 50 })).status).toBe(400);
    expect(count(db, "select count(*) as n from audit_log where table_name = 'stations'")).toBe(0);
    expect((await call(env, "admin", "POST", "/api/admin/charging/tariff", { stationId: "be", kwhXof: 200, minXof: 50 })).status).toBe(200);
    expect((await call(env, "admin", "POST", "/api/admin/charging/tariff", { kwhXof: 160, minXof: 100 })).status).toBe(200);
    const rows = db.prepare("select row_id, changes from audit_log order by id").all() as { row_id: string; changes: string }[];
    expect(rows.map((r) => [r.row_id, JSON.parse(r.changes)])).toEqual([
      ["be", { charge_kwh_xof: [null, 200], charge_min_xof: [null, 50] }],
      ["charge_tariff", { tariff: [{ kwhXof: 150, minXof: 100 }, { kwhXof: 160, minXof: 100 }] }],
    ]);
  });
});

describe("stations the admin creates and changes (Atlas)", () => {
  const input = (capacity: number) => ({
    operatorId: OWN,
    name: "Nouvelle",
    address: "",
    lat: 6.15,
    lng: 1.24,
    kind: "swap",
    vehicleTypes: ["scooter"],
    chargingSlots: 0,
    batteryCapacity: capacity,
    openingHours: "Mo-Sa 07:00-19:00",
    phone: null,
  });

  it("starts a new station closed with no full battery, and refuses empty hours", async () => {
    const { env, db } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: { ...input(8), openingHours: "" } })).body).toEqual({ error: "opening_hours_invalid" });
    expect((await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: input(8) })).status).toBe(200);
    expect(db.prepare("select st.is_open, st.full_batteries from station_status st join stations s on s.id = st.station_id where s.name = 'Nouvelle'").get()).toEqual({
      is_open: 0,
      full_batteries: 0,
    });
  });

  it("brings the full batteries down to a lower capacity, as logged corrections", async () => {
    const { env, db } = await setup();
    const be = { ...input(10), name: "Bè", openingHours: "00:00-24:00" };
    expect((await call(env, "admin", "POST", "/api/admin/stations", { id: "lome", input: { ...be, name: "Lomé", batteryCapacity: 3 } })).status).toBe(200);
    expect(db.prepare("select full_batteries from station_status where station_id = 'lome'").get()).toEqual({ full_batteries: 3 });
    const counter = (await call<StationCounter>(env, "admin", "GET", "/api/stations/lome/counter")).body;
    expect(counter.rows.map((r) => r.full)).toEqual([3]);
    expect(db.prepare("select type, delta, full_after, reason, role from battery_events where station_id = 'lome'").all()).toEqual([
      { type: "correction", delta: -2, full_after: 3, reason: "Capacité réduite", role: "admin" },
    ]);
    // Raising it again changes nothing.
    expect((await call(env, "admin", "POST", "/api/admin/stations", { id: "lome", input: { ...be, name: "Lomé", batteryCapacity: 12 } })).status).toBe(200);
    expect(count(db, "select count(*) as n from battery_events where station_id = 'lome'")).toBe(1);
  });
});

describe("active station on every station action (R7), logged with station, person and role", () => {
  it("refuses an owner without the active station (409) and logs each action that went through", async () => {
    const { env, db } = await setup();
    // Parcel at the counter.
    expect((await call(env, "yao", "POST", "/api/stations/be/parcels", parcelInput())).body).toEqual({ error: "active_station_required" });
    const parcel = await call<{ id: string }>(env, "yao", "POST", "/api/stations/be/parcels", parcelInput(), "be");
    expect(parcel.status).toBe(200);
    // Cancel at the sending station, and the notice again at the destination: same rule.
    expect((await call(env, "yao", "POST", `/api/parcels/${parcel.body.id}/cancel`)).status).toBe(409);
    expect((await call(env, "yao", "POST", `/api/parcels/${parcel.body.id}/cancel`, undefined, "lome")).status).toBe(409);
    expect((await call(env, "efo", "POST", `/api/parcels/${parcel.body.id}/cancel`, undefined, "kara")).status).toBe(403);
    expect((await call(env, "yao", "POST", `/api/parcels/${parcel.body.id}/cancel`, undefined, "be")).status).toBe(200);
    // greenpoint reward code at the counter (a wrong code is not logged: nothing went through).
    const redeem = { code: "123456" };
    expect((await call(env, "yao", "POST", "/api/stations/be/greenpoint/redeem", redeem)).status).toBe(409);
    expect((await call(env, "afi", "POST", "/api/stations/lome/greenpoint/redeem", redeem)).status).toBe(403);
    expect((await call(env, "afi", "POST", "/api/stations/be/greenpoint/redeem", redeem)).body).toEqual({ error: "invalid_code" });
    // Charging at a socket.
    expect((await call(env, "admin", "POST", "/api/stations/be/charging", { pointId: "x" })).status).toBe(409);
    expect((await call(env, "admin", "POST", "/api/stations/be/charging", { pointId: "x" }, "be")).status).toBe(404);
    // Open / close.
    expect((await call(env, "kossi", "PATCH", "/api/stations/kara/status", { isOpen: false })).status).toBe(409);
    expect((await call(env, "kossi", "PATCH", "/api/stations/kara/status", { isOpen: false }, "kara")).status).toBe(200);

    expect(db.prepare("select station_id, person_id, role, action from station_actions order by id").all()).toEqual([
      { station_id: "be", person_id: "yao", role: "owner", action: "POST /api/stations/:station/parcels" },
      { station_id: "be", person_id: "yao", role: "owner", action: `POST /api/parcels/${parcel.body.id}/cancel` },
      { station_id: "kara", person_id: "kossi", role: "owner", action: "PATCH /api/stations/:station/status" },
    ]);
  });
});

describe("closing a station (R17)", () => {
  it("cancels the reservations the warning counts, tells their customers and answers the number", async () => {
    const { env, db } = await setup();
    const now = Date.now();
    const iso = (min: number) => new Date(now + min * 60_000).toISOString();
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, status, created_at, expires_at, pickup_code) values
      ('r1', 'ama', 'be', 'battery', 'swap', 'active', '${iso(-5)}', '${iso(20)}', '1111'),
      ('r2', 'kofi', 'be', 'slot', 'charging_point', 'active', '${iso(-5)}', '${iso(20)}', '2222'),
      ('r3', 'edem', 'be', 'battery', 'swap', 'active', '${iso(-60)}', '${iso(-30)}', '3333'),
      ('r4', 'yawa', 'lome', 'battery', 'swap', 'active', '${iso(-5)}', '${iso(20)}', '4444')`);
    // The warning: the station's reservations still holding.
    const list = (await call<{ status: string; expiresAt: string }[]>(env, "afi", "GET", "/api/stations/be/reservations")).body;
    const warned = list.filter((r) => r.status === "active" && new Date(r.expiresAt).getTime() > Date.now()).length;
    expect(warned).toBe(2);
    const closed = await call<{ cancelled: number }>(env, "afi", "PATCH", "/api/stations/be/status", { isOpen: false });
    expect(closed.body).toEqual({ cancelled: warned });
    expect(db.prepare("select id, status, cancel_reason from reservations order by id").all()).toEqual([
      { id: "r1", status: "cancelled", cancel_reason: "station_closed" },
      { id: "r2", status: "cancelled", cancel_reason: "station_closed" },
      { id: "r3", status: "expired", cancel_reason: null },
      { id: "r4", status: "active", cancel_reason: null },
    ]);
    // The customers see why (the app's alerts read the reason), and it does not count against their limits.
    const mine = (await call<{ id: string; cancelReason: string | null }[]>(env, "ama", "GET", "/api/reservations/mine")).body;
    expect(mine.find((r) => r.id === "r1")?.cancelReason).toBe("station_closed");
    expect(count(db, "select count(*) as n from audit_log where table_name = 'reservations' and changes like '%station_closed%'")).toBe(2);
    // Closing again cancels nothing more.
    expect((await call(env, "afi", "PATCH", "/api/stations/be/status", { isOpen: false })).body).toEqual({ cancelled: 0 });
  });
});

describe("owner backoffice (staff get none)", () => {
  async function withActivity() {
    const t = await setup();
    const { db } = t;
    const now = new Date().toISOString();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    db.exec(`
      insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, customer_user_id, payment, amount_xof, staff_id, role, created_at) values
        ('s1', 'req-s0000001', 'kara', 1, 'cash', null, 'cash', 400, 'efo', 'staff', '${now}'),
        ('s2', 'req-s0000002', 'kara', 1, 'app', 'kofi', 'wallet', 400, 'efo', 'staff', '${now}'),
        ('s3', 'req-s0000003', 'kara', 1, 'cash', null, 'cash', 400, 'kossi', 'owner', '${old}'),
        ('s4', 'req-s0000004', 'be', 1, 'cash', null, 'cash', 500, 'afi', 'staff', '${now}');
      insert into charging_sessions (id, station_id, device_id, outlet, point_label, user_id, status, kwh_xof, min_xof, energy_wh, started_by, started_at, amount_xof, payment_method, paid_at) values
        ('c1', 'kara', 'd1', 1, 'P1', null, 'paid', 150, 100, 2000, 'efo', '${now}', 300, 'cash', '${now}'),
        ('c2', 'kara', 'd1', 1, 'P1', 'kofi', 'paid', 150, 100, 1000, 'efo', '${now}', 200, 'wallet', '${now}');
      insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_phone, recipient_phone, content, length_cm, width_cm, height_cm, weight_kg, size, price_fcfa, payment_method, paid_at, status, created_at) values
        ('p1', 'GP-AAAAA1', 'kara', 'be', '+22891000000', '+22892000000', 'Livre', 20, 10, 5, 1, 'S', 700, 'cash', '${now}', 'deposited', '${now}'),
        ('p2', 'GP-AAAAA2', 'kara', 'be', '+22891000000', '+22892000000', 'Livre', 20, 10, 5, 1, 'S', 700, 'cash', '${now}', 'cancelled', '${now}'),
        ('p3', 'GP-AAAAA3', 'be', 'kara', '+22891000000', '+22892000000', 'Livre', 20, 10, 5, 1, 'S', 700, 'cash', '${now}', 'in_transit', '${now}');
      insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values
        ('yawa', 'active', 'Yawa', 'ID001', 'LIC001', 'moto', 'ABCDEFGH', '${now}');
      insert into driver_ledger (id, driver_id, at, kind, amount_fcfa, station_id, actor) values ('l1', 'yawa', '${now}', 'settlement', 2000, 'kara', 'efo');
      insert into driver_queue (driver_id, station_id, since) values ('yawa', 'kara', '${now}');
      insert into parcel_scans (parcel_id, run_id, kind, driver_id, station_id, scanned_by, role, created_at) values
        ('p1', 'run1', 'handover_to_driver', 'yawa', 'kara', 'efo', 'staff', '${now}');
      insert into reservations (id, user_id, station_id, type, kind, status, created_at, expires_at, pickup_code) values
        ('r1', 'ama', 'kara', 'battery', 'swap', 'active', '${now}', '${new Date(Date.now() + 600_000).toISOString()}', '1234');
      insert into station_actions (station_id, person_id, role, action, created_at) values ('kara', 'efo', 'staff', 'POST x', '${now}');
    `);
    return t;
  }

  it("is the owner's and the admin's only", async () => {
    const { env } = await withActivity();
    for (const who of ["afi", "efo", "ama", "yawa", "edem"]) {
      expect((await call(env, who, "GET", "/api/owner/report?days=7")).status, who).toBe(403);
      expect((await call(env, who, "GET", "/api/owner/live")).status, who).toBe(403);
    }
    expect((await call(env, null, "GET", "/api/owner/live")).status).toBe(401);
    expect((await call(env, "yao", "GET", "/api/owner/report?stationId=kara")).status).toBe(403);
    expect((await call(env, "admin", "GET", "/api/owner/report?stationId=kara")).status).toBe(200);
    expect((await call(env, "efo", "GET", "/api/stations/kara/battery-events?days=30")).status).toBe(403);
    expect((await call<BatteryEventView[]>(env, "kossi", "GET", "/api/stations/kara/battery-events?days=30")).status).toBe(200);
  });

  it("settles revenue by service and day, and keeps poinderecharge's cash apart (W12)", async () => {
    const { env, db } = await withActivity();
    // Green Credit loaded in cash at kara's counter (0047): poinderecharge's cash too.
    db.exec(`insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof, station_id, created_at)
               values ('w1', 'AM11111111', 'ama', 'topup', 'received', 1000, 0, 1000, 1000, 'kara', '${new Date().toISOString()}')`);
    const r = (await call<OwnerReport>(env, "kossi", "GET", "/api/owner/report?days=7")).body;
    expect(r.days).toBe(7);
    // The partner's station only hosts the sockets (0039): its charges are not its revenue.
    expect(r.revenue).toEqual({ swapCashXof: 400, swapAppXof: 400, swapFleetXof: 0, chargeCashXof: 0, chargeAppXof: 0, cashXof: 400, totalXof: 800 });
    // Parcel cash (the cancelled one was refunded), the driver's cash and the charges paid in cash: for poinderecharge, not revenue.
    expect(r.poinderecharge).toEqual({ parcelsXof: 700, driversXof: 2000, chargesXof: 300, swapsXof: 0, cardsXof: 0, creditXof: 1000, totalXof: 4000, thirdParty: true });
    const today = r.perDay[r.perDay.length - 1];
    expect(today).toMatchObject({ swaps: 2, charges: 2, parcels: 2, swapXof: 800, chargeXof: 500 });
    expect(r.perDay).toHaveLength(7);
    expect(r.hours.reduce((a, b) => a + b, 0)).toBe(4);
    expect(r.staff).toEqual([{ personId: "efo", person: "Efo", role: "staff", swaps: 2, charges: 2, actions: 1 }]);
    // 30 days: still not the swap of 40 days ago; 12 months: with it.
    expect((await call<OwnerReport>(env, "kossi", "GET", "/api/owner/report?days=30")).body.revenue.swapCashXof).toBe(400);
    expect((await call<OwnerReport>(env, "kossi", "GET", "/api/owner/report?days=365")).body.revenue.swapCashXof).toBe(800);
    // Own stations: poinderecharge's own, nothing owed by a third party.
    const own = (await call<OwnerReport>(env, "yao", "GET", "/api/owner/report?days=1")).body;
    expect(own.poinderecharge).toMatchObject({ parcelsXof: 700, thirdParty: false });
    expect(own.revenue.totalXof).toBe(500);
  });

  it("shows the live queue and the handovers of the owner's stations", async () => {
    const { env } = await withActivity();
    const live = (await call<OwnerLive>(env, "kossi", "GET", "/api/owner/live")).body;
    expect(live.reservations.map((r) => [r.id, r.customer])).toEqual([["r1", "Ama"]]);
    expect(live.drivers).toMatchObject([{ stationId: "kara", name: "Yawa" }]);
    expect(live.parcels).toEqual([{ stationId: "kara", toSend: 1, incoming: 1, toPickUp: 0 }]);
    expect(live.handovers.map((h) => [h.kind, h.parcel, h.amountXof, h.driver, h.by])).toEqual(
      expect.arrayContaining([
        ["handover_to_driver", "GP-AAAAA1", null, "Yawa", "Efo"],
        ["driver_settlement", null, 2000, "Yawa", "Efo"],
      ]),
    );
    // Yao sees none of Kara's.
    const yao = (await call<OwnerLive>(env, "yao", "GET", "/api/owner/live")).body;
    expect(yao.reservations).toEqual([]);
    expect(yao.drivers).toEqual([]);
  });

  it("pages the admin's reservations with the total instead of stopping at 300 (Atlas)", async () => {
    const { env, db } = await setup();
    const now = Date.now();
    const rows = Array.from({ length: 120 }, (_, i) => {
      const at = new Date(now - i * 60_000).toISOString();
      return `('x${i}', '${i % 2 ? "ama" : "kofi"}', '${i % 3 ? "be" : "lome"}', 'battery', 'swap', 'completed', '${at}', '${at}', '0000')`;
    });
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, status, created_at, expires_at, pickup_code) values ${rows.join(",")}`);
    const page = (q: string) => call<AdminReservationPage>(env, "admin", "GET", `/api/admin/reservations?${q}`);
    const first = (await page("limit=50")).body;
    expect(first.total).toBe(120);
    expect(first.rows).toHaveLength(50);
    expect(first.rows[0].id).toBe("x0");
    expect((await page("limit=50&offset=100")).body.rows.map((r) => r.id)).toEqual(Array.from({ length: 20 }, (_, i) => `x${100 + i}`));
    expect((await page("stationId=lome")).body.total).toBe(40);
    expect((await page("search=ama")).body.total).toBe(60);
    expect((await page("search=ama&stationId=lome")).body.total).toBe(20);
    expect((await page("status=active")).body.total).toBe(0);
    expect((await call(env, "yao", "GET", "/api/admin/reservations")).status).toBe(403);
  });
});
