import {
  chargePrice,
  DEFAULT_CHARGE_TARIFF,
  roundUpTo5,
  validTariff,
  type AdminCharging,
  type ChargePaymentMethod,
  type ChargeSession,
  type ChargeStatus,
  type ChargeTariff,
  type StationCharging,
  contactFromCode,
} from "../src/lib/charging";
import { parseContact } from "../src/lib/contact";
import type { Profile } from "../src/lib/types";
import { newTrxId, personLabel } from "../src/lib/wallet";
import { verifyPin } from "./auth";
import { onlineSince, startOutlet, stopOutlet } from "./devices";
import type { Env } from "./env";
import { chargeEarnStatement } from "./greenpoint";
import { ApiError, nowIso, readJson, uuid } from "./http";
import { requireService } from "./services";
import { mobilePaymentOffered, startChargePayment, type Payment } from "./payments";
import { walletAccess } from "./wallet";

// Charging at a connected socket, run by station staff (plan: planung/laden-vor-ort-plan.md,
// schema: migrations/0025_charging_sessions.sql). Staff start an outlet for a cash or app
// customer, the socket's readings add up the energy (chargeReadingStatement, called by
// devices.ts), staff stop it or the socket ends it, and the charge is paid in cash at the
// counter or by the customer in the app (wallet, Flooz, T-Money).

type StaffCheck = (user: Profile, stationId: string) => Promise<boolean>;

interface SessionRow {
  id: string;
  station_id: string;
  station_name: string;
  is_own: number | null;
  charging_point_id: string | null;
  device_id: string;
  outlet: number;
  point_label: string;
  user_id: string | null;
  status: ChargeStatus;
  kwh_xof: number;
  min_xof: number;
  energy_wh: number;
  started_at: string;
  stopped_by: string | null;
  stopped_at: string | null;
  amount_xof: number | null;
  payment_method: ChargePaymentMethod | null;
  payment_ref: string | null;
  paid_at: string | null;
  power_watts: number | null;
  point_status: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  greenpoints: number | null;
}

const SESSION_SELECT = `
  select cs.*, s.name as station_name, o.is_own, p.power_watts, p.status as point_status,
         u.full_name, u.phone, u.email,
         (select points from greenpoint_ledger g where g.charging_session_id = cs.id) as greenpoints
    from charging_sessions cs
    join stations s on s.id = cs.station_id
    left join operators o on o.id = s.operator_id
    left join charging_points p on p.id = cs.charging_point_id
    left join users u on u.id = cs.user_id`;

function toSession(r: SessionRow): ChargeSession {
  const tariff = { kwhXof: r.kwh_xof, minXof: r.min_xof };
  return {
    id: r.id,
    stationId: r.station_id,
    stationName: r.station_name,
    pointLabel: r.point_label,
    status: r.status,
    customer: r.user_id ? personLabel({ fullName: r.full_name, phone: r.phone, email: r.email }) : null,
    powerWatts: r.status === "charging" && r.point_status === "charging" ? (r.power_watts ?? 0) : 0,
    energyWh: r.energy_wh,
    tariff,
    amountXof: r.status === "paid" ? (r.amount_xof ?? 0) : chargePrice(r.energy_wh, tariff),
    startedAt: r.started_at,
    stoppedAt: r.stopped_at,
    endedByDevice: !!r.stopped_at && !r.stopped_by,
    paymentMethod: r.payment_method,
    paidAt: r.paid_at,
    greenpoints: r.greenpoints ?? 0,
  };
}

async function loadSession(db: D1Database, id: string): Promise<SessionRow> {
  const row = await db.prepare(`${SESSION_SELECT} where cs.id = ?`).bind(id).first<SessionRow>();
  if (!row) throw new ApiError("not_found", 404);
  return row;
}

function audit(db: D1Database, actor: string | null, action: "insert" | "update", s: { id: string; station_id: string; user_id: string | null }, changes: object) {
  return db
    .prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'charging_sessions', ?, ?, ?, ?, ?)",
    )
    .bind(nowIso(), actor, action, s.id, s.station_id, s.user_id, JSON.stringify(changes));
}

