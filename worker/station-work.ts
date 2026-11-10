// Station work (plan phase 3): battery counter, swaps with their log, active station.
// Shared rules and types in shared/station-work.ts; tables in migrations 0027 and 0028.
//
// Every write here is one D1 batch (one transaction). The statements after the first
// event only take effect while that event was written ("where exists ... request_id"),
// so a refused step (no full battery, capacity reached) leaves nothing behind, and a
// repeated request id breaks the unique index and changes nothing (R5).

import { parseContact } from "../shared/contact";
import { contactFromCode } from "../shared/charging";
import { checkDriverPass, fleetTag } from "../shared/drivers";
import { passSecret } from "./drivers";
import {
  ACTIVE_STATION_HEADER,
  cleanBatteryLabel,
  cleanReason,
  dayStartLome,
  isSwapCustomerType,
  takesBatteryIn,
  CAPACITY_REASON,
  checkSwapEdit,
  SWAP_DELETED_REASON,
  SWAP_EXPORT_LIMIT,
  swapDayRange,
  validAmount,
  validCorrection,
  validRequestId,
  type BatteryEventInput,
  type BatteryEventType,
  type BatteryEventView,
  type CounterKey,
  type CounterRow,
  type MyLastSwap,
  type StationCounter,
  type StationRole,
  type SwapCustomerType,
  type SwapEditInput,
  type SwapEntry,
  type SwapFilter,
  type SwapInput,
  type SwapPayment,
  type SwapReview,
  type OfflineSwapReject,
  checkOfflineAt,
} from "../shared/station-work";
import type { Profile } from "../shared/types";
import { periodStart, reportPeriod } from "../shared/owner-backoffice";
import { swapOwnerOf, type SwapOwner } from "../shared/station-cash";
import { newTrxId, personLabel } from "../shared/wallet";
import type { Env } from "./env";
import { featuresOf } from "./features";
import { earnStatement } from "./greenpoint";
import { ApiError, nowIso, uuid } from "./http";
import { DB_CUSTOMER, DB_DRIVER } from "./roles";
import { requireService } from "./services";
import { creditCodeOwner, isCreditStation, OPEN_CREDIT_CHARGE_SQL, refuseWhileCreditCharging, spendCreditCode, walletAccess } from "./wallet";
import { checkPickupCode, heldBatteriesSql, stillActive, type ReservationRow } from "./reservations";
import { resolveSwapBattery, swapBatteryStatements, swapType } from "./batteries";
import { batteryNumbersRequired } from "../shared/batteries";
import { checkEnergySwap, CONDITION_REASON, energyPricingOf, type BatteryCondition, type EnergyPricing, type MmNetwork } from "../shared/energy-swap";

