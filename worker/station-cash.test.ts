import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { CashHandover, StationCash } from "../src/lib/station-cash";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { cashOfStations, runCashAlerts } from "./station-cash";
import { fakeD1 } from "./test-d1";

// Station types and the daily cash handover (migration 0045): an operator station keeps its
// swaps, a shop station's swaps are ours; what a partner station takes for poinderecharge is
// closed every day, confirmed or rejected by an admin, with the host's commission and the
// late alert at 10:00.

const OWN = "00000000-0000-4000-8000-000000000001";
const PARTNER = "op-partner";
const SHOP = "op-shop";
const PIN = "2580";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "yao", phone: "+22890000002", name: "Yao", role: "operator" as const }, // owner of OWN (be)
  { id: "kossi", phone: "+22890000003", name: "Kossi", role: "operator" as const }, // owner of PARTNER (kara, an operator station)
  { id: "mensah", phone: "+22890000004", name: "Mensah", role: "operator" as const }, // owner of SHOP (boutique, a shop station)
  { id: "efo", phone: "+22890000005", name: "Efo", role: "operator" as const }, // staff at kara
  { id: "ama", phone: "+22890000006", name: "Ama", role: "customer" as const },
];

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  const created = ago(3);
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
    insert into operators (id, name, is_own, created_at) values ('${PARTNER}', 'Kara Énergie', 0, '${now}'), ('${SHOP}', 'Boutique Mensah', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}'), ('${PARTNER}', 'kossi', '${now}'), ('${SHOP}', 'mensah', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, swap_owner, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'both', 10, '00:00-24:00', 500, null, '${created}'),
      ('kara', '${PARTNER}', 'Kara', 9.55, 1.19, 'both', 10, '00:00-24:00', 400, null, '${created}'),
      ('boutique', '${SHOP}', 'Boutique', 6.15, 1.24, 'both', 10, '00:00-24:00', 450, 'poinderecharge', '${created}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values
      ('be', 1, 0, 3, '${now}'), ('kara', 1, 0, 3, '${now}'), ('boutique', 1, 0, 3, '${now}');
    insert into station_staff (station_id, user_id) values ('kara', 'efo');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 5000, 'x', 'x');
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

let seq = 0;
const rid = () => `req-c${String(++seq).padStart(7, "0")}`;

/** Cash and sales at kara and the boutique, one day ago. */
function activity(db: DatabaseSync, at = ago(1)) {
  db.exec(`
    insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, customer_user_id, payment, amount_xof, staff_id, role, owner, created_at) values
      ('s1', 'req-s0000001', 'kara', 1, 'cash', null, 'cash', 400, 'efo', 'staff', 'operator', '${at}'),
      ('s2', 'req-s0000002', 'boutique', 1, 'cash', null, 'cash', 450, 'mensah', 'owner', 'poinderecharge', '${at}'),
      ('s3', 'req-s0000003', 'boutique', 1, 'app', 'ama', 'wallet', 450, 'mensah', 'owner', 'poinderecharge', '${at}'),
      ('s4', 'req-s0000004', 'be', 1, 'cash', null, 'cash', 500, 'yao', 'owner', 'poinderecharge', '${at}');
    insert into charging_sessions (id, station_id, device_id, outlet, point_label, user_id, status, kwh_xof, min_xof, energy_wh, started_by, started_at, amount_xof, payment_method, paid_at) values
      ('c1', 'kara', 'd1', 1, 'P1', null, 'paid', 150, 100, 2000, 'efo', '${at}', 300, 'cash', '${at}'),
      ('c2', 'kara', 'd1', 1, 'P1', 'ama', 'paid', 150, 100, 1000, 'efo', '${at}', 200, 'wallet', '${at}');
    insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_phone, recipient_phone, content, length_cm, width_cm, height_cm, weight_kg, size, price_fcfa, payment_method, paid_at, status, created_at) values
      ('p1', 'GP-AAAAA1', 'kara', 'be', '+22891000000', '+22892000000', 'Livre', 20, 10, 5, 1, 'S', 700, 'cash', '${at}', 'deposited', '${at}');
    insert into charge_cards (id_tag, balance_xof, created_at) values ('CARD1', 1000, '${at}');
    insert into charge_card_transactions (id, id_tag, type, amount_xof, balance_after_xof, station_id, created_by, created_at) values
      ('t1', 'CARD1', 'topup', 1000, 1000, 'kara', 'efo', '${at}');
  `);
}

const cashOf = async (env: Env, as: string, stationId: string) =>
  (await call<StationCash[]>(env, as, "GET", `/api/owner/cash?stationId=${stationId}`)).body[0];