/**
 * The audit row of a guarded UPDATE: written only if the statement right before it in the
 * batch changed a row (SQLite changes()), so a double tap that lost the race logs nothing.
 */
function auditIfChanged(db: D1Database, actor: string | null, s: { id: string; station_id: string; user_id: string | null }, changes: object) {
  return db
    .prepare(
      `insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes)
       select ?, ?, 'charging_sessions', 'update', ?, ?, ?, ? where changes() > 0`,
    )
    .bind(nowIso(), actor, s.id, s.station_id, s.user_id, JSON.stringify(changes));
}

// Tariff ------------------------------------------------------------------------

export async function defaultTariff(db: D1Database): Promise<ChargeTariff> {
  const row = await db.prepare("select value from app_settings where key = 'charge_tariff'").first<{ value: string }>();
  try {
    const t = JSON.parse(row?.value ?? "") as ChargeTariff;
    return validTariff(t) ? t : DEFAULT_CHARGE_TARIFF;
  } catch {
    return DEFAULT_CHARGE_TARIFF;
  }
}

/** The station's own price per kWh and minimum, each falling back to the network default. */
export async function stationTariff(db: D1Database, stationId: string): Promise<ChargeTariff> {
  const [base, row] = await Promise.all([
    defaultTariff(db),
    db.prepare("select charge_kwh_xof, charge_min_xof from stations where id = ?").bind(stationId).first<{ charge_kwh_xof: number | null; charge_min_xof: number | null }>(),
  ]);
  if (!row) throw new ApiError("station_not_found", 404);
  return { kwhXof: row.charge_kwh_xof ?? base.kwhXof, minXof: row.charge_min_xof ?? base.minXof };
}

// Readings from the socket ----------------------------------------------------------

/**
 * Applies one outlet reading to the charge open on that charging point, if any:
 * - energy: the socket reports the energy of its current charge; readings are summed as
 *   deltas, and a reading below the last one (the socket started a new count) adds in full;
 * - "charging" marks that the outlet really draws power;
 * - once it did, "free", "done" or "fault" ends the charge (battery full, unplugged, fault).
 * Paid and cancelled charges no longer change. All SET expressions read the old row.
 */
export function chargeReadingStatement(db: D1Database, pointId: string, status: string | undefined, energyWh: number | undefined, now: string) {
  return db
    .prepare(
      `update charging_sessions set
         energy_wh = case when ?2 is null then energy_wh
                          else energy_wh + case when ?2 >= coalesce(last_reading_wh, 0) then ?2 - coalesce(last_reading_wh, 0) else ?2 end end,
         last_reading_wh = coalesce(?2, last_reading_wh),
         seen_charging = case when ?3 = 'charging' then 1 else seen_charging end,
         status = case when status = 'charging' and seen_charging = 1 and ?3 in ('free', 'done', 'fault') then 'stopped' else status end,
         stopped_at = case when status = 'charging' and seen_charging = 1 and ?3 in ('free', 'done', 'fault') then ?4 else stopped_at end
       where charging_point_id = ?1 and status in ('charging', 'stopped')`,
    )
    .bind(pointId, energyWh ?? null, status ?? null, now);
}

/** Whether a charge runs on this charging point (devices.ts then leaves reservations alone). */
export async function hasOpenCharge(db: D1Database, pointId: string): Promise<boolean> {
  return !!(await db.prepare("select 1 from charging_sessions where charging_point_id = ? and status = 'charging'").bind(pointId).first());
}

// Station staff --------------------------------------------------------------------