export interface WorkCtx {
  env: Env;
  db: D1Database;
  request: Request;
  requireUser(): Promise<Profile>;
  /** Told who acts where once the active-station check passed; the API logs it with the action (station_actions). */
  onStationActor?(stationId: string, actor: StationActor): void;
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
export async function roleAtStation(db: D1Database, user: Profile, stationId: string, mode: "act" | "read" = "act"): Promise<StationRole | null> {
  if (user.role === "admin") return "admin";
  if (user.role !== "operator") return null;
  // A read-only operator account (migration 0070) is an owner for reading only: it never acts here.
  const row = await db
    .prepare(
      `select exists (select 1 from stations s join operator_owners o on o.operator_id = s.operator_id
                      where s.id = ?1 and o.user_id = ?2 and (?3 = 'read' or o.access = 'manage')) as owner,
              exists (select 1 from station_staff where station_id = ?1 and user_id = ?2) as staff`,
    )
    .bind(stationId, user.id, mode)
    .first<{ owner: number; staff: number }>();
  return row?.owner ? "owner" : row?.staff ? "staff" : null;
}

/**
 * Who acts at the station, and as what. 403 without rights there (staff of another
 * station, riders, drivers, fleet managers). 409 when the active station sent with the
 * request is missing or another one: owners and admins must always send it; staff work
 * at exactly one station (W2, unique index of 0033), which is their active station.
 */
export async function stationActor(c: WorkCtx, stationId: string): Promise<StationActor> {
  const user = await c.requireUser();
  const role = await roleAtStation(c.db, user, stationId);
  if (!role) throw new ApiError("forbidden", 403);
  const station = await c.db.prepare("select is_active from stations where id = ?").bind(stationId).first<{ is_active: number }>();
  if (!station?.is_active) throw new ApiError("station_not_found", 404);
  const active = activeStationOf(c);
  if (active !== stationId && !(role === "staff" && active === null)) throw new ApiError("active_station_required", 409);
  const actor = { user, role };
  c.onStationActor?.(stationId, actor);
  return actor;
}

/** Read access (counter page, swap log): anyone with rights at the station, no active station needed. */
async function stationReader(c: WorkCtx, stationId: string): Promise<StationActor & { readOnly: boolean }> {
  const user = await c.requireUser();
  const role = await roleAtStation(c.db, user, stationId, "read");
  if (!role) throw new ApiError("forbidden", 403);
  // An owner only through a read-only link (migration 0070) reads and changes nothing.
  const readOnly = role === "owner" && (await roleAtStation(c.db, user, stationId, "act")) !== "owner";
  return { user, role, readOnly };
}

// Counter ------------------------------------------------------------------------------

interface StationInfo {
  id: string;
  name: string;
  battery_capacity: number;
  price_battery_xof: number | null;
  is_own: number | null;
  swap_owner: SwapOwner | null;
}

async function stationInfo(db: D1Database, stationId: string): Promise<StationInfo> {
  const s = await db
    .prepare("select s.id, s.name, s.battery_capacity, s.price_battery_xof, o.is_own, s.swap_owner from stations s left join operators o on o.id = s.operator_id where s.id = ?")
    .bind(stationId)
    .first<StationInfo>();
  if (!s) throw new ApiError("station_not_found", 404);
  return s;
}

/** The battery types the station swaps (id, label, places); empty = one counter for the station. */
async function stationTypes(db: D1Database, stationId: string) {
  const { results } = await db
    .prepare(
      `select sbt.battery_type_id as id, sbt.full_batteries, sbt.capacity, t.brand, t.name,
              t.pricing, t.price_full_xof, t.ussd_tmoney, t.ussd_flooz from station_battery_types sbt
       join battery_types t on t.id = sbt.battery_type_id where sbt.station_id = ? order by t.brand, t.name`,
    )
    .bind(stationId)
    .all<{ id: string; full_batteries: number; capacity: number; brand: string; name: string } & EnergyColumns>();
  return results.map((r) => ({ id: r.id, full: r.full_batteries, capacity: r.capacity, label: `${r.brand} ${r.name}`, energy: energyPricingOf(r) }));
}

interface EnergyColumns {
  pricing: string;
  price_full_xof: number | null;
  ussd_tmoney: string | null;
  ussd_flooz: string | null;
}

/**
 * Energy pricing of a counter's battery type (0065), null when the station's price applies.
 * A type set to energy pricing without a usable price is refused rather than sold at the station's price.
 */
async function energyOfKey(db: D1Database, key: CounterKey): Promise<EnergyPricing | null> {
  if (!key) return null;
  const row = await db.prepare("select pricing, price_full_xof, ussd_tmoney, ussd_flooz from battery_types where id = ?").bind(key).first<EnergyColumns>();
  if (!row || row.pricing !== "energy") return null;
  const energy = energyPricingOf(row);
  if (!energy) throw new ApiError("swap_price_missing", 409);
  return energy;
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

/** Places of the counter's battery type (?3 station, ?4 type); null at a station without types. */
const TYPE_PLACES_SQL = "select capacity from station_battery_types where station_id = ?3 and battery_type_id = ?4";

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
  /** Correction: also take this many empty batteries off (a deleted swap's battery brought back, −1). */
  emptyDelta?: -1 | 0;
  /**
   * Issue of an offline swap (0071): it already happened, so it is written even without a full
   * battery in the counter (which stays at 0); the swap is then marked to check.
   */
  force?: boolean;
  /** When the event happened, when not now (an offline swap); the counter's updated_at stays now. */
  at?: string;
}

/**
 * Statements of one counter event: create the counter on first use (from today's
 * stock), write the event with the counter after it (only when allowed), move the
 * counter to it and copy the stock fields customers read.
 */
function eventStatements(db: D1Database, e: EventSpec): D1PreparedStatement[] {
  const fullDelta = e.type === "empty_in" ? 0 : e.delta;
  const fullAfter = e.force ? "max(bc.full + ?7, 0)" : "bc.full + ?7";
  const emptyAfter =
    e.type === "full" || (e.type === "correction" && e.emptyDelta === -1) ? "max(bc.empty - 1, 0)" : e.type === "empty_in" ? "bc.empty + 1" : "bc.empty";
  const guard = e.force
    ? "1"
    : e.type === "issue"
      ? e.keepHeld
        ? `bc.full - ${heldBatteriesSql("?3", "?4", "?13")} > 0`
        : "bc.full > 0"
      : e.type === "correction"
        ? "bc.full + ?6 >= 0"
        : e.type === "full"
          ? // Within the type's own places when set (0064), else the station's places for all its batteries.
            `case when coalesce((${TYPE_PLACES_SQL}), 0) > 0 then bc.full < (${TYPE_PLACES_SQL})
                  else (s.battery_capacity <= 0 or (${STATION_TOTAL_SQL("?3")}) < s.battery_capacity) end`
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
         select ?2, ?1, ?3, ?4, ?5, ?6, ${fullAfter}, ${emptyAfter}, ?8, ?9, ?10, ?11, ?14
         from battery_counter bc join stations s on s.id = bc.station_id
         where bc.station_id = ?3 and bc.battery_type_id = ?4 and ${guard} and ${e.onlyIf?.sql ?? "?12 is null"}`,
      )
      .bind(e.requestId, uuid(), e.stationId, e.key, e.type, e.delta, fullDelta, e.reason, e.swapId, e.actor.user.id, e.actor.role, e.onlyIf?.value ?? null, e.now, e.at ?? e.now),
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
    ? types.map((t) => ({
        batteryTypeId: t.id,
        label: t.label,
        full: byKey.get(t.id)?.full ?? t.full,
        empty: byKey.get(t.id)?.empty ?? 0,
        capacity: t.capacity,
        energy: t.energy,
      }))
    : [
        {
          batteryTypeId: "",
          label: null,
          full: byKey.get("")?.full ?? status?.full_batteries ?? 0,
          empty: byKey.get("")?.empty ?? 0,
          capacity: station.battery_capacity,
        },
      ];
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
    canCorrect: actor.role !== "staff" && !actor.readOnly,
    priceXof: station.price_battery_xof,
  };
}

/**
 * GET /api/stations/:id/battery-events?days=: the counter's history (owner backoffice): every
 * event of the period, corrections included. Owners of the station and admins only.
 */
export async function stationBatteryEvents(c: WorkCtx, stationId: string, days: unknown): Promise<BatteryEventView[]> {
  const actor = await stationReader(c, stationId);
  if (actor.role === "staff") throw new ApiError("forbidden", 403);
  const { results } = await c.db
    .prepare(`${EVENT_SELECT} where e.station_id = ?1 and e.created_at >= ?2 order by e.created_at desc limit 500`)
    .bind(stationId, periodStart(reportPeriod(days)))
    .all<EventRow>();
  return results.map(toEvent);
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

/**
 * A station's battery capacity went down below its full batteries (backoffice, Atlas finding):
 * the counters come down to it through correction events (principle 4), the largest counter
 * first, logged as the admin's with the reason. Statements for the same batch as the change.
 */
export async function capacityTrimStatements(db: D1Database, stationId: string, capacity: number, actor: StationActor): Promise<D1PreparedStatement[]> {
  if (capacity < 0) return [];
  const [types, counters, status] = await Promise.all([
    stationTypes(db, stationId),
    db.prepare("select battery_type_id, full from battery_counter where station_id = ?").bind(stationId).all<{ battery_type_id: string; full: number }>(),
    db.prepare("select full_batteries from station_status where station_id = ?").bind(stationId).first<{ full_batteries: number }>(),
  ]);
  const byKey = new Map(counters.results.map((r) => [r.battery_type_id, r.full]));
  const rows = types.length
    ? types.map((t) => ({ key: t.id, full: byKey.get(t.id) ?? t.full }))
    : [{ key: "", full: byKey.get("") ?? status?.full_batteries ?? 0 }];
  let excess = rows.reduce((a, r) => a + r.full, 0) - capacity;
  if (excess <= 0) return [];
  const trim = new Map<string, number>();
  while (excess > 0) {
    const top = rows.reduce((a, r) => (r.full > a.full ? r : a));
    if (top.full <= 0) break;
    top.full--;
    trim.set(top.key, (trim.get(top.key) ?? 0) + 1);
    excess--;
  }
  const now = nowIso();
  return [...trim].flatMap(([key, n]) =>
    eventStatements(db, {
      stationId,
      key,
      type: "correction",
      delta: -n,
      reason: CAPACITY_REASON,
      requestId: `capacity-${uuid()}`,
      swapId: null,
      actor,
      now,
    }),
  );
}

/**
 * The places of a station's battery types were saved (backoffice, migration 0064): each type
 * with more full batteries than its places comes down to them through one correction event,
 * logged as the admin's with the reason. A type without places (0) is left alone.
 */
export async function typeCapacityTrimStatements(
  db: D1Database,
  stationId: string,
  places: Map<string, number>,
  actor: StationActor,
): Promise<D1PreparedStatement[]> {
  const [types, counters] = await Promise.all([
    stationTypes(db, stationId),
    db.prepare("select battery_type_id, full from battery_counter where station_id = ?").bind(stationId).all<{ battery_type_id: string; full: number }>(),
  ]);
  const byKey = new Map(counters.results.map((r) => [r.battery_type_id, r.full]));
  const now = nowIso();
  return types.flatMap((t) => {
    const cap = places.get(t.id) ?? 0;
    const full = byKey.get(t.id) ?? t.full;
    if (cap <= 0 || full <= cap) return [];
    return eventStatements(db, {
      stationId,
      key: t.id,
      type: "correction",
      delta: cap - full,
      reason: CAPACITY_REASON,
      requestId: `capacity-${uuid()}`,
      swapId: null,
      actor,
      now,
    });
  });
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
  in_pct: number | null;
  out_pct: number | null;
  plate: string | null;
  customer_name: string | null;
  battery_in_condition: BatteryCondition | null;
  mm_network: MmNetwork | null;
  mm_ref: string | null;
  staff_id: string;
  role: StationRole;
  created_at: string;
  offline?: number | null;
  synced_at?: string | null;
  review?: SwapReview | null;
  review_note?: string | null;
  reviewed_at?: string | null;
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
    inPct: r.in_pct,
    outPct: r.out_pct,
    plate: r.plate,
    customerName: r.customer_name,
    batteryInCondition: r.battery_in_condition,
    mmNetwork: r.mm_network,
    mmRef: r.mm_ref,
    person: label(r.s_name, r.s_phone, r.s_email) ?? "",
    role: r.role,
    createdAt: r.created_at,
    offline: !!r.offline,
    syncedAt: r.synced_at ?? null,
    review: r.review ?? null,
    reviewNote: r.review_note ?? null,
    reviewedAt: r.reviewed_at ?? null,
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

/** The customer behind a Green Credit counter code (shown after the PIN on their phone, 0047); only customers. */
async function creditCustomer(db: D1Database, raw: unknown, staffId: string): Promise<Customer> {
  const { user } = await creditCodeOwner(db, raw);
  if (user.id === staffId) throw new ApiError("own_reservation");
  if (user.role !== DB_CUSTOMER) throw new ApiError("not_a_customer", 409);
  return { id: user.id, role: user.role ?? "", phone: user.phone, email: user.email, full_name: user.full_name };
}

/**
 * A fleet driver by the signed pass their app shows (W7, R10, shared/drivers.ts): the
 * signature must be ours and not expired, the account an active driver account, and the
 * pass made for the fleet the driver belongs to now. A typed driver code is not enough:
 * the swap is billed to the fleet.
 */
async function findFleetDriver(db: D1Database, raw: unknown, at?: number): Promise<{ driverId: string; managerId: string }> {
  // An offline swap: the pass must have been valid when it was scanned.
  const pass = await checkDriverPass(await passSecret(db), String(raw ?? ""), at);
  if (!pass.ok) throw new ApiError(pass.error, 409);
  const row = await db
    .prepare(
      `select d.user_id, d.status, u.role, f.manager_id from drivers d join users u on u.id = d.user_id
       left join fleet_manager_drivers f on f.driver_id = d.user_id where d.code = ?`,
    )
    .bind(pass.code)
    .first<{ user_id: string; status: string; role: string; manager_id: string | null }>();
  if (!row || row.status !== "active" || row.role !== DB_DRIVER) throw new ApiError("driver_not_found", 404);
  // Removed from the fleet, or moved to another one since the pass was made.
  if (!row.manager_id || fleetTag(row.manager_id) !== pass.fleet) throw new ApiError("wrong_fleet", 409);
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
  if (input?.offlineAt == null) return recordSwapNow(c, stationId, input);
  try {
    return await recordSwapNow(c, stationId, input);
  } catch (err) {
    // A refused offline swap already happened: the admin sees it and decides (0071).
    if (err instanceof ApiError && !NOT_KEPT_REJECTS.has(err.code)) await keepOfflineReject(c, stationId, input, err.code).catch(() => undefined);
    throw err;
  }
}

/** Answers that say nothing about the swap itself: the app keeps it and sends it again later. */
const NOT_KEPT_REJECTS = new Set<string>(["not_authenticated", "rate_limited", "active_station_required"]);

async function keepOfflineReject(c: WorkCtx, stationId: string, input: SwapInput, error: string) {
  const user = await c.requireUser();
  if (!validRequestId(input.requestId)) return;
  const payload = JSON.stringify(input).slice(0, 4000);
  await c.db
    .prepare(
      `insert into offline_swap_rejects (id, request_id, station_id, staff_id, occurred_at, error, payload, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (request_id) do update set error = excluded.error, payload = excluded.payload, created_at = excluded.created_at
       where offline_swap_rejects.resolved_at is null`,
    )
    .bind(uuid(), input.requestId, String(stationId).slice(0, 80), user.id, String(input.offlineAt).slice(0, 40), error.slice(0, 80), payload, nowIso())
    .run();
}

async function recordSwapNow(c: WorkCtx, stationId: string, input: SwapInput): Promise<SwapEntry> {
  const actor = await stationActor(c, stationId);
  await requireService(c.db, stationId, "swap");
  if (!input || !validRequestId(input.requestId) || !isSwapCustomerType(input.customerType)) throw new ApiError("bad_request");
  const existing = await swapByRequest(c.db, input.requestId);
  if (existing) {
    if (existing.station_id !== stationId) throw new ApiError("request_conflict", 409);
    return toSwap(existing);
  }
  try {
    return await bookSwap(c, stationId, input, actor);
  } catch (err) {
    // A copy of this request (a double tap, a retry) booked the swap meanwhile and used the code:
    // answer with that swap, not with "code used", or staff would take the price again in cash.
    const booked = await swapByRequest(c.db, input.requestId);
    if (!booked) throw err;
    if (booked.station_id !== stationId) throw new ApiError("request_conflict", 409);
    return toSwap(booked);
  }
}

async function bookSwap(c: WorkCtx, stationId: string, input: SwapInput, actor: StationActor): Promise<SwapEntry> {
  const db = c.db;
  let type = input.customerType;
  // Made without network and sent later (0071): kept at its real time, and what no longer matches
  // the back-office is marked to check rather than refused, since the customer already left with it.
  let offlineAt: string | null = null;
  if (input.offlineAt != null) {
    const checked = checkOfflineAt(input.offlineAt);
    if (!checked.ok) throw new ApiError(checked.error);
    offlineAt = checked.at;
    // Green Credit codes and pickup codes are checked by the server only: never taken offline.
    if (input.reservationId || (type === "app" && input.payment !== "cash")) {
      const energyType = input.reservationId ? null : await energyOfKey(db, await counterKey(db, stationId, input.batteryTypeId));
      if (!energyType) throw new ApiError("offline_not_allowed");
    }
  }
  const reviews: { review: SwapReview; note: string }[] = [];
  const toCheck = (review: SwapReview, note: string) => reviews.push({ review, note });
  const station = await stationInfo(db, stationId);
  const features = await featuresOf(db);
  const batteryIn = takesBatteryIn(type) ? cleanBatteryLabel(input.batteryIn) : null;
  const batteryOut = cleanBatteryLabel(input.batteryOut);
  if (batteryIn === undefined || batteryOut === undefined) throw new ApiError("bad_request");
  if (batteryIn && batteryOut && batteryIn === batteryOut) throw new ApiError("same_battery");

  // A type priced by energy is paid by Mobile Money only, never from Green Credit (0065).
  const energyWalkIn = input.reservationId ? null : await energyOfKey(db, await counterKey(db, stationId, input.batteryTypeId));

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
  } else if (type === "app" && input.payment !== "cash" && !energyWalkIn) {
    // Paid from Green Credit: the customer's one-time code, shown after the PIN on their phone (0047).
    customer = await creditCustomer(db, input.creditCode ?? input.contact, actor.user.id);
  } else if (type === "app" || (type === "first_purchase" && input.contact)) {
    try {
      customer = await findCustomer(db, input.contact, actor.user.id);
    } catch (err) {
      // Offline: the customer took the battery and paid cash; who they are is checked afterwards.
      if (!offlineAt || !(err instanceof ApiError) || !input.contact) throw err;
      toCheck("customer", err.code);
    }
  } else if (type === "fleet") {
    // Lite switches drivers off everywhere: no fleet swaps (W8, R9).
    if (features.lite) throw new ApiError("cash_only", 409);
    try {
      driver = await findFleetDriver(db, input.driverCode, offlineAt ? Date.parse(offlineAt) : undefined);
    } catch (err) {
      // Offline: the driver left with the battery but the fleet cannot be billed; recorded unpaid, to check.
      if (!offlineAt || !(err instanceof ApiError)) throw err;
      toCheck("payment", err.code);
      type = "cash";
    }
    if (driver?.driverId === actor.user.id) throw new ApiError("own_reservation");
  }

  const key = await counterKey(db, stationId, input.batteryTypeId);
  // Battery register (0041): at a station with battery types every swap names its batteries.
  const batteryType = await swapType(db, key);
  if (batteryNumbersRequired(key !== "") && (!batteryOut || (takesBatteryIn(type) && !batteryIn))) throw new ApiError("battery_number_required");
  const batteriesOf = {
    out: batteryOut ? await resolveSwapBattery(db, batteryOut, batteryType) : null,
    in: batteryIn ? await resolveSwapBattery(db, batteryIn, batteryType) : null,
  };
  const energy = await energyOfKey(db, key);
  const energySwap = energy ? energySwapOf(input, energy) : null;
  if (offlineAt) {
    // Offline: the register may have moved on meanwhile (a battery taken out of service, or moved by a later swap).
    if (batteriesOf.out?.status && batteriesOf.out.status !== "in_service") toCheck("battery", "battery_out_not_in_service");
    else if (await movedSince(db, [batteryOut, batteryIn], offlineAt)) toCheck("battery", "battery_moved_since");
  }
  if (energySwap) {
    // The procedure: never hand out a battery that is not in service.
    if (!offlineAt && batteriesOf.out?.status && batteriesOf.out.status !== "in_service") throw new ApiError("battery_out_not_in_service", 409);
    const used = await db.prepare("select 1 from swap_log where mm_network = ? and mm_ref = ?").bind(energySwap.mmNetwork, energySwap.mmRef).first();
    if (used) throw new ApiError("mm_ref_used", 409);
  }
  // Who the swap belongs to (0045), kept on the log row; how it is paid (Green Credit in Lite too).
  const owner = swapOwnerOf(!!station.is_own, station.swap_owner);
  let payment: SwapPayment;
  let amount: number;
  if (energySwap) {
    // (% OUT − % IN) × the type's price for 100 %, paid by T-Money or Flooz straight to the brand.
    payment = "mobile_money";
    amount = energySwap.amountXof;
  } else if (type === "fleet") {
    payment = "fleet";
    amount = station.price_battery_xof ?? 0;
  } else if (input.customerType === "fleet") {
    // An offline fleet swap whose pass no longer holds: unpaid, to check (no driver to bill).
    payment = "none";
    amount = station.price_battery_xof ?? 0;
  } else if (type === "app" && input.payment !== "cash") {
    // App payments only where the swap is ours (our stations, shop stations: 0045), cash elsewhere,
    // and only at a Green Credit station (0047).
    if (owner !== "poinderecharge") throw new ApiError("payment_not_offered", 409);
    if (!(await isCreditStation(db, stationId))) throw new ApiError("credit_not_accepted", 409);
    payment = "wallet";
    if (!station.price_battery_xof) throw new ApiError("swap_price_missing", 409);
    amount = station.price_battery_xof;
  } else {
    payment = "cash";
    if (type === "first_purchase") {
      // Buying a first battery: its price is not the swap price, staff enter it.
      const raw = input.amountXof ?? 0;
      if (!validAmount(raw)) throw new ApiError("invalid_amount");
      amount = raw;
    } else {
      // A swap costs the station's price, set in the backoffice; staff cannot change it.
      if (!station.price_battery_xof) throw new ApiError("swap_price_missing", 409);
      amount = station.price_battery_xof;
    }
  }

  const realNow = nowIso();
  const now = offlineAt ?? realNow;
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
      .bind(stationId, key, realNow)
      .first<{ full: number; held: number }>();
    if (offlineAt) {
      if (!left || left.full - left.held <= 0) toCheck("stock", left && left.full > 0 ? "battery_reserved" : "no_full_battery");
    } else if (left && left.full > 0 && left.full - left.held <= 0) throw new ApiError("battery_reserved", 409);
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
      now: realNow,
      at: now,
      force: !!offlineAt,
      keepHeld: !reservation && !offlineAt,
      // From a reservation: only while it is still active, so it completes exactly once.
      onlyIf: reservation ? { sql: "exists (select 1 from reservations where id = ?12 and status = 'active')", value: reservation.id } : undefined,
    }),
    db
      .prepare(
        `insert into swap_log (id, request_id, station_id, battery_type_id, has_battery_in, battery_in_label, battery_out_label, customer_type,
           customer_user_id, driver_id, fleet_manager_id, reservation_id, payment, amount_xof, wallet_trx_id, staff_id, role, created_at, owner,
           in_pct, out_pct, plate, customer_name, battery_in_condition, mm_network, mm_ref, offline, synced_at, review, review_note)
         select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31
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
        owner,
        energySwap?.inPct ?? null,
        energySwap?.outPct ?? null,
        energySwap?.plate ?? null,
        energySwap?.customerName ?? null,
        energySwap?.condition ?? null,
        energySwap?.mmNetwork ?? null,
        energySwap?.mmRef ?? null,
        offlineAt ? 1 : 0,
        offlineAt ? realNow : null,
        reviews[0]?.review ?? null,
        reviews.length ? reviews.map((r) => r.note).join(", ").slice(0, 200) : null,
      ),
  ];
  const swapExists = { sql: "exists (select 1 from swap_log where request_id = ?12)", value: input.requestId };
  if (takesBatteryIn(type)) {
    statements.push(...eventStatements(db, { stationId, key, type: "empty_in", delta: 1, reason: null, requestId: inRequest, swapId, actor, now: realNow, at: now, onlyIf: swapExists }));
  }
  for (const direction of ["out", "in"] as const) {
    const battery = batteriesOf[direction];
    if (!battery) continue;
    statements.push(
      ...swapBatteryStatements(db, {
        battery,
        direction,
        type: batteryType,
        stationId,
        swapId,
        requestId: input.requestId,
        holderId: customer?.id ?? driver?.driverId ?? null,
        actor,
        now,
      }),
    );
  }
  if (energySwap && energySwap.condition !== "ok" && batteriesOf.in) {
    // A battery brought back damaged, leaking, hot or smelling goes to repair (never handed out again).
    const b = batteriesOf.in;
    const where = "brand = ? and serial = ? and exists (select 1 from swap_log where request_id = ?)";
    statements.push(
      db.prepare(`update batteries set status = 'repair' where ${where}`).bind(b.brand, b.serial, input.requestId),
      db
        .prepare(
          `insert into battery_history (id, battery_id, type, station_id, swap_id, status, reason, person_id, role, created_at)
           select ?, id, 'status', ?, ?, 'repair', ?, ?, ?, ? from batteries where ${where}`,
        )
        .bind(uuid(), stationId, swapId, CONDITION_REASON[energySwap.condition], actor.user.id, actor.role, now, b.brand, b.serial, input.requestId),
    );
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
    // The customer typed their PIN on their own phone: the code it showed is used once, with the swap.
    const code = await creditCodeOwner(db, input.creditCode ?? (reservation ? null : input.contact));
    if (code.user.id !== customer.id) throw new ApiError("credit_code_invalid");
    const used = spendCreditCode(db, code.hash, stationId, "swap", now);
    // The code first; a code another request used meanwhile breaks the balance check and with it the whole swap.
    await refuseWhileCreditCharging(db, customer.id);
    statements.unshift(
      used.statement,
      db.prepare(`update wallets set balance_xof = -1 where user_id = ? and not ${used.usedSql}`).bind(customer.id),
      // A Green Credit charge started meanwhile holds the credit: the swap fails as a whole.
      db.prepare(`update wallets set balance_xof = -1 where user_id = ?1 and ${OPEN_CREDIT_CHARGE_SQL.replace("?", "?1")}`).bind(customer.id),
    );
    const wallet = await db.prepare("select balance_xof, status from wallets where user_id = ?").bind(customer.id).first<{ balance_xof: number; status: string }>();
    if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
    if (!wallet || wallet.balance_xof < amount) throw new ApiError("insufficient_balance");
    const trxId = newTrxId("charge");
    const mine = `exists (select 1 from swap_log where request_id = ?) and ${used.usedSql}`;
    statements.push(
      db.prepare(`update swap_log set wallet_trx_id = ? where request_id = ?`).bind(trxId, input.requestId),
      db.prepare(`update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ? and ${mine}`).bind(amount, now, customer.id, input.requestId),
      db
        .prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_label, remark, idempotency_key, details, created_at)
           select ?1, ?2, ?3, 'charge', 'send', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7, ?8, ?9
           where exists (select 1 from swap_log where request_id = ?10) and ${used.usedSql}`,
        )
        .bind(uuid(), trxId, customer.id, amount, station.name, "Échange de batterie", `swap:${input.requestId}`, JSON.stringify({ swap: swapId }), now, input.requestId),
    );
  }

  try {
    await db.batch(statements);
  } catch (err) {
    if (/CHECK constraint failed/i.test(String(err)) && payment === "wallet") {
      const code = input.creditCode ?? (reservation ? null : input.contact);
      const stillOpen = await creditCodeOwner(db, code).then(
        () => true,
        () => false,
      );
      throw new ApiError(stillOpen ? "insufficient_balance" : "credit_code_invalid");
    }
    if (!isUnique(err)) throw err;
  }
  const row = await swapByRequest(db, input.requestId);
  if (!row) {
    // The same transaction id, recorded by another swap meanwhile (unique index, 0065).
    if (energySwap && (await db.prepare("select 1 from swap_log where mm_network = ? and mm_ref = ?").bind(energySwap.mmNetwork, energySwap.mmRef).first())) {
      throw new ApiError("mm_ref_used", 409);
    }
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

/** A battery of the swap moved by a swap after `at` (an offline swap sent late): its place in the register is newer. */
async function movedSince(db: D1Database, serials: (string | null)[], at: string): Promise<boolean> {
  const wanted = serials.filter((s): s is string => !!s);
  if (!wanted.length) return false;
  const row = await db
    .prepare(`select 1 from batteries where serial in (${wanted.map(() => "?").join(", ")}) and last_swap_at > ? limit 1`)
    .bind(...wanted, at)
    .first();
  return !!row;
}

/** A swap priced by energy, checked (shared/energy-swap.ts). */
function energySwapOf(input: SwapInput, energy: EnergyPricing) {
  const checked = checkEnergySwap(input, energy);
  if (!checked.ok) throw new ApiError(checked.error);
  return checked.swap;
}

/** GET /api/stations/:id/swaps?customerType=: today's swaps at the station, newest first (staff: their own). */
export async function stationSwaps(c: WorkCtx, stationId: string, filter: SwapFilter): Promise<SwapEntry[]> {
  const actor = await stationReader(c, stationId);
  const type = filter.customerType && isSwapCustomerType(filter.customerType) ? filter.customerType : null;
  // Staff see today's own swaps; owners and admins may look back (backoffice, plan phase 8),
  // or read a range of days for the swap sheet export.
  const staff = actor.role === "staff";
  const ranged = !staff && (filter.from != null || filter.to != null);
  const range = ranged ? swapDayRange(filter.from, filter.to) : null;
  if (ranged && !range) throw new ApiError("invalid_date_range");
  // Swaps to check (offline swaps, 0071) are listed whatever their day, until someone checks them.
  const toCheck = !staff && !!filter.toCheck;
  const since = staff ? dayStartLome() : toCheck ? "" : (range?.since ?? periodStart(reportPeriod(filter.days ?? 1)));
  const { results } = await c.db
    .prepare(
      `${SWAP_SELECT} where l.station_id = ?1 and l.created_at >= ?2 and (?3 is null or l.customer_type = ?3)
         and (?4 is null or l.staff_id = ?4) and (?5 is null or l.created_at < ?5)
         and (?7 = 0 or (l.review is not null and l.reviewed_at is null)) order by l.created_at desc limit ?6`,
    )
    .bind(stationId, since, type, staff ? actor.user.id : null, range?.until ?? null, range ? SWAP_EXPORT_LIMIT : 500, toCheck ? 1 : 0)
    .all<SwapRow>();
  return results.map(toSwap);
}

// Editing and deleting a swap (owners and admins, backoffice history) ---------------------

/** The station's owners and admins; the swap must be one of this station's. */
async function swapEditor(c: WorkCtx, stationId: string, swapId: string): Promise<{ actor: StationActor; row: SwapRow & { battery_in_id: string | null; battery_out_id: string | null; wallet_trx_id: string | null; has_battery_in: number } }> {
  const actor = await stationReader(c, stationId);
  if (actor.role === "staff" || actor.readOnly) throw new ApiError("forbidden", 403);
  const row = await c.db
    .prepare(`${SWAP_SELECT} where l.id = ? and l.station_id = ?`)
    .bind(swapId, stationId)
    .first<SwapRow & { battery_in_id: string | null; battery_out_id: string | null; wallet_trx_id: string | null; has_battery_in: number }>();
  if (!row) throw new ApiError("swap_not_found", 404);
  return { actor, row };
}

function swapAudit(db: D1Database, actor: StationActor, action: "update" | "delete", row: SwapRow, changes: Record<string, unknown>) {
  return db
    .prepare("insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'swap_log', ?, ?, ?, ?, ?)")
    .bind(nowIso(), actor.user.id, action, row.id, row.station_id, row.customer_user_id ?? row.driver_id ?? null, JSON.stringify(changes));
}

/**
 * PATCH /api/stations/:id/swaps/:swapId: corrects the customer's name, the plate, the amount or
 * the Mobile Money transaction id of a recorded swap (owners of the station, admins). Totals,
 * cash to hand over and fleet bills are read from the log, so they follow. Logged in the activity log.
 */
/** The signed-in customer's latest swap, at any station, or null (home "Mon scooter"). */
export async function myLastSwap(db: D1Database, userId: string): Promise<MyLastSwap | null> {
  const r = await db
    .prepare(
      `select l.created_at, l.station_id, s.name as station_name, t.brand || ' ' || t.name as type_label, l.battery_out_label, l.out_pct
       from swap_log l join stations s on s.id = l.station_id left join battery_types t on t.id = l.battery_type_id
       where l.customer_user_id = ? order by l.created_at desc limit 1`,
    )
    .bind(userId)
    .first<{ created_at: string; station_id: string; station_name: string; type_label: string | null; battery_out_label: string | null; out_pct: number | null }>();
  return r
    ? { at: r.created_at, stationId: r.station_id, stationName: r.station_name, batteryTypeLabel: r.type_label, batteryOut: r.battery_out_label, outPct: r.out_pct }
    : null;
}

export async function editSwap(c: WorkCtx, stationId: string, swapId: string, input: SwapEditInput): Promise<SwapEntry> {
  const { actor, row } = await swapEditor(c, stationId, swapId);
  const checked = checkSwapEdit(input, { payment: row.payment, energy: row.in_pct !== null });
  if (!checked.ok) throw new ApiError(checked.error);
  const changes = checked.changes;
  const was: Record<string, unknown> = { customer_name: row.customer_name, plate: row.plate, amount_xof: row.amount_xof, mm_ref: row.mm_ref };
  const changed = Object.entries(changes).filter(([k, v]) => was[k] !== v);
  if (changed.length) {
    if (changes.mm_ref && changes.mm_ref !== row.mm_ref) {
      const used = await c.db.prepare("select 1 from swap_log where mm_network = ? and mm_ref = ? and id <> ?").bind(row.mm_network, changes.mm_ref, row.id).first();
      if (used) throw new ApiError("mm_ref_used", 409);
    }
    const sets = changed.map(([k], i) => `${k} = ?${i + 2}`).join(", ");
    try {
      await c.db.batch([
        c.db.prepare(`update swap_log set ${sets} where id = ?1`).bind(row.id, ...changed.map(([, v]) => v)),
        swapAudit(c.db, actor, "update", row, Object.fromEntries(changed.map(([k, v]) => [k, [was[k], v]]))),
      ]);
    } catch (err) {
      if (isUnique(err)) throw new ApiError("mm_ref_used", 409);
      throw err;
    }
  }
  const after = await c.db.prepare(`${SWAP_SELECT} where l.id = ?`).bind(row.id).first<SwapRow>();
  if (!after) throw new ApiError("swap_not_found", 404);
  return toSwap(after);
}

/**
 * DELETE /api/stations/:id/swaps/:swapId?restoreCounter=0|1: removes a swap recorded by mistake
 * (owners of the station, admins), in one batch:
 * - the counter (unless restoreCounter=0): a correction puts the full battery back and takes
 *   the empty one brought in off, logged with the reason "Échange supprimé";
 * - the battery register: the swap's moves leave the batteries' history, the battery handed out
 *   is back at the station, the one brought in back where it was before; a battery that only
 *   came into the register with this swap leaves it;
 * - paid from Green Credit (admins only): the amount goes back to the customer's credit, once;
 * - the log row itself. Totals, cash to hand over and fleet bills are read from the log, so they follow.
 * A reservation the swap completed stays completed; greenpoints it earned stay.
 */
export async function deleteSwap(c: WorkCtx, stationId: string, swapId: string, restoreCounter: boolean): Promise<void> {
  const { actor, row } = await swapEditor(c, stationId, swapId);
  if (row.payment === "wallet" && actor.role !== "admin") throw new ApiError("swap_credit_admin_only", 403);
  const db = c.db;
  const now = nowIso();
  const exists = "exists (select 1 from swap_log where id = ?)";
  const statements: D1PreparedStatement[] = [];
  if (restoreCounter) {
    statements.push(
      ...eventStatements(db, {
        stationId,
        key: row.battery_type_id,
        type: "correction",
        delta: 1,
        emptyDelta: row.has_battery_in ? -1 : 0,
        reason: SWAP_DELETED_REASON,
        // One per swap: deleting it twice breaks the unique request id and changes nothing.
        requestId: `swap-delete:${row.id}`,
        swapId: row.id,
        actor,
        now,
        onlyIf: { sql: "exists (select 1 from swap_log where id = ?12)", value: row.id },
      }),
    );
  }
  // Battery register: first the batteries this swap brought into it (nothing else of theirs).
  statements.push(
    db
      .prepare(
        `delete from batteries where id in (select battery_id from battery_history where swap_id = ?1 and type = 'added_at_swap')
           and not exists (select 1 from battery_history h where h.battery_id = batteries.id and coalesce(h.swap_id, '') <> ?1)
           and ${exists}`,
      )
      .bind(row.id, row.id),
    db.prepare(`delete from battery_history where swap_id = ?1 and type in ('out', 'in', 'added_at_swap') and ${exists}`).bind(row.id, row.id),
  );
  // Where the batteries are, when this swap was their last move: handed out = back at the station;
  // brought in = where their move before left them (else unknown).
  const last = (column: string) =>
    `(select ${column} from battery_history h where h.battery_id = ?1 and h.type in ('out', 'in') order by h.created_at desc limit 1)`;
  if (row.battery_out_id) {
    statements.push(
      db
        .prepare(
          `update batteries set location = 'station', station_id = ?2, holder_user_id = null, last_swap_at = ${last("h.created_at")}
           where id = ?1 and last_swap_at = ?3 and exists (select 1 from swap_log where id = ?4)`,
        )
        .bind(row.battery_out_id, stationId, row.created_at, row.id),
    );
  }
  if (row.battery_in_id) {
    statements.push(
      db
        .prepare(
          `update batteries set
             location = coalesce(${last("case h.type when 'out' then 'customer' else 'station' end")}, 'unknown'),
             station_id = ${last("case h.type when 'in' then h.station_id end")},
             holder_user_id = ${last("case h.type when 'out' then h.holder_user_id end")},
             last_swap_at = ${last("h.created_at")}
           where id = ?1 and last_swap_at = ?2 and exists (select 1 from swap_log where id = ?3)`,
        )
        .bind(row.battery_in_id, row.created_at, row.id),
    );
  }
  if (row.payment === "wallet" && row.wallet_trx_id && row.customer_user_id && row.amount_xof > 0) {
    // The credit back, once: (trx_id, attribute) is unique on the ledger.
    statements.push(
      db.prepare("update wallets set balance_xof = balance_xof + ?1, updated_at = ?2 where user_id = ?3 and exists (select 1 from swap_log where id = ?4)").bind(row.amount_xof, now, row.customer_user_id, row.id),
      db
        .prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_label, remark, admin_id, details, created_at, station_id)
           select ?1, ?2, ?3, 'charge', 'received', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3),
             (select name from stations where id = ?5), ?6, ?7, ?8, ?9, ?5
           where exists (select 1 from swap_log where id = ?10)`,
        )
        .bind(uuid(), row.wallet_trx_id, row.customer_user_id, row.amount_xof, stationId, "Remboursement : échange supprimé", actor.user.id, JSON.stringify({ swap: row.id, swapRefund: true }), now, row.id),
    );
  }
  statements.push(
    swapAudit(db, actor, "delete", row, {
      customer_type: row.customer_type,
      payment: row.payment,
      amount_xof: row.amount_xof,
      battery_in: row.battery_in_label,
      battery_out: row.battery_out_label,
      created_at: row.created_at,
      counter_restored: restoreCounter,
      ...(row.payment === "wallet" ? { refunded_xof: row.amount_xof } : {}),
    }),
    db.prepare("delete from swap_log where id = ?").bind(row.id),
  );
  try {
    await db.batch(statements);
  } catch (err) {
    if (isUnique(err)) throw new ApiError("swap_not_found", 404);
    throw err;
  }
}

