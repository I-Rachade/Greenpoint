// Station work (plan phase 3): battery counter, swaps with their log, active station.
// Shared rules and types in src/lib/station-work.ts; tables in migrations 0027 and 0028.
//
// Every write here is one D1 batch (one transaction). The statements after the first
// event only take effect while that event was written ("where exists ... request_id"),
// so a refused step (no full battery, capacity reached) leaves nothing behind, and a
// repeated request id breaks the unique index and changes nothing (R5).

import { parseContact } from "../src/lib/contact";
import { contactFromCode } from "../src/lib/charging";
import { parseDriverBadge } from "../src/lib/drivers";
import {
  ACTIVE_STATION_HEADER,
  cleanBatteryLabel,
  cleanReason,
  dayStartLome,
  isSwapCustomerType,
  takesBatteryIn,
  validAmount,
  validCorrection,
  validRequestId,
  type BatteryEventInput,
  type BatteryEventType,
  type BatteryEventView,
  type CounterKey,
  type CounterRow,
  type StationCounter,
  type StationRole,
  type SwapCustomerType,
  type SwapEntry,
  type SwapFilter,
  type SwapInput,
  type SwapPayment,
} from "../src/lib/station-work";
import type { Profile } from "../src/lib/types";
import { newTrxId, personLabel } from "../src/lib/wallet";
import { verifyPin } from "./auth";
import type { Env } from "./env";
import { featuresOf } from "./features";
import { earnStatement } from "./greenpoint";
import { ApiError, nowIso, uuid } from "./http";
import { DB_CUSTOMER } from "./roles";
import { requireService } from "./services";
import { walletAccess } from "./wallet";
import { checkPickupCode, heldBatteriesSql, stillActive, type ReservationRow } from "./reservations";

export interface WorkCtx {
  env: Env;
  db: D1Database;
  request: Request;
  requireUser(): Promise<Profile>;
}

export interface StationActor {
  user: Profile;
  role: StationRole;
}

// Active station (W3, W4, R7) -------------------------------------------------------

/** The station the request says the person works at now (header), if any. */
function activeStationOf(c: WorkCtx): string | null {
  return c.request.headers.get(ACTIVE_STATION_HEADER)?.trim() || null;
}

/** The viewer's role at a station, or null without rights there. Staff work at the stations they are assigned to. */
export async function roleAtStation(db: D1Database, user: Profile, stationId: string): Promise<StationRole | null> {
  if (user.role === "admin") return "admin";
  if (user.role !== "operator") return null;
  const row = await db
    .prepare(
      `select exists (select 1 from stations s join operator_owners o on o.operator_id = s.operator_id where s.id = ?1 and o.user_id = ?2) as owner,
              exists (select 1 from station_staff where station_id = ?1 and user_id = ?2) as staff`,
    )
    .bind(stationId, user.id)
    .first<{ owner: number; staff: number }>();
  return row?.owner ? "owner" : row?.staff ? "staff" : null;
}

/**
 * Who acts at the station, and as what. 403 without rights there (staff of another
 * station, riders, drivers, fleet managers). 409 when the active station sent with the
 * request is missing or another one: owners and admins must always send it; staff only
 * when they are assigned to several stations (one station is their active station).
 */
export async function stationActor(c: WorkCtx, stationId: string): Promise<StationActor> {
  const user = await c.requireUser();
  const role = await roleAtStation(c.db, user, stationId);
  if (!role) throw new ApiError("forbidden", 403);
  const station = await c.db.prepare("select is_active from stations where id = ?").bind(stationId).first<{ is_active: number }>();
  if (!station?.is_active) throw new ApiError("station_not_found", 404);
  const active = activeStationOf(c);
  if (active === stationId) return { user, role };
  if (role === "staff" && active === null) {
    const n = await c.db.prepare("select count(*) as n from station_staff where user_id = ?").bind(user.id).first<{ n: number }>();
    if ((n?.n ?? 0) <= 1) return { user, role };
  }
  throw new ApiError("active_station_required", 409);
}

/** Read access (counter page, swap log): anyone with rights at the station, no active station needed. */
async function stationReader(c: WorkCtx, stationId: string): Promise<StationActor> {
  const user = await c.requireUser();
  const role = await roleAtStation(c.db, user, stationId);
  if (!role) throw new ApiError("forbidden", 403);
  return { user, role };
}

