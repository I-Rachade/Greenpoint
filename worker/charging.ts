import {
  chargePrice,
  DEFAULT_CHARGE_TARIFF,
  roundUpTo5,
  validTariff,
  type AdminCharging,
  type ChargePaymentMethod,
  type ChargeSession,
  type ChargeStatus,
  type ChargeOutletInfo,
  type ChargePointState,
  type ChargeTariff,
  type StationCharging,
  contactFromCode,
  validBoxToken,
} from "../src/lib/charging";
import { parseContact } from "../src/lib/contact";
import type { Profile } from "../src/lib/types";
import { newTrxId, personLabel } from "../src/lib/wallet";
import { verifyPin } from "./auth";
import { canSwitch, type DeviceLink, type DeviceProtocol } from "../src/lib/iot/devices";
import { liveFreePointsSql, newBoxToken, onlineSince, startOutlet, stopOutlet } from "./devices";
import type { Env } from "./env";
import { chargeEarnStatement } from "./greenpoint";
import { ApiError, nowIso, readJson, uuid } from "./http";
import { requireService, serviceActive } from "./services";
import { cardBooking, cardTopupsSince } from "./charge-cards";
import { cardStopReached } from "../src/lib/charge-cards";
import { mobilePaymentOffered, startChargePayment, type Payment } from "./payments";
import { isCreditStation, walletAccess } from "./wallet";
import { checkPickupCode, evTargetSql, stillActive, type ReservationRow } from "./reservations";

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
  /** The socket's point partner when the charge started; null: the socket is ours (0039). */
  partner_id: string | null;
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
  started_by: string;
  charge_card: string | null;
  /** Paid from Green Credit (QR code or a card linked to the account): the most it may cost (0047). */
  credit_limit_xof: number | null;
}