async function findCustomer(db: D1Database, raw: unknown): Promise<{ id: string } | null> {
  const text = contactFromCode(String(raw ?? ""));
  if (!text) return null;
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const row = await db
    .prepare(`select id from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<{ id: string }>();
  if (!row) throw new ApiError("recipient_not_found", 404);
  return row;
}

/** POST /api/stations/:id/charging { pointId, contact? }: switches an outlet on for a customer. */
export async function startCharge(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, request: Request): Promise<ChargeSession> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  // A new charge needs the station unlocked for its motorbike outlets (worker/services.ts).
  await requireService(env.DB, stationId, "charging");
  const body = await readJson<{ pointId?: unknown; contact?: unknown }>(request);
  const db = env.DB;
  const point = await db
    .prepare("select id, station_id, label, status, device_id, outlet, last_seen_at from charging_points where id = ?")
    .bind(String(body.pointId ?? ""))
    .first<{ id: string; station_id: string; label: string; status: string; device_id: string | null; outlet: number | null; last_seen_at: string | null }>();
  if (!point || point.station_id !== stationId || !point.device_id || !point.outlet) throw new ApiError("not_found", 404);
  if (!point.last_seen_at || point.last_seen_at <= onlineSince()) throw new ApiError("device_offline", 409);
  if (point.status === "charging" || point.status === "fault") throw new ApiError("charge_busy", 409);
  const customer = await findCustomer(db, body.contact);
  // Staff never charge for themselves through the counter (greenpoints, cash).
  if (customer?.id === user.id) throw new ApiError("own_reservation");

  const tariff = await stationTariff(db, stationId);
  const now = nowIso();
  const id = uuid();
  const row = { id, station_id: stationId, user_id: customer?.id ?? null };
  const statements = [
    db
      .prepare(
        `insert into charging_sessions (id, station_id, charging_point_id, device_id, outlet, point_label, user_id, kwh_xof, min_xof, started_by, started_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, stationId, point.id, point.device_id, point.outlet, point.label, row.user_id, tariff.kwhXof, tariff.minXof, user.id, now),
    // Old values of the previous charge must not show as this one's.
    db.prepare("update charging_points set power_watts = null, energy_wh = null where id = ?").bind(point.id),
    audit(db, user.id, "insert", row, { point: point.label, customer: row.user_id, tariff }),
  ];
  // The customer's slot reservation here is used now; the charge earns the greenpoints.
  if (customer) {
    statements.push(
      db
        .prepare(
          `update reservations set status = 'completed', charging_point_id = ?3
           where id = (select id from reservations where user_id = ?1 and station_id = ?2 and type = 'slot' and status = 'active' order by created_at limit 1)`,
        )
        .bind(customer.id, stationId, point.id),
    );
  }
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("charge_busy", 409);
    throw err;
  }
  try {
    const { order } = await startOutlet(env, point.device_id, point.outlet, user.id);
    await db.prepare("update charging_sessions set order_no = ? where id = ?").bind(order, id).run();
  } catch (err) {
    // The outlet did not switch on: nothing was charged.
    await db.batch([
      db.prepare("update charging_sessions set status = 'cancelled', stopped_at = ?, stopped_by = ? where id = ?").bind(nowIso(), user.id, id),
      audit(db, user.id, "update", row, { status: ["charging", "cancelled"], reason: "start_failed" }),
    ]);
    throw err;
  }
  return toSession(await loadSession(db, id));
}

async function staffSession(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, id: string): Promise<SessionRow> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const s = await loadSession(env.DB, id);
  if (s.station_id !== stationId) throw new ApiError("not_found", 404);
  return s;
}

/** POST /api/stations/:id/charging/:session/stop: switches the outlet off; the price is then final. */
export async function stopCharge(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, id: string): Promise<ChargeSession> {
  const s = await staffSession(env, user, isStaffOf, stationId, id);
  if (s.status !== "charging") return toSession(s);
  try {
    await stopOutlet(env, s.device_id, s.outlet, user.id);
  } catch (err) {
    // OCPP: the charge point already ended its transaction. Anything else stays an error.
    if (!(err instanceof ApiError && err.code === "device_not_charging")) throw err;
  }
  const now = nowIso();
  await env.DB.batch([
    env.DB
      .prepare("update charging_sessions set status = 'stopped', stopped_at = ?, stopped_by = ? where id = ? and status = 'charging'")
      .bind(now, user.id, id),
    auditIfChanged(env.DB, user.id, s, { status: ["charging", "stopped"] }),
  ]);
  return toSession(await loadSession(env.DB, id));
}

/** POST …/cancel: closes a stopped charge that took no energy; there is nothing to pay. */
export async function cancelCharge(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, id: string): Promise<ChargeSession> {
  const s = await staffSession(env, user, isStaffOf, stationId, id);
  if (s.status !== "stopped" || s.energy_wh > 0) throw new ApiError("charge_wrong_status", 409);
  await env.DB.batch([
    env.DB.prepare("update charging_sessions set status = 'cancelled' where id = ? and status = 'stopped' and energy_wh = 0").bind(id),
    auditIfChanged(env.DB, user.id, s, { status: ["stopped", "cancelled"] }),
  ]);
  return toSession(await loadSession(env.DB, id));
}