// Counter ------------------------------------------------------------------------------

interface StationInfo {
  id: string;
  name: string;
  battery_capacity: number;
  price_battery_xof: number | null;
  is_own: number | null;
}

async function stationInfo(db: D1Database, stationId: string): Promise<StationInfo> {
  const s = await db
    .prepare("select s.id, s.name, s.battery_capacity, s.price_battery_xof, o.is_own from stations s left join operators o on o.id = s.operator_id where s.id = ?")
    .bind(stationId)
    .first<StationInfo>();
  if (!s) throw new ApiError("station_not_found", 404);
  return s;
}

/** The battery types the station swaps (id and label); empty = one counter for the station. */
async function stationTypes(db: D1Database, stationId: string) {
  const { results } = await db
    .prepare(
      `select sbt.battery_type_id as id, sbt.full_batteries, t.brand, t.name from station_battery_types sbt
       join battery_types t on t.id = sbt.battery_type_id where sbt.station_id = ? order by t.brand, t.name`,
    )
    .bind(stationId)
    .all<{ id: string; full_batteries: number; brand: string; name: string }>();
  return results.map((r) => ({ id: r.id, full: r.full_batteries, label: `${r.brand} ${r.name}` }));
}

/** The counter a request means: a type the station swaps, or "" at a station without types (one type: that one). */
async function counterKey(db: D1Database, stationId: string, raw: unknown): Promise<CounterKey> {
  const types = await stationTypes(db, stationId);
  const wanted = raw === undefined || raw === null ? "" : String(raw);
  if (!types.length) {
    if (wanted !== "") throw new ApiError("bad_request");
    return "";
  }
  if (wanted === "") {
    if (types.length === 1) return types[0].id;
    throw new ApiError("battery_type_required");
  }
  if (!types.some((t) => t.id === wanted)) throw new ApiError("bad_request");
  return wanted;
}

/** Full batteries of all the station's types, as station_status shows them. */
const STATION_TOTAL_SQL = (station: string) => `case when exists (select 1 from station_battery_types where station_id = ${station})
    then (select coalesce(sum(full_batteries), 0) from station_battery_types where station_id = ${station})
    else coalesce((select full from battery_counter where station_id = ${station} and battery_type_id = ''),
                  (select full_batteries from station_status where station_id = ${station}), 0) end`;

interface EventSpec {
  stationId: string;
  key: CounterKey;
  type: BatteryEventType;
  delta: number;
  reason: string | null;
  requestId: string;
  swapId: string | null;
  actor: StationActor;
  now: string;
  /** Extra SQL condition (with its own bound value ?12) for the event to happen, e.g. its swap row exists. */
  onlyIf?: { sql: string; value: string };
  /** Issue: leave the full batteries active reservations hold (a swap without reservation). */
  keepHeld?: boolean;
}

/**
 * Statements of one counter event: create the counter on first use (from today's
 * stock), write the event with the counter after it (only when allowed), move the
 * counter to it and copy the stock fields customers read.
 */