const close = (env: Env, as: string, stationId: string, amountXof: number, expectedDueXof: number, extra: Record<string, unknown> = {}) =>
  call<CashHandover & { error?: string }>(env, as, "POST", "/api/owner/cash/handovers", {
    stationId,
    amountXof,
    method: "mobile_money",
    reference: "FLZ-123456",
    expectedDueXof,
    ...extra,
  });

describe("station types: who owns the swapping", () => {
  it("lets the app pay a shop station's swaps, never an operator station's", async () => {
    const { env, db } = await setup();
    const swap = (station: string, as: string) =>
      call<{ id: string; payment: string; amountXof: number; error?: string }>(
        env,
        as,
        "POST",
        `/api/stations/${station}/swaps`,
        { requestId: rid(), customerType: "app", contact: "90000006", pin: PIN },
        station,
      );
    expect((await swap("kara", "kossi")).body).toEqual({ error: "payment_not_offered" });
    const shop = await swap("boutique", "mensah");
    expect(shop.body).toMatchObject({ payment: "wallet", amountXof: 450 });
    expect(db.prepare("select owner from swap_log where id = ?").get(shop.body.id)).toEqual({ owner: "poinderecharge" });
    // A cash swap at the operator station stays the operator's.
    const cash = await call<{ id: string }>(env, "efo", "POST", "/api/stations/kara/swaps", { requestId: rid(), customerType: "cash" }, "kara");
    expect(db.prepare("select owner from swap_log where id = ?").get(cash.body.id)).toEqual({ owner: "operator" });
  });

  it("is set by an admin only, never on our own stations, and audited", async () => {
    const { env, db } = await setup();
    const settings = { swapOwner: "poinderecharge", commissionPct: 10, commissionMode: "deduct" };
    expect((await call(env, "kossi", "POST", "/api/admin/cash/stations/kara", settings)).status).toBe(403);
    expect((await call(env, "admin", "POST", "/api/admin/cash/stations/be", settings)).body).toEqual({ error: "own_station" });
    expect((await call(env, "admin", "POST", "/api/admin/cash/stations/kara", { ...settings, commissionPct: 101 })).body).toEqual({ error: "bad_request" });
    const saved = await call<StationCash>(env, "admin", "POST", "/api/admin/cash/stations/kara", settings);
    expect(saved.body).toMatchObject({ stationId: "kara", type: "shop", commissionPct: 10, commissionMode: "deduct" });
    expect(db.prepare("select changes from audit_log where table_name = 'stations' and row_id = 'kara'").get()).toEqual({
      changes: JSON.stringify({ swap_owner: [null, "poinderecharge"], commission_pct: [0, 10], commission_mode: ["monthly", "deduct"] }),
    });
  });
});