/**
 * Books a payment: the charge becomes paid with this amount and reference, and in the
 * same batch the greenpoints and the audit row follow (only if this booking was the one that paid it).
 * `extra` runs between the two, e.g. the wallet debit, which also only applies after
 * this update. Returns false when the charge was no longer waiting for payment.
 */
async function bookPayment(
  env: Env,
  s: SessionRow,
  pay: { method: ChargePaymentMethod; amountXof: number; ref: string; by: string | null },
  extra: D1PreparedStatement[] = [],
): Promise<boolean> {
  const db = env.DB;
  const now = nowIso();
  const earned = s.user_id
    ? await chargeEarnStatement(db, {
        userId: s.user_id,
        stationId: s.station_id,
        sessionId: s.id,
        energyWh: s.energy_wh,
        paidRef: pay.ref,
        createdBy: pay.by,
      })
    : null;
  const [paid] = await db.batch([
    db
      .prepare(
        `update charging_sessions set status = 'paid', amount_xof = ?, payment_method = ?, payment_ref = ?, paid_by = ?, paid_at = ?
         where id = ? and status = 'stopped'`,
      )
      .bind(pay.amountXof, pay.method, pay.ref, pay.by, now, s.id),
    // Right after the update: changes() refers to it.
    auditIfChanged(db, pay.by, s, { status: ["stopped", "paid"], amount_xof: pay.amountXof, payment_method: pay.method }),
    ...extra,
    ...(earned ? [earned.statement] : []),
  ]);
  return paid.meta.changes > 0;
}

/** POST …/pay: staff took the cash. */
export async function payCash(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, id: string): Promise<ChargeSession> {
  const s = await staffSession(env, user, isStaffOf, stationId, id);
  if (s.status === "paid") return toSession(s);
  const amount = chargePrice(s.energy_wh, { kwhXof: s.kwh_xof, minXof: s.min_xof });
  if (s.status !== "stopped" || amount <= 0) throw new ApiError("charge_wrong_status", 409);
  if (!(await bookPayment(env, s, { method: "cash", amountXof: amount, ref: uuid(), by: user.id }))) throw new ApiError("charge_wrong_status", 409);
  return toSession(await loadSession(env.DB, id));
}

/** GET /api/stations/:id/charging: open charges, today's charges and today's takings. */
export async function stationCharging(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string): Promise<StationCharging> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const db = env.DB;
  const since = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const day = dayStartLome();
  const [tariff, { results }] = await Promise.all([
    stationTariff(db, stationId),
    db
      .prepare(`${SESSION_SELECT} where cs.station_id = ? and (cs.status in ('charging', 'stopped') or cs.started_at >= ?) order by cs.started_at desc limit 100`)
      .bind(stationId, since)
      .all<SessionRow>(),
  ]);
  const sessions = results.map(toSession);
  const paidToday = sessions.filter((x) => x.status === "paid" && (x.paidAt ?? "") >= day);
  return {
    tariff,
    open: sessions.filter((x) => x.status === "charging" || x.status === "stopped"),
    today: sessions.filter((x) => x.status === "paid" || x.status === "cancelled"),
    takings: {
      cashXof: paidToday.filter((x) => x.paymentMethod === "cash").reduce((a, x) => a + x.amountXof, 0),
      appXof: paidToday.filter((x) => x.paymentMethod !== "cash").reduce((a, x) => a + x.amountXof, 0),
      count: paidToday.length,
    },
  };
}