function eventStatements(db: D1Database, e: EventSpec): D1PreparedStatement[] {
  const fullDelta = e.type === "empty_in" ? 0 : e.delta;
  const emptyAfter = e.type === "full" ? "max(bc.empty - 1, 0)" : e.type === "empty_in" ? "bc.empty + 1" : "bc.empty";
  const guard =
    e.type === "issue"
      ? e.keepHeld
        ? `bc.full - ${heldBatteriesSql("?3", "?4", "?13")} > 0`
        : "bc.full > 0"
      : e.type === "correction"
        ? "bc.full + ?6 >= 0"
        : e.type === "full"
          ? `(s.battery_capacity <= 0 or (${STATION_TOTAL_SQL("?3")}) < s.battery_capacity)`
          : "1";
  const happened = "exists (select 1 from battery_events where request_id = ?1)";
  return [
    db
      .prepare(
        `insert or ignore into battery_counter (station_id, battery_type_id, full, empty, updated_at)
         values (?1, ?2, coalesce(case when ?2 = '' then (select full_batteries from station_status where station_id = ?1)
                                       else (select full_batteries from station_battery_types where station_id = ?1 and battery_type_id = ?2) end, 0), 0, ?3)`,
      )
      .bind(e.stationId, e.key, e.now),
    db
      .prepare(
        `insert into battery_events (id, request_id, station_id, battery_type_id, type, delta, full_after, empty_after, reason, swap_id, person_id, role, created_at)
         select ?2, ?1, ?3, ?4, ?5, ?6, bc.full + ?7, ${emptyAfter}, ?8, ?9, ?10, ?11, ?13
         from battery_counter bc join stations s on s.id = bc.station_id
         where bc.station_id = ?3 and bc.battery_type_id = ?4 and ${guard} and ${e.onlyIf?.sql ?? "?12 is null"}`,
      )
      .bind(e.requestId, uuid(), e.stationId, e.key, e.type, e.delta, fullDelta, e.reason, e.swapId, e.actor.user.id, e.actor.role, e.onlyIf?.value ?? null, e.now),
    db
      .prepare(
        `update battery_counter set full = (select full_after from battery_events where request_id = ?1),
           empty = (select empty_after from battery_events where request_id = ?1), updated_at = ?4
         where station_id = ?2 and battery_type_id = ?3 and ${happened}`,
      )
      .bind(e.requestId, e.stationId, e.key, e.now),
    db
      .prepare(
        `update station_battery_types set full_batteries = (select full from battery_counter where station_id = ?2 and battery_type_id = ?3)
         where station_id = ?2 and battery_type_id = ?3 and ${happened}`,
      )
      .bind(e.requestId, e.stationId, e.key),
    db
      .prepare(`update station_status set full_batteries = ${STATION_TOTAL_SQL("?2")}, updated_at = ?3, updated_by = ?4 where station_id = ?2 and ${happened}`)
      .bind(e.requestId, e.stationId, e.now, e.actor.user.id),
  ];
}

const EVENT_SELECT = `select e.*, u.full_name as p_name, u.phone as p_phone, u.email as p_email
  from battery_events e left join users u on u.id = e.person_id`;

async function eventByRequest(db: D1Database, requestId: string) {
  return db.prepare(`${EVENT_SELECT} where e.request_id = ?`).bind(requestId).first<EventRow>();
}

/** Name, else masked phone or e-mail (as everywhere staff see people). */
const label = (name: string | null | undefined, phone: string | null | undefined, email: string | null | undefined) =>
  name || phone || email ? personLabel({ fullName: name ?? null, phone: phone ?? null, email: email ?? null }) : null;

interface EventRow {
  id: string;
  request_id: string;
  station_id: string;
  battery_type_id: string;
  type: BatteryEventType;
  delta: number;
  full_after: number;
  empty_after: number;
  reason: string | null;
  swap_id: string | null;
  person_id: string;
  role: StationRole;
  created_at: string;
  p_name: string | null;
  p_phone: string | null;
  p_email: string | null;
}

function toEvent(r: EventRow): BatteryEventView {
  return {
    id: r.id,
    type: r.type,
    batteryTypeId: r.battery_type_id,
    delta: r.delta,
    fullAfter: r.full_after,
    emptyAfter: r.empty_after,
    reason: r.reason,
    swapId: r.swap_id,
    person: label(r.p_name, r.p_phone, r.p_email) ?? "",
    role: r.role,
    createdAt: r.created_at,
  };
}

const isUnique = (err: unknown) => /UNIQUE/i.test(String(err));