const SESSION_SELECT = `
  select cs.*, s.name as station_name, p.power_watts, p.status as point_status,
         u.full_name, u.phone, u.email,
         (select points from greenpoint_ledger g where g.charging_session_id = cs.id) as greenpoints
    from charging_sessions cs
    join stations s on s.id = cs.station_id
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
    ...(r.user_id && r.started_by === r.user_id ? { selfStarted: true } : {}),
    ...(r.charge_card ? { card: r.charge_card } : {}),
    ...(r.credit_limit_xof !== null && r.credit_limit_xof !== undefined ? { creditLimitXof: r.credit_limit_xof } : {}),
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
 * Paid and cancelled charges no longer change, and a stopped one no longer once the next charge
 * runs on the outlet. A reading that names its charge (`transactionId`, Xingke cloud) only
 * applies to that charge. All SET expressions read the old row.
 */
export function chargeReadingStatement(
  db: D1Database,
  pointId: string,
  status: string | undefined,
  energyWh: number | undefined,
  now: string,
  transactionId?: string,
) {
  return db
    .prepare(
      `update charging_sessions set
         energy_wh = case when ?2 is null then energy_wh
                          else energy_wh + case when ?2 >= coalesce(last_reading_wh, 0) then ?2 - coalesce(last_reading_wh, 0) else ?2 end end,
         last_reading_wh = coalesce(?2, last_reading_wh),
         seen_charging = case when ?3 = 'charging' then 1 else seen_charging end,
         status = case when status = 'charging' and seen_charging = 1 and ?3 in ('free', 'done', 'fault') then 'stopped' else status end,
         stopped_at = case when status = 'charging' and seen_charging = 1 and ?3 in ('free', 'done', 'fault') then ?4 else stopped_at end
       where charging_point_id = ?1 and status in ('charging', 'stopped')
         and (status = 'charging' or not exists (select 1 from charging_sessions n where n.charging_point_id = ?1 and n.status = 'charging'))
         and (?5 is null or order_no = ?5 or (order_no is null and status = 'charging'))`,
    )
    .bind(pointId, energyWh ?? null, status ?? null, now, transactionId ?? null);
}

/**
 * The socket refused to start (Xingke CommandResult "Failed"): the charge it opened took no
 * energy, so it is cancelled at no cost and the customer's reservation it used holds again.
 * `order` is the start's transaction id; a charge whose id is not stored yet is the outlet's open one.
 */
export async function chargeStartFailed(db: D1Database, deviceId: string, outlet: number, order: string) {
  const s = await db
    .prepare(
      `select id, station_id, user_id from charging_sessions
        where device_id = ? and outlet = ? and status = 'charging' and energy_wh = 0 and (order_no = ? or order_no is null)`,
    )
    .bind(deviceId, outlet, order)
    .first<{ id: string; station_id: string; user_id: string | null }>();
  if (!s) return;
  const now = nowIso();
  await db.batch([
    db.prepare("update charging_sessions set status = 'cancelled', stopped_at = ? where id = ? and status = 'charging' and energy_wh = 0").bind(now, s.id),
    auditIfChanged(db, null, s, { status: ["charging", "cancelled"], reason: "start_refused" }),
    db
      .prepare(
        `update reservations set status = 'active', charging_point_id = null
          where id = (select r.id from reservations r join charging_sessions cs on cs.id = ?1
                       where r.user_id = cs.user_id and r.station_id = cs.station_id and r.kind = 'charging_point'
                         and r.status = 'completed' and r.charging_point_id = cs.charging_point_id and r.expires_at > ?2
                         and cs.status = 'cancelled' and cs.stopped_at = ?2
                       order by r.created_at desc limit 1)`,
      )
      .bind(s.id, now),
  ]);
}

/**
 * The socket did not carry out a stop (Xingke CommandResult "Failed") and still reports
 * charging: the charge someone stopped runs again, so it can be stopped again and its energy
 * is not billed as if it had ended. Not once a payment for it is under way.
 */
export async function chargeStopFailed(db: D1Database, deviceId: string, outlet: number, order: string) {
  const s = await db
    .prepare(
      `select cs.id, cs.station_id, cs.user_id from charging_sessions cs join charging_points p on p.id = cs.charging_point_id
        where cs.device_id = ? and cs.outlet = ? and cs.order_no = ? and cs.status = 'stopped' and cs.stopped_by is not null
          and p.status = 'charging'
          and not exists (select 1 from payments where charging_session_id = cs.id and status = 'pending')
          and not exists (select 1 from charging_sessions n where n.charging_point_id = cs.charging_point_id and n.status = 'charging')`,
    )
    .bind(deviceId, outlet, order)
    .first<{ id: string; station_id: string; user_id: string | null }>();
  if (!s) return;
  await db.batch([
    db.prepare("update charging_sessions set status = 'charging', stopped_at = null, stopped_by = null where id = ? and status = 'stopped'").bind(s.id),
    auditIfChanged(db, null, s, { status: ["stopped", "charging"], reason: "stop_refused" }),
  ]);
}

/**
 * The socket refused to switch outlet `outlet` on (an OCPP charge point answered our
 * RemoteStartTransaction with Rejected or an error): the charge waiting for it took no
 * energy, so it is cancelled and the reservation it used holds again, as in openCharge.
 * `order` is the start's idTag; the charge may not have it yet if the answer came first.
 */
export async function cancelRefusedStart(db: D1Database, externalId: string, outlet: number, order: string) {
  const s = await db
    .prepare(
      `select id, station_id, charging_point_id, user_id, started_at from charging_sessions
       where device_id = ? and outlet = ? and status = 'charging' and seen_charging = 0 and energy_wh = 0 and (order_no is null or order_no = ?)`,
    )
    .bind(externalId, outlet, order)
    .first<{ id: string; station_id: string; charging_point_id: string | null; user_id: string | null; started_at: string }>();
  if (!s) return;
  const now = nowIso();
  await db.batch([
    db.prepare("update charging_sessions set status = 'cancelled', stopped_at = ? where id = ? and status = 'charging' and seen_charging = 0").bind(now, s.id),
    auditIfChanged(db, null, s, { status: ["charging", "cancelled"], reason: "start_refused" }),
    // The reservation this charge completed (openCharge links it to the outlet), if still valid.
    db
      .prepare(
        `update reservations set status = 'active', charging_point_id = null
         where id = (select id from reservations where user_id = ?1 and charging_point_id = ?2 and status = 'completed' and kind = 'charging_point'
                       and created_at <= ?3 and expires_at > ?4 order by created_at desc limit 1)
           and not exists (select 1 from reservations where user_id = ?1 and status = 'active')
           and exists (select 1 from charging_sessions where id = ?5 and status = 'cancelled')`,
      )
      .bind(s.user_id, s.charging_point_id, s.started_at, now, s.id),
  ]);
}

/** Whether a charge runs on this charging point (devices.ts then leaves reservations alone). */
export async function hasOpenCharge(db: D1Database, pointId: string): Promise<boolean> {
  return !!(await db.prepare("select 1 from charging_sessions where charging_point_id = ? and status = 'charging'").bind(pointId).first());
}

// Station staff --------------------------------------------------------------------

export async function findCustomer(db: D1Database, raw: unknown): Promise<{ id: string } | null> {
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

/**
 * POST /api/stations/:id/charging { pointId, contact? | reservationId + pickupCode }: switches
 * an outlet on for a customer. From a reservation (staff open it from the reservation list,
 * outlet prefilled, another free one can be chosen): the code is checked (locked after 5
 * wrong ones) and starting the charge completes the reservation, exactly once.
 */
export async function startCharge(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, request: Request): Promise<ChargeSession> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  // A new charge needs the station unlocked for its motorbike outlets (worker/services.ts).
  await requireService(env.DB, stationId, "charging");
  const body = await readJson<{ pointId?: unknown; contact?: unknown; reservationId?: unknown; pickupCode?: unknown }>(request);
  const db = env.DB;
  const point = await db
    .prepare("select id, station_id, label, status, device_id, outlet, last_seen_at from charging_points where id = ?")
    .bind(String(body.pointId ?? ""))
    .first<{ id: string; station_id: string; label: string; status: string; device_id: string | null; outlet: number | null; last_seen_at: string | null }>();
  if (!point || point.station_id !== stationId || !point.device_id || !point.outlet) throw new ApiError("not_found", 404);
  if (!point.last_seen_at || point.last_seen_at <= onlineSince()) throw new ApiError("device_offline", 409);
  if (point.status === "charging" || point.status === "fault") throw new ApiError("charge_busy", 409);
  let reservation: ReservationRow | null = null;
  if (body.reservationId) {
    reservation = await db
      .prepare(`select r.*, ${evTargetSql("r")} as is_ev from reservations r where r.id = ?`)
      .bind(String(body.reservationId))
      .first<ReservationRow & { is_ev: number }>();
    // A motorbike outlet reservation of this station; a car charger's has no outlet to start.
    if (!reservation || reservation.station_id !== stationId || reservation.kind !== "charging_point" || (reservation as { is_ev?: number }).is_ev) {
      throw new ApiError("forbidden", 403);
    }
    if (reservation.user_id === user.id) throw new ApiError("own_reservation");
    if (!stillActive(reservation)) throw new ApiError("reservation_not_active");
    await checkPickupCode(db, reservation, body.pickupCode);
  }
  const customer = reservation ? { id: reservation.user_id } : await findCustomer(db, body.contact);
  // Staff never charge for themselves through the counter (greenpoints, cash).
  if (customer?.id === user.id) throw new ApiError("own_reservation");
  return openCharge(env, point as OutletPoint, { customerId: customer?.id ?? null, actorId: user.id, reservation });
}

type OutletPoint = { id: string; station_id: string; label: string; device_id: string; outlet: number };

/**
 * Opens the charge row and switches the outlet on, for staff (startCharge) or the customer
 * (startSelfCharge). A named reservation is completed first and the charge only starts if
 * this request completed it; without one, the customer's charging reservation at the
 * station is used now. If the outlet does not switch on, the charge is cancelled again.
 */
async function openCharge(
  env: Env,
  point: OutletPoint,
  who: { customerId: string | null; actorId: string; reservation: ReservationRow | null; alone?: boolean; creditLimitXof?: number },
): Promise<ChargeSession> {
  const db = env.DB;
  const stationId = point.station_id;
  const { reservation, actorId: actor } = who;
  const tariff = await stationTariff(db, stationId);
  const now = nowIso();
  const id = uuid();
  const row = { id, station_id: stationId, user_id: who.customerId };
  const statements: D1PreparedStatement[] = [];
  if (reservation) {
    // The reservation first: the charge only starts if this request completed it.
    statements.push(
      db
        .prepare("update reservations set status = 'completed', charging_point_id = ? where id = ? and status = 'active'")
        .bind(point.id, reservation.id),
    );
  }
  statements.push(
    db
      .prepare(
        `insert into charging_sessions (id, station_id, charging_point_id, device_id, outlet, point_label, user_id, kwh_xof, min_xof, started_by, started_at,
           credit_limit_xof)
         select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?14 where (?12 = 0 or changes() > 0)
            and (?13 = 0 or not exists (select 1 from charging_sessions where user_id = ?7 and status in ('charging', 'stopped')))`,
      )
      // alone: in the same write as the check, so two starts sent at once cannot both pass it.
      .bind(
        id,
        stationId,
        point.id,
        point.device_id,
        point.outlet,
        point.label,
        row.user_id,
        tariff.kwhXof,
        tariff.minXof,
        actor,
        now,
        reservation ? 1 : 0,
        who.alone ? 1 : 0,
        who.creditLimitXof ?? null,
      ),
    // Old values of the previous charge must not show as this one's.
    db.prepare("update charging_points set power_watts = null, energy_wh = null where id = ? and exists (select 1 from charging_sessions where id = ?)").bind(point.id, id),
    db
      .prepare(
        `insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes)
         select ?, ?, 'charging_sessions', 'insert', ?, ?, ?, ? where exists (select 1 from charging_sessions where id = ?)`,
      )
      .bind(
        nowIso(),
        actor,
        id,
        stationId,
        row.user_id,
        JSON.stringify({
          point: point.label,
          customer: row.user_id,
          tariff,
          reservation: reservation?.id ?? null,
          ...(actor === row.user_id ? { qr: true } : {}),
          ...(who.creditLimitXof !== undefined ? { creditLimitXof: who.creditLimitXof } : {}),
        }),
        id,
      ),
  );
  // Without a reservation named: the customer's charging reservation here is used now (the
  // one for this outlet first, never a car charger's); the charge earns the greenpoints.
  if (who.customerId && !reservation) {
    statements.push(
      db
        .prepare(
          `update reservations set status = 'completed', charging_point_id = ?3
           where id = (select r.id from reservations r where r.user_id = ?1 and r.station_id = ?2 and r.kind = 'charging_point' and r.status = 'active'
                         and not ${evTargetSql("r")} order by (r.target = ?3) desc, r.created_at limit 1)
             and exists (select 1 from charging_sessions where id = ?4)`,
        )
        .bind(who.customerId, stationId, point.id, id),
    );
  }
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("charge_busy", 409);
    throw err;
  }
  if (!(await db.prepare("select 1 from charging_sessions where id = ?").bind(id).first())) {
    throw who.alone ? new ApiError("charge_unpaid", 409) : new ApiError("reservation_not_active");
  }
  try {
    const { order } = await startOutlet(env, point.device_id, point.outlet, actor);
    await db.prepare("update charging_sessions set order_no = ? where id = ?").bind(order, id).run();
  } catch (err) {
    // The outlet did not switch on: nothing was charged, and the reservation holds again.
    await db.batch([
      db.prepare("update charging_sessions set status = 'cancelled', stopped_at = ?, stopped_by = ? where id = ?").bind(nowIso(), actor, id),
      audit(db, actor, "update", row, { status: ["charging", "cancelled"], reason: "start_failed" }),
      ...(reservation
        ? [db.prepare("update reservations set status = 'active', charging_point_id = null where id = ? and status = 'completed'").bind(reservation.id)]
        : []),
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
  return stopSession(env, await staffSession(env, user, isStaffOf, stationId, id), user.id);
}

/**
 * Marks the charge stopped first, so a device's answer to the stop always finds it stopped
 * (a refused stop reopens it, chargeStopFailed), then switches the outlet off. If the command
 * cannot be sent, the charge runs on as before.
 */
async function stopSession(env: Env, s: SessionRow, actor: string): Promise<ChargeSession> {
  if (s.status !== "charging") return toSession(s);
  const db = env.DB;
  const [stopped] = await db.batch([
    db.prepare("update charging_sessions set status = 'stopped', stopped_at = ?, stopped_by = ? where id = ? and status = 'charging'").bind(nowIso(), actor, s.id),
    auditIfChanged(db, actor, s, { status: ["charging", "stopped"] }),
  ]);
  // A double tap that lost the race sends no second stop.
  if (stopped.meta.changes > 0) {
    try {
      await stopOutlet(env, s.device_id, s.outlet, actor);
    } catch (err) {
      // OCPP: the charge point already ended its transaction. Anything else stays an error.
      if (!(err instanceof ApiError && err.code === "device_not_charging")) {
        await db.batch([
          db.prepare("update charging_sessions set status = 'charging', stopped_at = null, stopped_by = null where id = ? and status = 'stopped'").bind(s.id),
          auditIfChanged(db, actor, s, { status: ["stopped", "charging"], reason: "stop_not_sent" }),
        ]);
        throw err;
      }
    }
  }
  return toSession(await loadSession(db, s.id));
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
  db: D1Database,
  s: SessionRow,
  pay: { method: ChargePaymentMethod; amountXof: number; ref: string; by: string | null },
  extra: D1PreparedStatement[] = [],
): Promise<boolean> {
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
  // A card or Green Credit charge pays itself when it ends (settlePrepaidCharges).
  if (s.status !== "stopped" || amount <= 0 || s.charge_card || s.credit_limit_xof !== null) throw new ApiError("charge_wrong_status", 409);
  if (!(await bookPayment(env.DB, s, { method: "cash", amountXof: amount, ref: uuid(), by: user.id }))) throw new ApiError("charge_wrong_status", 409);
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
  // Card charges were paid in advance: the cash came in when the card was topped up here.
  const topups = await cardTopupsSince(db, stationId, day);
  return {
    tariff,
    open: sessions.filter((x) => x.status === "charging" || x.status === "stopped"),
    today: sessions.filter((x) => x.status === "paid" || x.status === "cancelled"),
    takings: {
      cashXof: paidToday.filter((x) => x.paymentMethod === "cash").reduce((a, x) => a + x.amountXof, topups),
      appXof: paidToday.filter((x) => x.paymentMethod !== "cash" && x.paymentMethod !== "card").reduce((a, x) => a + x.amountXof, 0),
      count: paidToday.length,
    },
  };
}

/** Midnight in Lomé (UTC, no daylight saving). */
function dayStartLome(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

// Customer ---------------------------------------------------------------------------

/**
 * The money follows the socket's owner, not the station: our sockets are paid in the app at
 * any station, even a partner's. Collecting for a point partner may need a licence
 * (payments.ts), so their sockets are paid at the counter only. Green Credit pays our sockets
 * at Green Credit stations only (0047). A card or Green Credit charge pays itself.
 */
async function payOptions(env: Env, user: Profile, s: SessionRow): Promise<{ wallet: boolean; mobile: boolean }> {
  if (s.status !== "stopped" || s.partner_id || s.charge_card || s.credit_limit_xof !== null) return { wallet: false, mobile: false };
  const wallet =
    (await isCreditStation(env.DB, s.station_id)) &&
    (await walletAccess(env, user).then(
      () => true,
      () => false,
    ));
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
  await settlePrepaidCharges(env.DB, { userId: user.id, minAgeMs: SETTLE_AFTER_MS });
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
    if (!(await bookPayment(db, s, { method: "wallet", amountXof: amount, ref: trxId, by: user.id }, extra))) throw new ApiError("charge_wrong_status", 409);
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
  await bookPayment(env.DB, s, { method: p.network, amountXof: p.amount_xof, ref: p.id, by: p.user_id });
}

// Charging by QR code ------------------------------------------------------------------

interface QrPointRow {
  id: string;
  station_id: string;
  station_name: string;
  label: string;
  status: string;
  device_id: string | null;
  outlet: number | null;
  last_seen_at: string | null;
  qr_start: number;
  vendor: string | null;
  link: DeviceLink | null;
  protocol: DeviceProtocol | null;
  /** The socket's point partner; null: ours. */
  partner_id: string | null;
  green_credit: number;
}

const QR_POINT_SQL = `select p.id, p.station_id, s.name as station_name, p.label, p.status, p.device_id, p.outlet, p.last_seen_at, p.qr_start,
              d.vendor, d.link, d.protocol, d.partner_id, s.green_credit
         from charging_points p join stations s on s.id = p.station_id left join devices d on d.external_id = p.device_id`;

async function loadQrPoint(db: D1Database, pointId: string): Promise<QrPointRow> {
  const p = await db.prepare(`${QR_POINT_SQL} where p.id = ? and s.is_active = 1`).bind(pointId).first<QrPointRow>();
  if (!p || !p.device_id || !p.outlet) throw new ApiError("not_found", 404);
  return p;
}

/** Whether someone else holds this outlet: a reservation naming it, or the station's last free places counted for reservations without an outlet. */
async function heldForOthers(db: D1Database, p: QrPointRow, userId: string | null): Promise<boolean> {
  const now = nowIso();
  const row = await db
    .prepare(
      `select
         exists (select 1 from reservations where kind = 'charging_point' and target = ?1 and status = 'active' and expires_at > ?3 and user_id is not ?4) as named,
         ${liveFreePointsSql("?2", "?5")}
           - (select count(*) from reservations r where r.station_id = ?2 and r.kind = 'charging_point' and r.status = 'active' and r.expires_at > ?3
                and r.target is null and r.user_id is not ?4) as spare`,
    )
    .bind(p.id, p.station_id, now, userId, onlineSince())
    .first<{ named: number; spare: number }>();
  return !!row?.named || (row?.spare ?? 0) <= 0;
}

/**
 * Green Credit pays a QR charge only on a socket of ours at a Green Credit station (0047). The
 * same owner rule as a card (openCardCharge): a point partner's socket is paid at the counter.
 */
function creditAcceptedAt(p: Pick<QrPointRow, "partner_id" | "green_credit">): boolean {
  return !!p.green_credit && !p.partner_id;
}

async function qrPointState(db: D1Database, p: QrPointRow, userId: string | null): Promise<ChargePointState> {
  if (!p.qr_start || !creditAcceptedAt(p) || !canSwitch({ externalId: p.device_id!, vendor: p.vendor ?? "", link: p.link ?? "lorawan", protocol: p.protocol })) {
    return "disabled";
  }
  if (!p.last_seen_at || p.last_seen_at <= onlineSince()) return "offline";
  if (p.status === "fault") return "fault";
  if (p.status === "charging" || (await hasOpenCharge(db, p.id))) return "busy";
  if (p.status !== "free" && p.status !== "done" && p.status !== "reserved") return "busy";
  return (await heldForOthers(db, p, userId)) ? "reserved" : "free";
}

/**
 * The customer switches one outlet on themselves (startOutletCharge, after scanning the box's
 * QR code) and pays in advance from Green Credit (0047): the PIN typed on their phone, a socket
 * of ours at a Green Credit station, a credit that covers at least the station's minimum price.
 * The charge may cost at most the balance; it stops there (creditStops) and the price is taken
 * from the credit when it ends (settlePrepaidCharges). Only on a live free outlet nobody else
 * holds, and only with no other charge of the customer running or waiting for payment.
 */
export async function startSelfCharge(env: Env, user: Profile, pointId: string, pin: unknown): Promise<ChargeSession> {
  return selfCharge(env, user, await loadQrPoint(env.DB, pointId), pin);
}

async function selfCharge(env: Env, user: Profile, p: QrPointRow, pin: unknown): Promise<ChargeSession> {
  const db = env.DB;
  await requireService(db, p.station_id, "charging");
  if (!p.qr_start) throw new ApiError("charge_qr_disabled", 403);
  if (!creditAcceptedAt(p)) throw new ApiError("credit_not_accepted", 409);
  await walletAccess(env, user);
  await verifyPin(env, user.id, pin);
  await closeEmptyCharges(db, user.id);
  // A Green Credit charge just ended is paid now, so it does not hold up the next one.
  await settlePrepaidCharges(db, { userId: user.id });
  const open = await db
    .prepare("select 1 from charging_sessions where user_id = ? and status in ('charging', 'stopped')")
    .bind(user.id)
    .first();
  if (open) throw new ApiError("charge_unpaid", 409);
  const state = await qrPointState(db, p, user.id);
  if (state === "disabled") throw new ApiError("charge_qr_disabled", 403);
  if (state === "offline") throw new ApiError("device_offline", 409);
  if (state === "reserved") throw new ApiError("point_reserved", 409);
  if (state !== "free") throw new ApiError("charge_busy", 409);
  const wallet = await db.prepare("select balance_xof, status from wallets where user_id = ?").bind(user.id).first<{ balance_xof: number; status: string }>();
  if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
  const tariff = await stationTariff(db, p.station_id);
  const balance = wallet?.balance_xof ?? 0;
  if (balance < Math.max(tariff.minXof, MIN_PREPAID_XOF)) throw new ApiError("insufficient_balance");
  return openCharge(env, { id: p.id, station_id: p.station_id, label: p.label, device_id: p.device_id!, outlet: p.outlet! }, {
    customerId: user.id,
    actorId: user.id,
    reservation: null,
    alone: true,
    creditLimitXof: balance,
  });
}

/** The outlets of the box behind a QR token (devices.qr_token), by outlet number; unknown or inactive: 404. */
async function loadBoxPoints(db: D1Database, token: string): Promise<QrPointRow[]> {
  if (!validBoxToken(token)) throw new ApiError("not_found", 404);
  const { results } = await db
    .prepare(`${QR_POINT_SQL} where d.qr_token = ? and p.station_id = d.station_id and s.is_active = 1 and p.outlet is not null order by p.outlet`)
    .bind(token)
    .all<QrPointRow>();
  if (!results.length) throw new ApiError("not_found", 404);
  return results;
}

/**
 * GET /api/charging/outlets/:token: what the box's QR code shows, also before signing in:
 * the station, the price and every outlet with whether it can be started now. Nobody's name
 * or contact, only "in use" or "reserved".
 */
export async function outletInfo(env: Env, user: Profile | null, token: string): Promise<ChargeOutletInfo> {
  const db = env.DB;
  const points = await loadBoxPoints(db, token);
  const userId = user?.id ?? null;
  const balance = userId
    ? await db.prepare("select balance_xof from wallets where user_id = ?").bind(userId).first<{ balance_xof: number }>()
    : null;
  const [outlets, tariff] = await Promise.all([
    Promise.all(
      points.map(async (p) => {
        const state = await qrPointState(db, p, userId);
        const yours = state === "free" && !!userId && (await heldByMe(db, p.id, userId));
        return { pointId: p.id, label: p.label, outlet: p.outlet!, state, ...(yours ? { yours: true } : {}) };
      }),
    ),
    stationTariff(db, points[0].station_id),
  ]);
  const first = points[0];
  return {
    label: first.device_id!.slice(-4),
    stationId: first.station_id,
    stationName: first.station_name,
    tariff,
    outlets,
    creditAccepted: creditAcceptedAt(first),
    ...(userId ? { balanceXof: balance?.balance_xof ?? 0 } : {}),
  };
}

async function heldByMe(db: D1Database, pointId: string, userId: string): Promise<boolean> {
  return !!(await db
    .prepare("select 1 from reservations where kind = 'charging_point' and target = ? and status = 'active' and expires_at > ? and user_id = ?")
    .bind(pointId, nowIso(), userId)
    .first());
}

/**
 * POST /api/charging/outlets/:token/start { pointId }: the customer picked one outlet of the
 * scanned box. The outlet must belong to that box; then the same checks as one outlet's QR code.
 */
export async function startOutletCharge(env: Env, user: Profile, token: string, request: Request): Promise<ChargeSession> {
  const { pointId, pin } = await readJson<{ pointId?: unknown; pin?: unknown }>(request);
  const p = (await loadBoxPoints(env.DB, token)).find((x) => x.id === pointId);
  if (!p) throw new ApiError("not_found", 404);
  return selfCharge(env, user, p, pin);
}

/** POST /api/admin/devices/:id/qr: a new QR token for the box; the old sticker stops working. */
export async function renewOutletQr(env: Env, admin: Profile, externalId: string): Promise<{ qrToken: string }> {
  const db = env.DB;
  const d = await db.prepare("select station_id from devices where external_id = ?").bind(externalId).first<{ station_id: string }>();
  if (!d) throw new ApiError("not_found", 404);
  const qrToken = newBoxToken();
  await db.batch([
    db.prepare("update devices set qr_token = ? where external_id = ?").bind(qrToken, externalId),
    db
      .prepare("insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, ?, 'devices', 'update', ?, ?, ?)")
      .bind(nowIso(), admin.id, externalId, d.station_id, JSON.stringify({ qr_token: "renewed" })),
  ]);
  return { qrToken };
}

/** A stopped charge that took no energy has nothing to pay: it is closed, not held against the customer. */
async function closeEmptyCharges(db: D1Database, userId: string) {
  const { results: empty } = await db
    .prepare("select id, station_id, user_id from charging_sessions where user_id = ? and status = 'stopped' and energy_wh = 0")
    .bind(userId)
    .all<{ id: string; station_id: string; user_id: string | null }>();
  for (const e of empty) {
    await db.batch([
      db.prepare("update charging_sessions set status = 'cancelled' where id = ? and status = 'stopped' and energy_wh = 0").bind(e.id),
      auditIfChanged(db, userId, e, { status: ["stopped", "cancelled"], reason: "no_energy" }),
    ]);
  }
}

// Charging by card and by Green Credit -------------------------------------------------------

/** The least a prepaid charge may start with (a card's or the credit's balance), in FCFA. */
const MIN_PREPAID_XOF = 5;
/** A Green Credit charge stopped this long ago has its final energy (sockets without OCPP). */
const SETTLE_AFTER_MS = 60_000;

/**
 * Whether a socket is ours (no point partner). Only then may a card or Green Credit pay for it
 * (0047): collecting for a point partner may need a licence, so their sockets are paid at the counter.
 */
export async function socketIsOurs(db: D1Database, deviceId: string): Promise<boolean> {
  const d = await db.prepare("select partner_id from devices where external_id = ?").bind(deviceId).first<{ partner_id: string | null }>();
  return !!d && !d.partner_id;
}

/**
 * What a card linked to an account may spend now: the account's Green Credit at a Green Credit
 * station, when the credit is not frozen and no other Green Credit charge of the account is
 * running or waiting to be paid (0047). Null when it may not charge.
 */
export async function linkedCardCredit(db: D1Database, userId: string, stationId: string): Promise<number | null> {
  if (!(await isCreditStation(db, stationId))) return null;
  const [wallet, open] = await Promise.all([
    db.prepare("select balance_xof, status from wallets where user_id = ?").bind(userId).first<{ balance_xof: number; status: string }>(),
    db.prepare("select 1 from charging_sessions where user_id = ? and credit_limit_xof is not null and status in ('charging', 'stopped')").bind(userId).first(),
  ]);
  if (!wallet || wallet.status === "frozen" || open) return null;
  const minimum = Math.max(MIN_PREPAID_XOF, (await stationTariff(db, stationId)).minXof);
  return wallet.balance_xof >= minimum ? wallet.balance_xof : null;
}

/**
 * A card with enough credit started a charge at an OCPP charge point (StartTransaction, after
 * swipeCard in worker/charge-cards.ts accepted it): opens the card's charge on that outlet,
 * the card owner's if it has one (then it shows in their app and can be stopped there). A card
 * linked to an account pays with the account's Green Credit (0047): the charge may cost at most
 * the balance. The charge point already switched on, so nothing is sent. False when the outlet
 * cannot take it: unknown outlet, a point partner's socket, station without charging, outlet
 * reserved for someone else, a charge already open on it, or no credit to spend.
 */
export async function openCardCharge(db: D1Database, deviceId: string, outlet: number, card: { tag: string; userId: string | null }): Promise<boolean> {
  const p = await db
    .prepare(
      `select p.id, p.station_id, p.label from charging_points p join stations s on s.id = p.station_id
        where p.device_id = ? and p.outlet = ? and s.is_active = 1`,
    )
    .bind(deviceId, outlet)
    .first<{ id: string; station_id: string; label: string }>();
  if (!p || !(await serviceActive(db, p.station_id, "charging"))) return false;
  if (!(await socketIsOurs(db, deviceId))) return false;
  const creditLimit = card.userId ? await linkedCardCredit(db, card.userId, p.station_id) : null;
  if (card.userId && creditLimit === null) return false;
  const now = nowIso();
  const held = await db
    .prepare("select 1 from reservations where kind = 'charging_point' and target = ? and status = 'active' and expires_at > ? and user_id is not ?")
    .bind(p.id, now, card.userId)
    .first();
  if (held) return false;
  const tariff = await stationTariff(db, p.station_id);
  const id = uuid();
  const actor = card.userId ?? `card:${card.tag}`;
  const statements = [
    db
      .prepare(
        `insert into charging_sessions (id, station_id, charging_point_id, device_id, outlet, point_label, order_no, user_id, kwh_xof, min_xof, started_by, started_at,
           charge_card, credit_limit_xof)
         values (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?7, ?13)`,
      )
      .bind(id, p.station_id, p.id, deviceId, outlet, p.label, card.tag, card.userId, tariff.kwhXof, tariff.minXof, actor, now, creditLimit),
    // Old values of the previous charge must not show as this one's.
    db.prepare("update charging_points set power_watts = null, energy_wh = null where id = ?").bind(p.id),
    audit(db, actor, "insert", { id, station_id: p.station_id, user_id: card.userId }, {
      point: p.label,
      customer: card.userId,
      tariff,
      card: card.tag,
      ...(creditLimit !== null ? { creditLimitXof: creditLimit } : {}),
    }),
  ];
  if (card.userId) {
    // The card owner's charging reservation here is used now, as in openCharge.
    statements.push(
      db
        .prepare(
          `update reservations set status = 'completed', charging_point_id = ?3
           where id = (select r.id from reservations r where r.user_id = ?1 and r.station_id = ?2 and r.kind = 'charging_point' and r.status = 'active'
                         and not ${evTargetSql("r")} order by (r.target = ?3) desc, r.created_at limit 1)`,
        )
        .bind(card.userId, p.station_id, p.id),
    );
  }
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) return false;
    throw err;
  }
  return true;
}

/** The prepaid charges of a device: a card's (its balance) or Green Credit's (the limit set when it started). */
const PREPAID_LIMIT_SQL = "coalesce(cs.credit_limit_xof, c.balance_xof)";
const PREPAID_WHERE = "(cs.charge_card is not null or cs.credit_limit_xof is not null)";

/**
 * Prepaid charges on this OCPP charge point (a card's or Green Credit's) whose credit is used
 * up, with their open OCPP transaction, for the caller to send RemoteStopTransaction. A running
 * one is marked stopped (by "card" or "credit") first. One the charge point still has not ended
 * (the stop got lost when the connection dropped) is returned again, at most once a minute,
 * until its transaction closes.
 */
export async function cardStops(db: D1Database, deviceId: string): Promise<{ sessionId: string; outlet: number; transactionId: number }[]> {
  const { results } = await db
    .prepare(
      `select * from (
         select cs.id, cs.station_id, cs.user_id, cs.outlet, cs.status, cs.energy_wh, cs.kwh_xof, cs.credit_limit_xof, ${PREPAID_LIMIT_SQL} as limit_xof,
                (select t.id from ocpp_transactions t where t.external_id = cs.device_id and t.connector_id = cs.outlet and t.stopped_at is null
                  order by t.id desc limit 1) as transaction_id
           from charging_sessions cs left join charge_cards c on c.id_tag = cs.charge_card
          where cs.device_id = ?1 and ${PREPAID_WHERE}
            and (cs.status = 'charging' or (cs.status = 'stopped' and cs.stopped_by in ('card', 'credit')))
       ) x
       where transaction_id is not null and limit_xof is not null
         and not exists (select 1 from device_commands d where d.external_id = ?1 and d.kind = 'stop' and d.order_no = cast(x.transaction_id as text)
                           and d.created_at > ?2)`,
    )
    .bind(deviceId, new Date(Date.now() - 60_000).toISOString())
    .all<{
      id: string;
      station_id: string;
      user_id: string | null;
      outlet: number;
      status: ChargeStatus;
      energy_wh: number;
      kwh_xof: number;
      credit_limit_xof: number | null;
      limit_xof: number;
      transaction_id: number;
    }>();
  const stops = [];
  for (const r of results) {
    if (r.status === "charging") {
      if (!cardStopReached(r.energy_wh, r.kwh_xof, r.limit_xof)) continue;
      const by = r.credit_limit_xof !== null ? "credit" : "card";
      const [stopped] = await db.batch([
        db.prepare("update charging_sessions set status = 'stopped', stopped_at = ?, stopped_by = ? where id = ? and status = 'charging'").bind(nowIso(), by, r.id),
        auditIfChanged(db, null, r, { status: ["charging", "stopped"], reason: by === "credit" ? "green_credit_used" : "card_credit_used" }),
      ]);
      if (stopped.meta.changes === 0) continue;
    }
    stops.push({ sessionId: r.id, outlet: r.outlet, transactionId: r.transaction_id });
  }
  return stops;
}

/**
 * After readings from a socket that is not OCPP (LoRa, vendor cloud; OCPP: cardStops and
 * settleCardCharges in worker/ocpp.ts): stops each Green Credit charge whose credit is used up,
 * then pays the ones that ended a while ago. Never throws: a reading must not fail because of it.
 */
export async function creditFollowUp(env: Env, externalId: string) {
  const db = env.DB;
  try {
    const device = await db.prepare("select protocol from devices where external_id = ?").bind(externalId.toUpperCase()).first<{ protocol: string | null }>();
    if (!device || device.protocol === "ocpp1.6") return;
    const { results } = await db
      .prepare(`${SESSION_SELECT} where cs.device_id = ? and cs.status = 'charging' and cs.credit_limit_xof is not null`)
      .bind(externalId.toUpperCase())
      .all<SessionRow>();
    for (const s of results) {
      if (!cardStopReached(s.energy_wh, s.kwh_xof, s.credit_limit_xof!)) continue;
      await stopSession(env, s, "credit").catch((err) => console.error("green credit stop", s.id, err));
    }
    await settlePrepaidCharges(db, { deviceId: externalId.toUpperCase(), minAgeMs: SETTLE_AFTER_MS });
  } catch (err) {
    console.error("green credit follow-up", externalId, err);
  }
}

/** Pays the card and Green Credit charges on this OCPP charge point that have ended (settlePrepaidCharges). */
export async function settleCardCharges(db: D1Database, deviceId: string) {
  await settlePrepaidCharges(db, { deviceId });
}

/**
 * Pays prepaid charges that have ended (an OCPP charge point closed its transaction, so the
 * energy is final; elsewhere stopped at least `minAgeMs` ago), of one device or one customer:
 * - a card's from the card's credit: the price, at least the station's minimum, even if that
 *   takes the balance below 0 after a late stop;
 * - Green Credit's (QR code, or a card linked to an account) from the account's credit: the
 *   price, but never more than the balance (a late stop costs poinderecharge the difference).
 * A charge that took no energy is cancelled at no cost.
 */
export async function settlePrepaidCharges(db: D1Database, filter: { deviceId?: string; userId?: string; minAgeMs?: number }) {
  const where = [`cs.status = 'stopped'`, PREPAID_WHERE];
  const params: unknown[] = [];
  if (filter.deviceId) {
    where.push("cs.device_id = ?");
    params.push(filter.deviceId);
  }
  if (filter.userId) {
    where.push("cs.user_id = ?");
    params.push(filter.userId);
  }
  if (filter.minAgeMs) {
    where.push("cs.stopped_at <= ?");
    params.push(new Date(Date.now() - filter.minAgeMs).toISOString());
  }
  const { results } = await db
    .prepare(
      `${SESSION_SELECT} where ${where.join(" and ")}
         and not exists (select 1 from ocpp_transactions t where t.external_id = cs.device_id and t.connector_id = cs.outlet and t.stopped_at is null)`,
    )
    .bind(...params)
    .all<SessionRow>();
  for (const s of results) {
    const amount = chargePrice(s.energy_wh, { kwhXof: s.kwh_xof, minXof: s.min_xof });
    if (amount <= 0) {
      await db.batch([
        db.prepare("update charging_sessions set status = 'cancelled' where id = ? and status = 'stopped' and energy_wh = 0").bind(s.id),
        auditIfChanged(db, null, s, { status: ["stopped", "cancelled"], reason: "no_energy" }),
      ]);
      continue;
    }
    if (s.credit_limit_xof !== null && s.user_id) {
      await payFromCredit(db, s, amount);
      continue;
    }
    if (!s.charge_card) continue;
    const ref = uuid();
    // Only once the charge became paid with this reference: a second run takes nothing.
    const mine = { sql: "(select payment_ref from charging_sessions where id = ?) = ?", params: [s.id, ref] };
    await bookPayment(db, s, { method: "card", amountXof: amount, ref, by: null }, [
      ...cardBooking(db, { tag: s.charge_card, type: "charge", amountXof: -amount, stationId: s.station_id, sessionId: s.id, by: null }, mine),
    ]);
  }
}

/** Takes an ended Green Credit charge from the customer's credit, at most the balance. */
async function payFromCredit(db: D1Database, s: SessionRow, price: number) {
  const wallet = await db.prepare("select balance_xof from wallets where user_id = ?").bind(s.user_id).first<{ balance_xof: number }>();
  const amount = Math.max(0, Math.min(price, wallet?.balance_xof ?? 0));
  const trxId = newTrxId("charge");
  const now = nowIso();
  // Both only apply after the charge became paid with this transaction number.
  const mine = "(select payment_ref from charging_sessions where id = ?) = ?";
  const extra =
    amount > 0
      ? [
          db.prepare(`update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ? and ${mine}`).bind(amount, now, s.user_id, s.id, trxId),
          db
            .prepare(
              `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
                 counterparty_label, details, created_at)
               select ?1, ?2, ?3, 'charge', 'send', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7
                where (select payment_ref from charging_sessions where id = ?8) = ?2`,
            )
            .bind(
              uuid(),
              trxId,
              s.user_id,
              amount,
              s.station_name,
              JSON.stringify({ chargingSession: s.id, energyWh: s.energy_wh, ...(amount < price ? { priceXof: price } : {}), ...(s.charge_card ? { card: s.charge_card } : {}) }),
              now,
              s.id,
            ),
        ]
      : [];
  try {
    await bookPayment(db, s, { method: "wallet", amountXof: amount, ref: trxId, by: null }, extra);
  } catch (err) {
    // Spent meanwhile by another payment: the next run takes what is left.
    if (!/CHECK constraint failed/i.test(String(err))) throw err;
  }
}

/** POST /api/charging/:id/stop: the customer ends a charge they started by QR code or card. */
export async function stopSelfCharge(env: Env, user: Profile, id: string): Promise<ChargeSession> {
  const s = await ownSession(env, user, id);
  if (s.started_by !== user.id) throw new ApiError("forbidden", 403);
  await stopSession(env, s, user.id);
  return customerView(env, user, await loadSession(env.DB, id));
}

/** POST /api/admin/charging-points/:id/qr { enabled }: allows or forbids charging by QR code at this outlet. */
export async function setQrStart(env: Env, admin: Profile, pointId: string, request: Request) {
  const { enabled } = await readJson<{ enabled?: unknown }>(request);
  if (typeof enabled !== "boolean") throw new ApiError("bad_request");
  const db = env.DB;
  const p = await db
    .prepare("select station_id, qr_start from charging_points where id = ? and device_id is not null")
    .bind(pointId)
    .first<{ station_id: string; qr_start: number }>();
  if (!p) throw new ApiError("not_found", 404);
  if (!!p.qr_start === enabled) return { ok: true };
  await db.batch([
    db.prepare("update charging_points set qr_start = ? where id = ?").bind(enabled ? 1 : 0, pointId),
    db
      .prepare("insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, ?, 'charging_points', 'update', ?, ?, ?)")
      .bind(nowIso(), admin.id, pointId, p.station_id, JSON.stringify({ qr_start: [!!p.qr_start, enabled] })),
  ]);
  return { ok: true };
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

/**
 * POST /api/admin/charging/tariff { stationId?, kwhXof, minXof }: the network default, or a
 * station's own price (null = default). Validated first; the log keeps old and new values.
 */
export async function saveChargeTariff(env: Env, admin: Profile, request: Request) {
  const body = await readJson<{ stationId?: unknown; kwhXof?: unknown; minXof?: unknown }>(request);
  const kwh = tariffValue(body.kwhXof);
  const min = tariffValue(body.minXof);
  const db = env.DB;
  const now = nowIso();
  if (body.stationId === undefined || body.stationId === null) {
    const t = { kwhXof: kwh ?? -1, minXof: min ?? -1 };
    if (!validTariff(t)) throw new ApiError("bad_request");
    const before = await defaultTariff(db);
    if (before.kwhXof === t.kwhXof && before.minXof === t.minXof) return { ok: true };
    await db.batch([
      db
        .prepare(
          `insert into app_settings (key, value, updated_by, updated_at) values ('charge_tariff', ?1, ?2, ?3)
           on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
        )
        .bind(JSON.stringify(t), admin.id, now),
      db
        .prepare("insert into audit_log (at, actor, table_name, action, row_id, changes) values (?, ?, 'charging_sessions', 'update', 'charge_tariff', ?)")
        .bind(now, admin.id, JSON.stringify({ tariff: [before, t] })),
    ]);
    return { ok: true };
  }
  // A station price of 0 per kWh would give charges away (stations.charge_kwh_xof > 0).
  if (kwh === 0) throw new ApiError("bad_request");
  const stationId = String(body.stationId);
  const before = await db
    .prepare("select charge_kwh_xof, charge_min_xof from stations where id = ?")
    .bind(stationId)
    .first<{ charge_kwh_xof: number | null; charge_min_xof: number | null }>();
  if (!before) throw new ApiError("station_not_found", 404);
  const changes: Record<string, [number | null, number | null]> = {};
  if (before.charge_kwh_xof !== kwh) changes.charge_kwh_xof = [before.charge_kwh_xof, kwh];
  if (before.charge_min_xof !== min) changes.charge_min_xof = [before.charge_min_xof, min];
  if (!Object.keys(changes).length) return { ok: true };
  await db.batch([
    db.prepare("update stations set charge_kwh_xof = ?, charge_min_xof = ? where id = ?").bind(kwh, min, stationId),
    db
      .prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, ?, 'stations', 'update', ?, ?, ?)",
      )
      .bind(now, admin.id, stationId, stationId, JSON.stringify(changes)),
  ]);
  return { ok: true };
}