/** Midnight in Lomé (UTC, no daylight saving). */
function dayStartLome(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// Customer ---------------------------------------------------------------------------

/** Collecting money for third-party operators may need a licence (payments.ts): app payments only at our own stations. */
async function payOptions(env: Env, user: Profile, s: SessionRow): Promise<{ wallet: boolean; mobile: boolean }> {
  if (s.status !== "stopped" || !s.is_own) return { wallet: false, mobile: false };
  const wallet = await walletAccess(env, user).then(
    () => true,
    () => false,
  );
  return { wallet, mobile: mobilePaymentOffered(env, user) };
}

async function customerView(env: Env, user: Profile, s: SessionRow): Promise<ChargeSession> {
  const pending = await env.DB.prepare("select id from payments where charging_session_id = ? and status = 'pending'")
    .bind(s.id)
    .first<{ id: string }>();
  return { ...toSession(s), payOptions: await payOptions(env, user, s), pendingPaymentId: pending?.id ?? null };
}

/** GET /api/charging/mine: the customer's charges, newest first. */
export async function myCharges(env: Env, user: Profile): Promise<ChargeSession[]> {
  const { results } = await env.DB.prepare(`${SESSION_SELECT} where cs.user_id = ? order by cs.started_at desc limit 20`)
    .bind(user.id)
    .all<SessionRow>();
  return Promise.all(results.map((s) => customerView(env, user, s)));
}

async function ownSession(env: Env, user: Profile, id: string): Promise<SessionRow> {
  const s = await loadSession(env.DB, id);
  if (s.user_id !== user.id) throw new ApiError("not_found", 404);
  return s;
}

/** POST /api/charging/:id/pay/wallet { pin, idempotencyKey }: pays from the wallet balance. */
export async function payWithWallet(env: Env, user: Profile, id: string, request: Request): Promise<ChargeSession> {
  const input = await readJson<{ pin?: unknown; idempotencyKey?: unknown }>(request);
  const s = await ownSession(env, user, id);
  if (s.status === "paid") return customerView(env, user, s);
  if (!(await payOptions(env, user, s)).wallet) throw new ApiError("payment_not_offered", 409);
  const amount = chargePrice(s.energy_wh, { kwhXof: s.kwh_xof, minXof: s.min_xof });
  if (amount <= 0) throw new ApiError("charge_wrong_status", 409);
  const key = String(input.idempotencyKey ?? "");
  if (!/^[\w-]{8,64}$/.test(key)) throw new ApiError("bad_request");
  await verifyPin(env, user.id, input.pin);
  const wallet = await env.DB.prepare("select balance_xof, status from wallets where user_id = ?")
    .bind(user.id)
    .first<{ balance_xof: number; status: string }>();
  if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
  if (!wallet || wallet.balance_xof < amount) throw new ApiError("insufficient_balance");

  const db = env.DB;
  const trxId = newTrxId("charge");
  const now = nowIso();
  // Both only apply after the charge became paid with this transaction number, so a
  // second request (or a charge paid meanwhile) takes no money. The balance check
  // makes the whole batch fail when the money is no longer there.
  const mine = "(select payment_ref from charging_sessions where id = ?) = ?";
  const extra = [
    db.prepare(`update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ? and ${mine}`).bind(amount, now, user.id, s.id, trxId),
    db
      .prepare(
        `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
           counterparty_label, idempotency_key, details, created_at)
         select ?1, ?2, ?3, 'charge', 'send', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7, ?8
          where (select payment_ref from charging_sessions where id = ?9) = ?2`,
      )
      .bind(uuid(), trxId, user.id, amount, s.station_name, key, JSON.stringify({ chargingSession: s.id, energyWh: s.energy_wh }), now, s.id),
  ];
  try {
    if (!(await bookPayment(env, s, { method: "wallet", amountXof: amount, ref: trxId, by: user.id }, extra))) throw new ApiError("charge_wrong_status", 409);
  } catch (err) {
    if (/CHECK constraint failed/i.test(String(err))) throw new ApiError("insufficient_balance");
    if (/idempotency_key/.test(String(err))) return customerView(env, user, await loadSession(db, id));
    throw err;
  }
  return customerView(env, user, await loadSession(db, id));
}

/** POST /api/charging/:id/pay/mobile { network, phone }: asks Flooz/T-Money for the money. */
export async function payWithMobile(env: Env, user: Profile, id: string, request: Request): Promise<Payment> {
  const body = await readJson<{ network?: unknown; phone?: unknown }>(request);
  const s = await ownSession(env, user, id);
  if (!(await payOptions(env, user, s)).mobile) throw new ApiError("payment_not_offered", 409);
  const amount = chargePrice(s.energy_wh, { kwhXof: s.kwh_xof, minXof: s.min_xof });
  if (amount <= 0) throw new ApiError("charge_wrong_status", 409);
  return startChargePayment(env, user, { sessionId: s.id, stationId: s.station_id, amountXof: amount }, body);
}

/** Called by payments.ts once Flooz/T-Money confirmed a charge's payment. */
export async function chargePaymentSucceeded(env: Env, p: { id: string; charging_session_id: string; amount_xof: number; network: "flooz" | "tmoney"; user_id: string | null }) {
  const s = await loadSession(env.DB, p.charging_session_id).catch(() => null);
  if (!s || s.status !== "stopped") return;
  await bookPayment(env, s, { method: p.network, amountXof: p.amount_xof, ref: p.id, by: p.user_id });
}

// Backoffice ----------------------------------------------------------------------------

/** GET /api/admin/charging: tariffs and the latest charges. */
export async function adminCharging(env: Env): Promise<AdminCharging> {
  const db = env.DB;
  const [base, stations, { results }, totals] = await Promise.all([
    defaultTariff(db),
    db
      .prepare(
        `select s.id, s.name, s.charge_kwh_xof, s.charge_min_xof,
                (select count(*) from charging_points p where p.station_id = s.id and p.device_id is not null) as outlets
           from stations s order by s.name`,
      )
      .all<{ id: string; name: string; charge_kwh_xof: number | null; charge_min_xof: number | null; outlets: number }>(),
    db.prepare(`${SESSION_SELECT} order by cs.started_at desc limit 200`).all<SessionRow>(),
    db
      .prepare("select coalesce(sum(amount_xof), 0) as paid, coalesce(sum(energy_wh), 0) as energy, count(*) as n from charging_sessions where status = 'paid'")
      .first<{ paid: number; energy: number; n: number }>(),
  ]);
  return {
    defaultTariff: base,
    stations: stations.results.map((s) => ({ id: s.id, name: s.name, kwhXof: s.charge_kwh_xof, minXof: s.charge_min_xof, outlets: s.outlets })),
    sessions: results.map(toSession),
    totals: { paidXof: totals?.paid ?? 0, energyWh: totals?.energy ?? 0, count: totals?.n ?? 0 },
  };
}

function tariffValue(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0 || n > 100_000 || n !== roundUpTo5(n)) throw new ApiError("bad_request");
  return n;
}