/** GET /api/stations/:id/counter: the counters, today's changes and whether the viewer may correct. */
export async function stationCounter(c: WorkCtx, stationId: string): Promise<StationCounter> {
  const actor = await stationReader(c, stationId);
  await requireService(c.db, stationId, "swap");
  const [station, types, counters, status] = await Promise.all([
    stationInfo(c.db, stationId),
    stationTypes(c.db, stationId),
    c.db.prepare("select battery_type_id, full, empty from battery_counter where station_id = ?").bind(stationId).all<{ battery_type_id: string; full: number; empty: number }>(),
    c.db.prepare("select full_batteries from station_status where station_id = ?").bind(stationId).first<{ full_batteries: number }>(),
  ]);
  const byKey = new Map(counters.results.map((r) => [r.battery_type_id, r]));
  const rows: CounterRow[] = types.length
    ? types.map((t) => ({ batteryTypeId: t.id, label: t.label, full: byKey.get(t.id)?.full ?? t.full, empty: byKey.get(t.id)?.empty ?? 0 }))
    : [{ batteryTypeId: "", label: null, full: byKey.get("")?.full ?? status?.full_batteries ?? 0, empty: byKey.get("")?.empty ?? 0 }];
  const mine = actor.role === "staff";
  const { results } = await c.db
    .prepare(
      `${EVENT_SELECT}
       where e.station_id = ?1 and e.created_at >= ?2 ${mine ? "and e.person_id = ?3" : "and ?3 is not null"} order by e.created_at desc limit 50`,
    )
    .bind(stationId, dayStartLome(), actor.user.id)
    .all<EventRow>();
  return {
    stationId,
    capacity: station.battery_capacity,
    rows,
    events: results.map(toEvent),
    canCorrect: actor.role !== "staff",
    priceXof: station.price_battery_xof,
  };
}

/** POST /api/stations/:id/battery-events: "marked full" (+1), "issue" (−1) or a correction (owner, admin). */
export async function postBatteryEvent(c: WorkCtx, stationId: string, input: BatteryEventInput): Promise<BatteryEventView> {
  const actor = await stationActor(c, stationId);
  await requireService(c.db, stationId, "swap");
  if (!input || !validRequestId(input.requestId)) throw new ApiError("bad_request");
  const type = input.type;
  if (type !== "issue" && type !== "full" && type !== "correction") throw new ApiError("bad_request");
  let delta = type === "issue" ? -1 : 1;
  let reason: string | null = null;
  if (type === "correction") {
    // Corrections only by the station's owner or an admin (staff use issue and full).
    if (actor.role === "staff") throw new ApiError("forbidden", 403);
    if (!validCorrection(input.delta)) throw new ApiError("bad_request");
    reason = cleanReason(input.reason);
    if (!reason) throw new ApiError("reason_required");
    delta = input.delta;
  }
  const existing = await eventByRequest(c.db, input.requestId);
  if (existing) return repeated(existing, stationId);
  const key = await counterKey(c.db, stationId, input.batteryTypeId);
  try {
    await c.db.batch(eventStatements(c.db, { stationId, key, type, delta, reason, requestId: input.requestId, swapId: null, actor, now: nowIso() }));
  } catch (err) {
    if (!isUnique(err)) throw err;
  }
  const row = await eventByRequest(c.db, input.requestId);
  if (!row) throw new ApiError(type === "full" ? "counter_full" : "no_full_battery", 409);
  return repeated(row, stationId);
}

function repeated(row: EventRow, stationId: string): BatteryEventView {
  if (row.station_id !== stationId) throw new ApiError("request_conflict", 409);
  return toEvent(row);
}

// Swaps --------------------------------------------------------------------------------

interface SwapRow {
  id: string;
  request_id: string;
  station_id: string;
  battery_type_id: string;
  battery_in_label: string | null;
  battery_out_label: string | null;
  customer_type: SwapCustomerType;
  customer_user_id: string | null;
  driver_id: string | null;
  reservation_id: string | null;
  payment: SwapPayment;
  amount_xof: number;
  staff_id: string;
  role: StationRole;
  created_at: string;
  type_label: string | null;
  c_name: string | null;
  c_phone: string | null;
  c_email: string | null;
  d_name: string | null;
  d_phone: string | null;
  s_name: string | null;
  s_phone: string | null;
  s_email: string | null;
}

const SWAP_SELECT = `
  select l.*, t.brand || ' ' || t.name as type_label,
         cu.full_name as c_name, cu.phone as c_phone, cu.email as c_email,
         coalesce(dr.full_name, du.full_name) as d_name, du.phone as d_phone,
         su.full_name as s_name, su.phone as s_phone, su.email as s_email
  from swap_log l
  left join battery_types t on t.id = l.battery_type_id
  left join users cu on cu.id = l.customer_user_id
  left join users du on du.id = l.driver_id
  left join drivers dr on dr.user_id = l.driver_id
  left join users su on su.id = l.staff_id`;