// Offline swaps to check and refused (migration 0071) --------------------------------------

/** POST /api/stations/:id/swaps/:swapId/checked: an owner or admin looked at a swap marked to check. */
export async function markSwapChecked(c: WorkCtx, stationId: string, swapId: string): Promise<SwapEntry> {
  const { actor, row } = await swapEditor(c, stationId, swapId);
  if (!row.review) return toSwap(row);
  const now = nowIso();
  await c.db.batch([
    c.db.prepare("update swap_log set reviewed_at = ?, reviewed_by = ? where id = ? and reviewed_at is null").bind(now, actor.user.id, row.id),
    swapAudit(c.db, actor, "update", row, { reviewed: true }),
  ]);
  const updated = await c.db.prepare(`${SWAP_SELECT} where l.id = ?`).bind(row.id).first<SwapRow>();
  return toSwap(updated ?? row);
}

interface RejectRow {
  id: string;
  request_id: string;
  station_id: string;
  station_name: string | null;
  occurred_at: string;
  error: string;
  payload: string;
  created_at: string;
  resolved_at: string | null;
  p_name: string | null;
  p_phone: string | null;
  p_email: string | null;
}

function toReject(r: RejectRow): OfflineSwapReject {
  let input: SwapInput;
  try {
    input = JSON.parse(r.payload) as SwapInput;
  } catch {
    input = { requestId: r.request_id, customerType: "cash" };
  }
  return {
    id: r.id,
    requestId: r.request_id,
    stationId: r.station_id,
    stationName: r.station_name,
    person: label(r.p_name, r.p_phone, r.p_email) ?? "",
    occurredAt: r.occurred_at,
    error: r.error,
    input,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  };
}