describe("daily cash handover", () => {
  it("lists what a partner station took for poinderecharge, never the operator's own swaps", async () => {
    const { env, db } = await setup();
    activity(db);
    const kara = await cashOf(env, "kossi", "kara");
    expect(kara).toMatchObject({ type: "operator", carryXof: 0, commissionXof: 0, dueXof: 2000, pendingXof: 0 });
    expect(kara.lines).toEqual({ chargesXof: 300, swapsXof: 0, parcelsXof: 700, driversXof: 0, cardsXof: 1000, totalXof: 2000 });
    const boutique = await cashOf(env, "mensah", "boutique");
    // The cash swap is ours; the wallet one is paid already, it only counts for the commission.
    expect(boutique).toMatchObject({ type: "shop", dueXof: 450, commissionBaseXof: 900 });
    expect(boutique.lines.swapsXof).toBe(450);
    // Our own stations owe nothing; an owner sees only their stations, an admin all.
    expect((await call<StationCash[]>(env, "yao", "GET", "/api/owner/cash")).body).toEqual([]);
    expect((await call(env, "kossi", "GET", "/api/owner/cash?stationId=boutique")).status).toBe(403);
    expect((await call(env, "efo", "GET", "/api/owner/cash")).status).toBe(403);
    expect((await call<StationCash[]>(env, "admin", "GET", "/api/owner/cash")).body.map((s) => s.stationId)).toEqual(["boutique", "kara"]);
  });

  it("closes the day, then carries over what an admin rejects or what was short", async () => {
    const { env, db } = await setup();
    activity(db);
    const due = (await cashOf(env, "kossi", "kara")).dueXof;
    expect(due).toBe(2000);
    // The figures moved since the owner looked: closed again with the new amount.
    expect((await close(env, "kossi", "kara", 1500, 1500, { note: "x" })).body).toEqual({ error: "cash_changed" });
    expect((await close(env, "kossi", "kara", 1500, due)).body).toEqual({ error: "handover_note_required" });
    expect((await close(env, "kossi", "kara", due, due, { reference: " " })).body).toEqual({ error: "handover_reference_required" });
    expect((await close(env, "efo", "kara", due, due)).status).toBe(403); // staff: no backoffice
    const short = await close(env, "kossi", "kara", 1500, due, { note: "500 rendus à un client" });
    expect(short.body).toMatchObject({ status: "pending", cashXof: 2000, dueXof: 2000, amountXof: 1500, createdBy: "Kossi" });
    let kara = await cashOf(env, "kossi", "kara");
    // Pending counts as handed over; the 500 short is carried to the next closing.
    expect(kara).toMatchObject({ lines: { totalXof: 0 }, carryXof: 500, dueXof: 500, pendingXof: 1500 });
    // Only an admin decides, once, and a rejection needs a reason.
    expect((await call(env, "kossi", "POST", `/api/admin/cash/handovers/${short.body.id}/decide`, { confirm: true })).status).toBe(403);
    expect((await call(env, "admin", "POST", `/api/admin/cash/handovers/${short.body.id}/decide`, { confirm: false })).body).toEqual({ error: "reject_reason_required" });
    const rejected = await call<CashHandover>(env, "admin", "POST", `/api/admin/cash/handovers/${short.body.id}/decide`, { confirm: false, reason: "Rien reçu" });
    expect(rejected.body).toMatchObject({ status: "rejected", rejectReason: "Rien reçu", decidedBy: "Admin" });
    expect((await call(env, "admin", "POST", `/api/admin/cash/handovers/${short.body.id}/decide`, { confirm: true })).body).toEqual({ error: "handover_decided" });
    kara = await cashOf(env, "kossi", "kara");
    expect(kara).toMatchObject({ carryXof: 2000, dueXof: 2000, pendingXof: 0 });
    // Handed over in full and confirmed: nothing left.
    const full = await close(env, "kossi", "kara", 2000, 2000);
    expect((await call(env, "admin", "POST", `/api/admin/cash/handovers/${full.body.id}/decide`, { confirm: true })).status).toBe(200);
    expect(await cashOf(env, "kossi", "kara")).toMatchObject({ carryXof: 0, dueXof: 0 });
    expect(db.prepare("select count(*) as n from audit_log where table_name = 'cash_handovers'").get()).toEqual({ n: 4 });
  });

  it("keeps the commission back at each handover, or only counts it when paid monthly", async () => {
    const { env, db } = await setup();
    activity(db);
    await call(env, "admin", "POST", "/api/admin/cash/stations/boutique", { swapOwner: "poinderecharge", commissionPct: 10, commissionMode: "deduct" });
    // 10 % of our sales at the station (900), kept back from the cash (450).
    expect(await cashOf(env, "mensah", "boutique")).toMatchObject({ commissionBaseXof: 900, commissionXof: 90, dueXof: 360, monthCommissionXof: expect.any(Number) });
    const h = await close(env, "mensah", "boutique", 360, 360);
    expect(h.body).toMatchObject({ commissionXof: 90, dueXof: 360 });
    expect(await cashOf(env, "mensah", "boutique")).toMatchObject({ carryXof: 0, dueXof: 0 });
    await call(env, "admin", "POST", "/api/admin/cash/stations/kara", { swapOwner: "operator", commissionPct: 10, commissionMode: "monthly" });
    // Monthly: the whole cash is handed over, the commission is only shown.
    expect(await cashOf(env, "kossi", "kara")).toMatchObject({ commissionBaseXof: 500, commissionXof: 0, dueXof: 2000 });
  });

  it("counts a station late after 10:00 the next morning and tells the admins", async () => {
    const { env, db } = await setup();
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setUTCHours(18, 0, 0, 0);
    activity(db, yesterday.toISOString());
    const today = new Date(yesterday.getTime() + 86_400_000);
    const at = (h: number) => new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), h));
    expect((await cashOfStations(env.DB, null, at(9))).filter((s) => s.late)).toEqual([]);
    expect(await runCashAlerts(env, at(10))).toEqual(["boutique", "kara"]);
    // Closed: no longer late.
    await close(env, "kossi", "kara", 2000, 2000);
    expect(await runCashAlerts(env, new Date(Math.max(Date.now(), at(10).getTime()) + 60_000))).toEqual(["boutique"]);
  });
});