function toSwap(r: SwapRow): SwapEntry {
  return {
    id: r.id,
    stationId: r.station_id,
    batteryTypeId: r.battery_type_id,
    batteryTypeLabel: r.type_label,
    batteryIn: r.battery_in_label,
    batteryOut: r.battery_out_label,
    customerType: r.customer_type,
    customer: label(r.c_name, r.c_phone, r.c_email),
    driver: label(r.d_name, r.d_phone, null),
    payment: r.payment,
    amountXof: r.amount_xof,
    reservationId: r.reservation_id,
    person: label(r.s_name, r.s_phone, r.s_email) ?? "",
    role: r.role,
    createdAt: r.created_at,
  };
}

async function swapByRequest(db: D1Database, requestId: string): Promise<SwapRow | null> {
  return db.prepare(`${SWAP_SELECT} where l.request_id = ?`).bind(requestId).first<SwapRow>();
}

interface Customer {
  id: string;
  role: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
}

/** An account found by its app QR code, phone number or e-mail; only customers (staff and drivers are never customers). */
async function findCustomer(db: D1Database, raw: unknown, staffId: string): Promise<Customer> {
  const text = contactFromCode(String(raw ?? ""));
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const row = await db
    .prepare(`select id, role, phone, email, full_name from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<Customer>();
  if (!row) throw new ApiError("recipient_not_found", 404);
  if (row.id === staffId) throw new ApiError("own_reservation");
  if (row.role !== DB_CUSTOMER) throw new ApiError("not_a_customer", 409);
  return row;
}

/**
 * A fleet driver by their QR code: an active driver who belongs to a fleet (W7, R10).
 * TODO(phase 5): driver accounts and the driver QR of the new driver role (expiry,
 * removed drivers) replace this check against today's drivers table.
 */
async function findFleetDriver(db: D1Database, raw: unknown): Promise<{ driverId: string; managerId: string }> {
  const code = parseDriverBadge(String(raw ?? ""));
  const row = code
    ? await db
        .prepare("select d.user_id, d.status, f.manager_id from drivers d left join fleet_manager_drivers f on f.driver_id = d.user_id where d.code = ?")
        .bind(code)
        .first<{ user_id: string; status: string; manager_id: string | null }>()
    : null;
  if (!row || row.status !== "active") throw new ApiError("driver_not_found", 404);
  if (!row.manager_id) throw new ApiError("wrong_fleet", 409);
  return { driverId: row.user_id, managerId: row.manager_id };
}

/**
 * Records a swap (W7, R6): the full battery out (counter −1) and the customer's empty
 * battery in (empty stock +1), one log row with station, person and role, the payment
 * and, when given, the reservation it completes, in one batch. A repeated request id
 * returns the swap it already recorded.
 *
 * From a reservation (the staff open it from the reservation list): the customer and the
 * battery type come from the reservation, the pickup code is checked (locked after 5
 * wrong ones), and the swap completes it, paid like any app customer's swap. Without a
 * reservation, a swap cannot take a full battery an active reservation holds.
 */
export async function recordSwap(c: WorkCtx, stationId: string, input: SwapInput): Promise<SwapEntry> {
  const actor = await stationActor(c, stationId);
  await requireService(c.db, stationId, "swap");
  if (!input || !validRequestId(input.requestId) || !isSwapCustomerType(input.customerType)) throw new ApiError("bad_request");
  const existing = await swapByRequest(c.db, input.requestId);
  if (existing) {
    if (existing.station_id !== stationId) throw new ApiError("request_conflict", 409);
    return toSwap(existing);
  }
  const db = c.db;
  const type = input.customerType;
  const station = await stationInfo(db, stationId);
  const features = await featuresOf(db);
  const batteryIn = takesBatteryIn(type) ? cleanBatteryLabel(input.batteryIn) : null;
  const batteryOut = cleanBatteryLabel(input.batteryOut);
  if (batteryIn === undefined || batteryOut === undefined) throw new ApiError("bad_request");
  if (batteryIn && batteryOut && batteryIn === batteryOut) throw new ApiError("same_battery");

  // Who the customer is.
  let customer: Customer | null = null;
  let reservation: ReservationRow | null = null;
  let driver: { driverId: string; managerId: string } | null = null;
  if (input.reservationId) {
    if (type !== "app") throw new ApiError("bad_request");
    reservation = await db.prepare("select * from reservations where id = ?").bind(String(input.reservationId)).first<ReservationRow>();
    if (!reservation || reservation.station_id !== stationId || reservation.kind !== "swap") throw new ApiError("forbidden", 403);
    if (reservation.user_id === actor.user.id) throw new ApiError("own_reservation");
    if (!stillActive(reservation)) throw new ApiError("reservation_not_active");
    await checkPickupCode(db, reservation, input.pickupCode);
    // The battery type the reservation holds; another type is refused.
    if (reservation.target) {
      const given = input.batteryTypeId === undefined || input.batteryTypeId === null || input.batteryTypeId === "" ? null : String(input.batteryTypeId);
      if (given !== null && given !== reservation.target) throw new ApiError("battery_type_mismatch");
      input = { ...input, batteryTypeId: reservation.target };
    }
    customer = await db.prepare("select id, role, phone, email, full_name from users where id = ?").bind(reservation.user_id).first<Customer>();
    if (!customer) throw new ApiError("recipient_not_found", 404);
  } else if (type === "app") {
    customer = await findCustomer(db, input.contact, actor.user.id);
  } else if (type === "first_purchase" && input.contact) {
    customer = await findCustomer(db, input.contact, actor.user.id);
  } else if (type === "fleet") {
    // Lite switches drivers off everywhere: no fleet swaps (W8, R9).
    if (features.lite) throw new ApiError("cash_only", 409);
    driver = await findFleetDriver(db, input.driverCode);
    if (driver.driverId === actor.user.id) throw new ApiError("own_reservation");
  }

  const key = await counterKey(db, stationId, input.batteryTypeId);
  // How it is paid (Lite: cash only).
  let payment: SwapPayment;
  let amount: number;
  if (type === "fleet") {
    payment = "fleet";
    amount = station.price_battery_xof ?? 0;
  } else if (type === "app" && input.payment !== "cash") {
    if (features.lite) throw new ApiError("cash_only", 409);
    // As for charges (worker/charging.ts): app payments only at our own stations, cash elsewhere.
    if (!station.is_own) throw new ApiError("payment_not_offered", 409);
    payment = "wallet";
    if (!station.price_battery_xof) throw new ApiError("swap_price_missing", 409);
    amount = station.price_battery_xof;
  } else {
    payment = "cash";
    const raw = input.amountXof ?? station.price_battery_xof ?? 0;
    if (!validAmount(raw)) throw new ApiError("invalid_amount");
    amount = raw;
  }

  const now = nowIso();
  const swapId = uuid();
  const outRequest = `${input.requestId}:out`;
  const inRequest = `${input.requestId}:in`;
  if (!reservation) {
    // Full batteries held by active reservations are not for a swap without one.
    const left = await db
      .prepare(
        `select coalesce((select full from battery_counter where station_id = ?1 and battery_type_id = ?2),
                         case when ?2 = '' then (select full_batteries from station_status where station_id = ?1)
                              else (select full_batteries from station_battery_types where station_id = ?1 and battery_type_id = ?2) end, 0) as full,
                ${heldBatteriesSql("?1", "?2", "?3")} as held`,
      )
      .bind(stationId, key, now)
      .first<{ full: number; held: number }>();
    if (left && left.full > 0 && left.full - left.held <= 0) throw new ApiError("battery_reserved", 409);
  }
  const statements: D1PreparedStatement[] = [
    ...eventStatements(db, {
      stationId,
      key,
      type: "issue",
      delta: -1,
      reason: null,
      requestId: outRequest,
      swapId,
      actor,
      now,
      keepHeld: !reservation,
      // From a reservation: only while it is still active, so it completes exactly once.
      onlyIf: reservation ? { sql: "exists (select 1 from reservations where id = ?12 and status = 'active')", value: reservation.id } : undefined,
    }),
    db
      .prepare(
        `insert into swap_log (id, request_id, station_id, battery_type_id, has_battery_in, battery_in_label, battery_out_label, customer_type,
           customer_user_id, driver_id, fleet_manager_id, reservation_id, payment, amount_xof, wallet_trx_id, staff_id, role, created_at)
         select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18
         where exists (select 1 from battery_events where request_id = ?19)`,
      )
      .bind(
        swapId,
        input.requestId,
        stationId,
        key,
        takesBatteryIn(type) ? 1 : 0,
        batteryIn,
        batteryOut,
        type,
        customer?.id ?? null,
        driver?.driverId ?? null,
        driver?.managerId ?? null,
        reservation?.id ?? null,
        payment,
        amount,
        null,
        actor.user.id,
        actor.role,
        now,
        outRequest,
      ),
  ];
  const swapExists = { sql: "exists (select 1 from swap_log where request_id = ?12)", value: input.requestId };
  if (takesBatteryIn(type)) {
    statements.push(...eventStatements(db, { stationId, key, type: "empty_in", delta: 1, reason: null, requestId: inRequest, swapId, actor, now, onlyIf: swapExists }));
  }
  if (reservation) {
    statements.push(
      db
        .prepare(
          `update reservations set status = 'completed' where id = ?1 and status = 'active'
             and exists (select 1 from swap_log where request_id = ?2)`,
        )
        .bind(reservation.id, input.requestId),
    );
  }
  if (payment === "wallet" && customer) {
    await walletAccess(c.env, { id: customer.id, phone: customer.phone, email: customer.email, fullName: customer.full_name, role: "customer" });
    // The customer types their PIN at the counter.
    await verifyPin(c.env, customer.id, input.pin);
    const wallet = await db.prepare("select balance_xof, status from wallets where user_id = ?").bind(customer.id).first<{ balance_xof: number; status: string }>();
    if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
    if (!wallet || wallet.balance_xof < amount) throw new ApiError("insufficient_balance");
    const trxId = newTrxId("charge");
    const mine = "exists (select 1 from swap_log where request_id = ?)";
    statements.push(
      db.prepare(`update swap_log set wallet_trx_id = ? where request_id = ?`).bind(trxId, input.requestId),
      db.prepare(`update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ? and ${mine}`).bind(amount, now, customer.id, input.requestId),
      db
        .prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_label, remark, idempotency_key, details, created_at)
           select ?1, ?2, ?3, 'charge', 'send', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7, ?8, ?9
           where exists (select 1 from swap_log where request_id = ?10)`,
        )
        .bind(uuid(), trxId, customer.id, amount, station.name, "Échange de batterie", `swap:${input.requestId}`, JSON.stringify({ swap: swapId }), now, input.requestId),
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    if (/CHECK constraint failed/i.test(String(err)) && payment === "wallet") throw new ApiError("insufficient_balance");
    if (!isUnique(err)) throw err;
  }
  const row = await swapByRequest(db, input.requestId);
  if (!row) {
    if (reservation) {
      const current = await db.prepare("select status from reservations where id = ?").bind(reservation.id).first<{ status: string }>();
      if (current?.status !== "active") throw new ApiError("reservation_not_active");
    }
    throw new ApiError("no_full_battery", 409);
  }
  if (row.id === swapId && customer && (type === "app" || type === "first_purchase")) {
    // greenpoints for an app customer at a solar station (as a completed reservation or a visit before).
    const earned = await earnStatement(db, { userId: customer.id, type: "battery", stationId, reservationId: reservation?.id ?? null, createdBy: actor.user.id });
    await earned?.statement.run();
  }
  if (row.station_id !== stationId) throw new ApiError("request_conflict", 409);
  return toSwap(row);
}

/** GET /api/stations/:id/swaps?customerType=: today's swaps at the station, newest first (staff: their own). */
export async function stationSwaps(c: WorkCtx, stationId: string, filter: SwapFilter): Promise<SwapEntry[]> {
  const actor = await stationReader(c, stationId);
  const type = filter.customerType && isSwapCustomerType(filter.customerType) ? filter.customerType : null;
  const { results } = await c.db
    .prepare(
      `${SWAP_SELECT} where l.station_id = ?1 and l.created_at >= ?2 and (?3 is null or l.customer_type = ?3)
         and (?4 is null or l.staff_id = ?4) order by l.created_at desc limit 200`,
    )
    .bind(stationId, dayStartLome(), type, actor.role === "staff" ? actor.user.id : null)
    .all<SwapRow>();
  return results.map(toSwap);
}