/** GET /api/admin/offline-swap-rejects: refused offline swaps not dealt with yet, newest first (admins). */
export async function offlineSwapRejects(c: WorkCtx & { requireAdmin(): Promise<Profile> }): Promise<OfflineSwapReject[]> {
  await c.requireAdmin();
  const { results } = await c.db
    .prepare(
      `select r.*, s.name as station_name, u.full_name as p_name, u.phone as p_phone, u.email as p_email
       from offline_swap_rejects r left join stations s on s.id = r.station_id left join users u on u.id = r.staff_id
       where r.resolved_at is null order by r.created_at desc limit 200`,
    )
    .all<RejectRow>();
  return results.map(toReject);
}

/** POST /api/admin/offline-swap-rejects/:id/resolve: the admin dealt with it (counter corrected, swap entered by hand). */
export async function resolveOfflineReject(c: WorkCtx & { requireAdmin(): Promise<Profile> }, id: string): Promise<{ ok: true }> {
  const admin = await c.requireAdmin();
  const done = await c.db
    .prepare("update offline_swap_rejects set resolved_at = ?, resolved_by = ? where id = ? and resolved_at is null")
    .bind(nowIso(), admin.id, id)
    .run();
  if (!done.meta.changes) throw new ApiError("offline_reject_not_found", 404);
  return { ok: true };
}