/** POST /api/admin/charging/tariff { stationId?, kwhXof, minXof }: the network default, or a station's own price (null = default). */
export async function saveChargeTariff(env: Env, admin: Profile, request: Request) {
  const body = await readJson<{ stationId?: unknown; kwhXof?: unknown; minXof?: unknown }>(request);
  const kwh = tariffValue(body.kwhXof);
  const min = tariffValue(body.minXof);
  const db = env.DB;
  const now = nowIso();
  if (body.stationId === undefined || body.stationId === null) {
    const t = { kwhXof: kwh ?? -1, minXof: min ?? -1 };
    if (!validTariff(t)) throw new ApiError("bad_request");
    await db.batch([
      db
        .prepare(
          `insert into app_settings (key, value, updated_by, updated_at) values ('charge_tariff', ?1, ?2, ?3)
           on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
        )
        .bind(JSON.stringify(t), admin.id, now),
      db
        .prepare("insert into audit_log (at, actor, table_name, action, row_id, changes) values (?, ?, 'charging_sessions', 'update', 'charge_tariff', ?)")
        .bind(now, admin.id, JSON.stringify({ tariff: t })),
    ]);
    return { ok: true };
  }
  if (kwh === 0) throw new ApiError("bad_request");
  const stationId = String(body.stationId);
  const res = await db.batch([
    db.prepare("update stations set charge_kwh_xof = ?, charge_min_xof = ? where id = ?").bind(kwh, min, stationId),
    db
      .prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, ?, 'stations', 'update', ?, ?, ?)",
      )
      .bind(now, admin.id, stationId, stationId, JSON.stringify({ charge_kwh_xof: kwh, charge_min_xof: min })),
  ]);
  if (!res[0].meta.changes) throw new ApiError("station_not_found", 404);
  return { ok: true };
}
