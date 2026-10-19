// Drivers: express trips between stations, pickups at a customer's home, home
// deliveries, rides (the customer themselves from A to B) and couriers (a parcel door to door). Shared rules in src/lib/drivers.ts, plan in planung/fahrer.md.
import {
  ABANDON_REASONS,
  balanceOf,
  BUSY_JOB_STATUSES,
  DEFAULT_DRIVER_SETTINGS,
  driverEarning,
  fareFor,
  FLEET_VEHICLE_TYPES,
  inServiceArea,
  MAX_DRIVER_IMAGE_BYTES,
  nearestStation,
  newDriverCode,
  parseDriverBadge,
  pickDriver,
  validPoint,
  validSettings,
  vehicleFits,
  freshPosition,
  POSITION_FRESH_MINUTES,
  TOUR_KINDS,
  TRACKED_JOB_STATUSES,
  type DriverPosition,
  MAX_PASSENGERS,
  OPEN_JOB_EXPIRY_MINUTES,
  signDriverPass,
  checkDriverPass,
  isDriverPassFormat,
  type AbandonReason,
  type DriverPass,
  type AdminDrivers,
  type DeliveryJob,
  type Driver,
  type DriverApplication,
  type DriverAtStation,
  type DriverDecision,
  type DriverDocument,
  type DriverHome,
  type DriverSettings,
  type FleetVehicle,
  type FleetVehicleInput,
  type FleetVehicleType,
  type HomePoint,
  type JobKind,
  type JobStatus,
  type LedgerEntry,
  type PickupBooking,
  type QueueEntry,
  type RideBooking,
  type CourierBooking,
  type BookableVehicleType,
  BOOKABLE_VEHICLE_TYPES,
  withAllVehicles,
  jobFits,
  type StationDrivers,
} from "../src/lib/drivers";
import { distanceMeters, type LatLng } from "../src/lib/geo";
import {
  PARCEL_CODE_LOCK_MINUTES,
  PARCEL_MAX_CODE_FAILURES,
  PARCEL_SIZES,
  parsePickupInput,
  sizeFor,
  validMeasures,
  type ParcelMeasures,
  type ParcelSize,
} from "../src/lib/parcels";
import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { driversEnabled, requireDrivers } from "./features";
import { requireService, unlockedStations, unlockedSql } from "./services";
import { tripStatement } from "./greenpoint";
import { formerAccountOf } from "./former-accounts";
import { DB_CUSTOMER, DB_DRIVER, refuseNonCustomer } from "./roles";
import { autoCheckouts, bookingShop, hourlyTrip, membershipOf, openCheckin, type MerchantRow } from "./merchant-rules";
import { FAVORITE_ROUND_MINUTES } from "../src/lib/merchants";
import { ApiError, nowIso, randomDigits, uuid } from "./http";
import { EMAIL_FROM, notifyPerson, type Message } from "./notify";
import { noticeOf, sendPush } from "./push";
import { cashDue, cleanPayWith, hasOpenPayout, payoutOf, refundStatements, requestPayout, walletFailure, walletPayment } from "./trip-payments";
import {
  accountFor,
  APP_URL,
  arriveParcel,
  shortDate,
  cleanName,
  event,
  insertParcel,
  parcelStationActor,
  party,
  requireCustomerNumber,
  requireDepot,
  requireStaff,
  requireStationActor,
  sizes,
  station,
  type ParcelCtx,
  type ParcelRow,
} from "./parcels";
import { scannedParcel, scanStatement } from "./parcel-runs";
import { withPickupCodeTry } from "./code-tries";

// Rows ---------------------------------------------------------------------------

export interface DriverRow {
  user_id: string;
  status: Driver["status"];
  full_name: string;
  id_number: string;
  license_number: string;
  wanted_type: FleetVehicleType;
  id_doc_key: string | null;
  license_doc_key: string | null;
  portrait_key: string | null;
  vehicle_id: string | null;
  code: string;
  created_at: string;
  reviewed_at: string | null;
  phone: string | null;
  /** users.role: only 'driver' accounts drive (0030, R1). */
  u_role: string;
  v_type: FleetVehicleType | null;
  v_plate: string | null;
  v_active: number | null;
}

export const DRIVER_SELECT = `select d.*, u.phone, u.role as u_role, v.type as v_type, v.plate as v_plate, v.is_active as v_active
  from drivers d join users u on u.id = d.user_id left join fleet_vehicles v on v.id = d.vehicle_id`;

export interface JobRow {
  id: string;
  kind: JobKind;
  status: JobStatus;
  parcel_id: string | null;
  customer_user_id: string | null;
  customer_name: string | null;
  from_station_id: string | null;
  to_station_id: string | null;
  home_lat: number | null;
  home_lng: number | null;
  home_note: string | null;
  home_phone: string | null;
  size: ParcelSize;
  weight_kg: number | null;
  content: string;
  declared_value: number | null;
  recipient_phone: string | null;
  recipient_name: string | null;
  distance_m: number;
  fare_fcfa: number;
  collect_fcfa: number;
  driver_id: string | null;
  driver_station_id: string | null;
  declined: string;
  created_at: string;
  assigned_at: string | null;
  accepted_at: string | null;
  picked_up_at: string | null;
  at_door_at: string | null;
  done_at: string | null;
  proof_key: string | null;
  cancelled_by: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_note: string | null;
  passengers: number | null;
  vehicle_type: FleetVehicleType | null;
  handover_code?: string | null;
  /** Couriers finished with the photo alone (0053): 'pending' until the sender or an admin confirms, then 'approved'; or an admin rejected the photo (0059). */
  proof_review?: "pending" | "approved" | "rejected" | null;
  /** Why the admin rejected the photo (0059). */
  proof_reject_reason?: string | null;
  /** Which of the driver's trips this is on a tour (0037); 1 outside tours. */
  tour_slot?: number;
  /** Paid online from the wallet (0037), and when that went back. */
  prepaid_fcfa?: number | null;
  prepaid_refunded_at?: string | null;
  /** The shop that booked the trip and who of it (0035_merchants.sql). */
  merchant_id?: string | null;
  booked_by?: string | null;
  tracking_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_plate: string | null;
  driver_vehicle: FleetVehicleType | null;
  /** The driver's last reported position (driver_positions, 0037). */
  driver_lat?: number | null;
  driver_lng?: number | null;
  driver_pos_at?: string | null;
}

export const JOB_SELECT = `select j.*, p.tracking_no, d.full_name as driver_name, u.phone as driver_phone,
    v.plate as driver_plate, v.type as driver_vehicle, dp.lat as driver_lat, dp.lng as driver_lng, dp.at as driver_pos_at
  from delivery_jobs j
  left join parcels p on p.id = j.parcel_id
  left join drivers d on d.user_id = j.driver_id
  left join users u on u.id = j.driver_id
  left join fleet_vehicles v on v.id = d.vehicle_id
  left join driver_positions dp on dp.driver_id = j.driver_id`;

export const BUSY_SQL = `(${BUSY_JOB_STATUSES.map((s) => `'${s}'`).join(", ")})`;

/** Where the driver of a trip is, while the customer may see it (TRACKED_JOB_STATUSES) and it is fresh. */
function jobPosition(r: JobRow): DriverPosition | null {
  if (!TRACKED_JOB_STATUSES.includes(r.status) || r.driver_lat == null || r.driver_lng == null || !r.driver_pos_at) return null;
  return freshPosition({ lat: r.driver_lat, lng: r.driver_lng, at: r.driver_pos_at });
}

export function toJob(r: JobRow): DeliveryJob {
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    parcelId: r.parcel_id,
    trackingNo: r.tracking_no ?? null,
    fromStationId: r.from_station_id,
    toStationId: r.to_station_id,
    home:
      r.home_lat != null && r.home_lng != null
        ? { lat: r.home_lat, lng: r.home_lng, note: r.home_note ?? "", phone: r.home_phone ?? "" }
        : null,
    dropoff: r.dropoff_lat != null && r.dropoff_lng != null ? { lat: r.dropoff_lat, lng: r.dropoff_lng, note: r.dropoff_note ?? "" } : null,
    passengers: r.passengers,
    vehicleType: r.vehicle_type ?? null,
    size: r.size,
    weightKg: r.weight_kg,
    content: r.content,
    distanceM: r.distance_m,
    fareFcfa: r.fare_fcfa,
    collectFcfa: cashDue(r),
    ...(r.prepaid_fcfa ? { prepaidFcfa: r.prepaid_fcfa, ...(r.prepaid_refunded_at ? { refunded: true as const } : {}) } : {}),
    recipient: r.recipient_phone ? { phone: r.recipient_phone, name: r.recipient_name } : null,
    declaredValue: r.declared_value,
    driver: r.driver_id
      ? {
          name: r.driver_name ?? "",
          phone: r.driver_phone ?? null,
          plate: r.driver_plate ?? null,
          vehicleType: r.driver_vehicle ?? null,
          position: jobPosition(r),
        }
      : null,
    customerName: r.customer_name,
    createdAt: r.created_at,
    assignedAt: r.assigned_at,
    acceptedAt: r.accepted_at,
    pickedUpAt: r.picked_up_at,
    atDoorAt: r.at_door_at,
    doneAt: r.done_at,
    proofKey: r.proof_key,
    ...(r.status === "cancelled" && r.cancelled_by === NO_DRIVER ? { noDriver: true } : {}),
    ...(r.merchant_id ? { forShop: true as const } : {}),
    ...(r.proof_review ? { proofReview: r.proof_review } : {}),
    ...(r.proof_review === "rejected" && r.proof_reject_reason ? { proofRejectReason: r.proof_reject_reason } : {}),
  };
}

export function toVehicle(r: { id: string; type: FleetVehicleType; plate: string; is_active: number }): FleetVehicle {
  return { id: r.id, type: r.type, plate: r.plate, isActive: !!r.is_active };
}

/** Ride vehicles we have at least one active vehicle of; customers cannot book the others yet. */
export async function bookableVehicles(db: D1Database): Promise<BookableVehicleType[]> {
  const { results } = await db.prepare("select distinct type from fleet_vehicles where is_active = 1").all<{ type: FleetVehicleType }>();
  return BOOKABLE_VEHICLE_TYPES.filter((type) => results.some((r) => r.type === type));
}

// Settings -----------------------------------------------------------------------

export async function driverSettings(db: D1Database): Promise<DriverSettings> {
  const row = await db.prepare("select settings from driver_settings where id = 1").first<{ settings: string }>();
  if (!row) return DEFAULT_DRIVER_SETTINGS;
  try {
    const parsed = withAllVehicles(JSON.parse(row.settings) as DriverSettings);
    return validSettings(parsed) ? parsed : DEFAULT_DRIVER_SETTINGS;
  } catch {
    return DEFAULT_DRIVER_SETTINGS;
  }
}

export async function saveDriverSettings(c: ParcelCtx, input: unknown) {
  const admin = await c.requireAdmin();
  const next = input as DriverSettings;
  if (!validSettings(next)) throw new ApiError("bad_request");
  const clean: DriverSettings = {
    baseFcfa: next.baseFcfa,
    perKmFcfa: next.perKmFcfa,
    expressFcfa: next.expressFcfa,
    driverSharePct: next.driverSharePct,
    cashLimitFcfa: next.cashLimitFcfa,
    waitMinutes: next.waitMinutes,
    acceptMinutes: next.acceptMinutes,
    queueRadiusM: next.queueRadiusM,
    tourMax: next.tourMax,
    tourRadiusM: next.tourRadiusM,
    vehicles: FLEET_VEHICLE_TYPES.map((type) => {
      const v = next.vehicles.find((x) => x.type === type)!;
      return { type, maxSize: v.maxSize, maxWeightKg: v.maxWeightKg };
    }),
  };
  const before = await driverSettings(c.db);
  const changes: Record<string, unknown> = {};
  for (const key of Object.keys(clean) as (keyof DriverSettings)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(clean[key])) changes[key] = [before[key], clean[key]];
  }
  await c.db.batch([
    c.db
      .prepare(
        "insert into driver_settings (id, settings, updated_at) values (1, ?, ?) on conflict (id) do update set settings = excluded.settings, updated_at = excluded.updated_at",
      )
      .bind(JSON.stringify(clean), nowIso()),
    c.audit(admin.id, "driver_settings", "update", "settings", changes),
  ]);
}

// Helpers ------------------------------------------------------------------------

interface DepotPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

/** Stations with an active parcel depot: drivers queue there and hand parcels over there. */
async function depotStations(db: D1Database): Promise<DepotPoint[]> {
  const { results } = await db
    .prepare(
      "select s.id, s.name, s.lat, s.lng from parcel_depots d join stations s on s.id = d.station_id where d.is_active = 1 and s.is_active = 1",
    )
    .all<DepotPoint>();
  return results;
}

async function stationPoint(db: D1Database, id: string | null): Promise<LatLng | null> {
  if (!id) return null;
  return db.prepare("select lat, lng from stations where id = ?").bind(id).first<LatLng>();
}

export async function balance(db: D1Database, driverId: string): Promise<{ balance: number; lastSettledAt: string | null }> {
  const { results } = await db
    .prepare("select kind, sum(amount_fcfa) as amount, max(at) as last from driver_ledger where driver_id = ? group by kind")
    .bind(driverId)
    .all<{ kind: LedgerEntry["kind"]; amount: number; last: string }>();
  return {
    balance: balanceOf(results.map((r) => ({ kind: r.kind, amountFcfa: r.amount }))),
    lastSettledAt: results.find((r) => r.kind === "settlement")?.last ?? null,
  };
}

export async function queueOf(db: D1Database, driverId: string): Promise<Driver["queue"]> {
  const row = await db
    .prepare(
      `select q.station_id, q.since,
        (select count(*) from driver_queue o where o.station_id = q.station_id and o.since <= q.since) as position
       from driver_queue q where q.driver_id = ?`,
    )
    .bind(driverId)
    .first<{ station_id: string; since: string; position: number }>();
  return row ? { stationId: row.station_id, since: row.since, position: row.position } : null;
}

async function toDriver(db: D1Database, r: DriverRow, withCode: boolean): Promise<Driver> {
  const [money, queue] = await Promise.all([balance(db, r.user_id), queueOf(db, r.user_id)]);
  const documents: Driver["documents"] = {};
  if (r.id_doc_key) documents.id = r.id_doc_key;
  if (r.license_doc_key) documents.license = r.license_doc_key;
  if (r.portrait_key) documents.portrait = r.portrait_key;
  return {
    userId: r.user_id,
    status: r.status,
    fullName: r.full_name,
    phone: r.phone,
    idNumber: r.id_number,
    licenseNumber: r.license_number,
    wantedType: r.wanted_type,
    vehicle: r.vehicle_id && r.v_type ? { id: r.vehicle_id, type: r.v_type, plate: r.v_plate ?? "", isActive: !!r.v_active } : null,
    documents,
    ...(withCode ? { code: r.code } : {}),
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
    balanceFcfa: money.balance,
    lastSettledAt: money.lastSettledAt,
    queue,
  };
}

export async function driverRow(db: D1Database, userId: string): Promise<DriverRow | null> {
  return db.prepare(`${DRIVER_SELECT} where d.user_id = ?`).bind(userId).first<DriverRow>();
}

/** A driver row that may drive: approved, on a driver account (role 'driver', not just a drivers row). */
function drives(row: DriverRow | null): row is DriverRow {
  return !!row && row.status === "active" && row.u_role === DB_DRIVER;
}

/** The signed-in user as an active driver. */
async function requireDriver(c: ParcelCtx): Promise<{ user: Profile; row: DriverRow }> {
  const user = await c.requireUser();
  if (user.role !== "driver") throw new ApiError("not_a_driver", 403);
  const row = await driverRow(c.db, user.id);
  if (!drives(row)) throw new ApiError("not_a_driver", 403);
  return { user, row };
}

export async function loadJob(db: D1Database, id: string): Promise<JobRow> {
  const row = await db.prepare(`${JOB_SELECT} where j.id = ?`).bind(id).first<JobRow>();
  if (!row) throw new ApiError("job_not_found", 404);
  return row;
}

export async function currentJob(db: D1Database, driverId: string): Promise<JobRow | null> {
  return (await busyJobs(db, driverId))[0] ?? null;
}

/** Every trip a driver has under way (several on a tour, phase 2): an open offer first, then by slot. */
export async function busyJobs(db: D1Database, driverId: string): Promise<JobRow[]> {
  const { results } = await db
    .prepare(`${JOB_SELECT} where j.driver_id = ? and j.status in ${BUSY_SQL} order by j.status = 'assigned' desc, j.tour_slot, j.assigned_at`)
    .bind(driverId)
    .all<JobRow>();
  return results;
}

/** jobFits (src/lib/drivers.ts) for a row. */
function rowFits(job: Pick<JobRow, "kind" | "vehicle_type" | "passengers" | "size">, type: FleetVehicleType, weightKg: number, s: DriverSettings): boolean {
  return jobFits({ kind: job.kind, vehicleType: job.vehicle_type, passengers: job.passengers, size: job.size }, type, weightKg, s);
}

/** The heaviest a parcel of this size may weigh, for trips booked before it is weighed. */
async function maxWeight(db: D1Database, size: ParcelSize): Promise<number> {
  return (await sizes(db)).find((t) => t.size === size)?.maxWeightKg ?? 50;
}

/** Changes a trip's status only if it is still in `from`; false when someone else was quicker. */
async function moveJob(db: D1Database, id: string, from: JobStatus[], set: string, ...params: unknown[]): Promise<boolean> {
  const res = await db
    .prepare(`update delivery_jobs set ${set} where id = ? and status in (${from.map(() => "?").join(", ")})`)
    .bind(...params, id, ...from)
    .run();
  return !!res.meta.changes;
}

/**
 * moveJob for the driver who holds the trip: only while it is still theirs. Dispatch or an admin
 * may hand it to someone else between reading the trip and this update.
 */
async function moveMyJob(db: D1Database, job: Pick<JobRow, "id" | "driver_id">, from: JobStatus[], set: string, ...params: unknown[]): Promise<boolean> {
  if (!job.driver_id) return false;
  const res = await db
    .prepare(`update delivery_jobs set ${set} where id = ? and driver_id = ? and status in (${from.map(() => "?").join(", ")})`)
    .bind(...params, job.id, job.driver_id, ...from)
    .run();
  return !!res.meta.changes;
}

function jobAudit(c: ParcelCtx, actor: string | null, r: Pick<JobRow, "id" | "from_station_id" | "to_station_id" | "driver_id">, changes: Record<string, unknown>) {
  return c.audit(actor, "delivery_jobs", "update", r.id, changes, { stationId: r.from_station_id ?? r.to_station_id, userId: r.driver_id });
}

function ledger(c: ParcelCtx, driverId: string, kind: LedgerEntry["kind"], amount: number, jobId: string | null, stationId: string | null, actor: string) {
  return c.db
    .prepare("insert into driver_ledger (id, driver_id, at, kind, amount_fcfa, job_id, station_id, actor) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(uuid(), driverId, nowIso(), kind, amount, jobId, stationId, actor);
}

/**
 * Puts a driver back at the end of the line at the station they were offered the
 * trip from, unless they are no longer active, lost their vehicle or owe the cash limit.
 */
async function requeue(db: D1Database, driverId: string, stationId: string | null, s: DriverSettings): Promise<D1PreparedStatement[]> {
  if (!stationId) return [];
  // Still carrying other trips of a tour: back in line only once they are done.
  if (await currentJob(db, driverId)) return [];
  const row = await driverRow(db, driverId);
  if (!drives(row) || !row.vehicle_id || !row.v_active) return [];
  if ((await balance(db, driverId)).balance >= s.cashLimitFcfa) return [];
  return [db.prepare("insert or ignore into driver_queue (driver_id, station_id, since) values (?, ?, ?)").bind(driverId, stationId, nowIso())];
}

/**
 * Tells a driver or customer about a trip. About a parcel through notifyPerson
 * (logged with the parcel); otherwise by e-mail when the account has an address.
 * Everyone also sees their trip in the app. Never throws.
 */
async function tellUser(env: Env | undefined, userId: string | null, parcelId: string | null, kind: string, message: Message) {
  if (!env || !userId) return;
  // Phase 2: a push notice reaches the phone even with the app closed.
  await sendPush(env, userId, noticeOf(message));
  if (parcelId) return notifyPerson(env, parcelId, kind, userId, message);
  if (!env.EMAIL) return;
  try {
    const user = await env.DB.prepare("select email from users where id = ?").bind(userId).first<{ email: string | null }>();
    if (user?.email) await env.EMAIL.send({ from: { email: EMAIL_FROM, name: "poinderecharge" }, to: user.email, subject: message.subject, text: message.text });
  } catch (err) {
    console.error("Trip notification failed", kind, (err as Error).message);
  }
}

const DRIVER_URL = "https://app.poinderecharge.com/chauffeur";

/** The driver was offered a trip: they have acceptMinutes to say "J'y vais". */
function tellOffer(env: Env | undefined, driverId: string, job: Pick<JobRow, "kind" | "parcel_id">, s: DriverSettings) {
  return tellUser(env, driverId, job.parcel_id, "driver_offer", {
    subject: "Nouvelle course pour vous",
    text: `poinderecharge : une course vous est proposée. Confirmez-la dans les ${s.acceptMinutes} minutes, sinon elle passe au suivant : ${DRIVER_URL}`,
  });
}

// Dispatch -----------------------------------------------------------------------

/**
 * Hands open trips to drivers: offers not confirmed in time go back (the driver
 * goes to the end of the line where they were), then each open trip goes to the
 * first in line at the nearest station with a fitting vehicle, who is told by
 * e-mail. Runs every minute (runDispatch, the only regular trigger) and once right
 * after a write that creates a trip or frees one or a driver (booking, joining the line,
 * declining, giving back, cancelling), so a new trip is offered at once. Pages that
 * only read (driver, station, fleet, shop, backoffice) never run it: offers that ran
 * out wait for the next minute, and acceptJob refuses them in between.
 */
export async function dispatch(c: Pick<ParcelCtx, "db" | "audit"> & { env?: Env }) {
  const s = await driverSettings(c.db);
  const stale = new Date(Date.now() - s.acceptMinutes * 60_000).toISOString();
  const { results: expired } = await c.db
    .prepare("select id, driver_id, driver_station_id, from_station_id, to_station_id from delivery_jobs where status = 'assigned' and assigned_at < ?")
    .bind(stale)
    .all<Pick<JobRow, "id" | "driver_id" | "driver_station_id" | "from_station_id" | "to_station_id">>();
  for (const r of expired) {
    const declined = r.driver_id ? `,${r.driver_id}` : "";
    if (await moveJob(c.db, r.id, ["assigned"], "status = 'open', driver_id = null, assigned_at = null, declined = declined || ?", declined)) {
      await c.db.batch([
        jobAudit(c as ParcelCtx, null, r, { status: ["assigned", "open"], reason: "not_confirmed" }),
        ...(r.driver_id ? await requeue(c.db, r.driver_id, r.driver_station_id, s) : []),
      ]);
    }
  }

  await expireOpenJobs(c);
  await autoCheckouts(c);

  const { results: open } = await c.db
    .prepare("select * from delivery_jobs where status = 'open' order by created_at limit 50")
    .all<JobRow>();
  if (!open.length) return;
  // Drivers checked in at a shop (planung/marchand.md): free, with an active vehicle; they
  // only get that shop's trips, the one who checked in first first.
  const shopIds = [...new Set(open.map((j) => j.merchant_id).filter((id): id is string => !!id))];
  let checkedIn: { driverId: string; merchantId: string; inAt: string; vehicleType: FleetVehicleType }[] = [];
  const favorites = new Map<string, Set<string>>();
  if (shopIds.length) {
    const marks = shopIds.map(() => "?").join(", ");
    const [ins, favs] = await Promise.all([
      c.db
        .prepare(
          `select k.driver_id, k.merchant_id, k.in_at, v.type from merchant_checkins k
           join drivers d on d.user_id = k.driver_id join users u on u.id = d.user_id join fleet_vehicles v on v.id = d.vehicle_id
           where k.out_at is null and k.merchant_id in (${marks}) and d.status = 'active' and u.role = '${DB_DRIVER}' and v.is_active = 1
             and not exists (select 1 from delivery_jobs b where b.driver_id = k.driver_id and b.status in ${BUSY_SQL})
           order by k.in_at`,
        )
        .bind(...shopIds)
        .all<{ driver_id: string; merchant_id: string; in_at: string; type: FleetVehicleType }>(),
      c.db
        .prepare(`select merchant_id, driver_id from merchant_drivers where kind = 'favorite' and status = 'active' and merchant_id in (${marks})`)
        .bind(...shopIds)
        .all<{ merchant_id: string; driver_id: string }>(),
    ]);
    checkedIn = ins.results.map((r) => ({ driverId: r.driver_id, merchantId: r.merchant_id, inAt: r.in_at, vehicleType: r.type }));
    for (const f of favs.results) favorites.set(f.merchant_id, (favorites.get(f.merchant_id) ?? new Set()).add(f.driver_id));
  }
  const { results: queueRows } = await c.db
    .prepare(
      `select q.driver_id, q.station_id, q.since, v.type from driver_queue q
       join drivers d on d.user_id = q.driver_id join users u on u.id = d.user_id join fleet_vehicles v on v.id = d.vehicle_id
       where d.status = 'active' and u.role = '${DB_DRIVER}' and v.is_active = 1 and ${unlockedSql("q.station_id", "drivers")}
         and not exists (select 1 from delivery_jobs b where b.driver_id = q.driver_id and b.status in ${BUSY_SQL})`,
    )
    .all<{ driver_id: string; station_id: string; since: string; type: FleetVehicleType }>();
  let queue: QueueEntry[] = queueRows.map((q) => ({ driverId: q.driver_id, stationId: q.station_id, since: q.since, vehicleType: q.type }));
  const taken = new Set<string>();
  if (!queue.length && !checkedIn.length) {
    await offerTours(c, open, taken, s);
    return;
  }
  const stations = await depotStations(c.db);
  const points = new Map(stations.map((st) => [st.id, st]));
  const offers: Promise<void>[] = [];
  const favoriteSince = new Date(Date.now() - FAVORITE_ROUND_MINUTES * 60_000).toISOString();

  for (const job of open) {
    const fromHome = job.kind === "pickup" || job.kind === "ride" || job.kind === "courier";
    const start = fromHome ? (job.home_lat != null ? { lat: job.home_lat, lng: job.home_lng! } : null) : points.get(job.from_station_id ?? "") ?? (await stationPoint(c.db, job.from_station_id));
    if (!start) continue;
    const declined = new Set(job.declined.split(",").filter(Boolean));
    const weight = job.weight_kg ?? (await maxWeight(c.db, job.size));
    const fits = (type: FleetVehicleType) => rowFits(job, type, weight, s);
    // A shop trip: its checked-in drivers first, then for a few minutes its favorites in the queue, then everyone.
    let pick: { driverId: string; stationId: string | null } | null = null;
    if (job.merchant_id) {
      for (const k of checkedIn) {
        if (k.merchantId !== job.merchant_id || declined.has(k.driverId) || !fits(k.vehicleType)) continue;
        if ((await balance(c.db, k.driverId)).balance >= s.cashLimitFcfa) continue;
        pick = { driverId: k.driverId, stationId: null };
        break;
      }
      const favs = favorites.get(job.merchant_id);
      if (!pick && favs && job.created_at > favoriteSince) {
        pick = pickDriver(start, queue.filter((q) => favs.has(q.driverId) && !declined.has(q.driverId)), stations, fits);
      }
    }
    pick ??= pickDriver(start, queue.filter((q) => !declined.has(q.driverId)), stations, fits);
    if (!pick) continue;
    const picked = pick.driverId;
    queue = queue.filter((q) => q.driverId !== picked);
    checkedIn = checkedIn.filter((k) => k.driverId !== picked);
    const now = nowIso();
    try {
      if (
        await moveJob(c.db, job.id, ["open"], "status = 'assigned', driver_id = ?, driver_station_id = ?, assigned_at = ?, tour_slot = 1", pick.driverId, pick.stationId, now)
      ) {
        await c.db.batch([
          c.db.prepare("delete from driver_queue where driver_id = ?").bind(pick.driverId),
          jobAudit(c as ParcelCtx, null, { ...job, driver_id: pick.driverId }, { status: ["open", "assigned"], station: pick.stationId }),
        ]);
        offers.push(tellOffer(c.env, pick.driverId, job, s));
        taken.add(job.id);
      }
    } catch (err) {
      // The driver got another trip in the meantime (one trip per driver).
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
  await Promise.all(offers);
  await offerTours(c, open, taken, s);
}

/**
 * Tours (planung/fahrer.md phase 2): a parcel trip nobody in line took goes to a driver already
 * carrying parcels whose last position is within tourRadiusM of its start, nearest first, while
 * they have fewer than tourMax trips, no passenger and no offer waiting. Drivers checked in at a
 * shop keep to that shop's trips. The driver confirms it like any offer.
 */
async function offerTours(c: Pick<ParcelCtx, "db" | "audit"> & { env?: Env }, open: JobRow[], taken: Set<string>, s: DriverSettings) {
  if (s.tourMax < 2) return;
  const jobs = open.filter((j) => !taken.has(j.id) && TOUR_KINDS.includes(j.kind));
  if (!jobs.length) return;
  const fresh = new Date(Date.now() - POSITION_FRESH_MINUTES * 60_000).toISOString();
  const { results } = await c.db
    .prepare(
      `select d.user_id as driver_id, v.type, p.lat, p.lng,
              (select count(*) from delivery_jobs b where b.driver_id = d.user_id and b.status in ${BUSY_SQL}) as busy,
              (select group_concat(b.tour_slot) from delivery_jobs b where b.driver_id = d.user_id and b.status in ${BUSY_SQL}) as slots
         from drivers d join users u on u.id = d.user_id join fleet_vehicles v on v.id = d.vehicle_id
         join driver_positions p on p.driver_id = d.user_id
        where d.status = 'active' and u.role = '${DB_DRIVER}' and v.is_active = 1 and p.at >= ?
          and exists (select 1 from delivery_jobs b where b.driver_id = d.user_id and b.status in ${BUSY_SQL})
          and not exists (select 1 from delivery_jobs b where b.driver_id = d.user_id and b.status in ${BUSY_SQL}
                            and (b.status = 'assigned' or b.kind not in (${TOUR_KINDS.map((k) => `'${k}'`).join(", ")})))
          and not exists (select 1 from merchant_checkins k where k.driver_id = d.user_id and k.out_at is null)`,
    )
    .bind(fresh)
    .all<{ driver_id: string; type: FleetVehicleType; lat: number; lng: number; busy: number; slots: string | null }>();
  let drivers = results.filter((r) => r.busy < s.tourMax);
  if (!drivers.length) return;
  const stations = await depotStations(c.db);
  const offers: Promise<void>[] = [];
  for (const job of jobs) {
    const start =
      job.kind === "express" ? (stations.find((st) => st.id === job.from_station_id) ?? null) : job.home_lat != null ? { lat: job.home_lat, lng: job.home_lng! } : null;
    if (!start) continue;
    const declined = new Set(job.declined.split(",").filter(Boolean));
    const weight = job.weight_kg ?? (await maxWeight(c.db, job.size));
    const near = drivers
      .filter((d) => !declined.has(d.driver_id) && rowFits(job, d.type, weight, s))
      .map((d) => ({ d, m: distanceMeters(start, d) }))
      .filter((x) => x.m <= s.tourRadiusM)
      .sort((a, b) => a.m - b.m);
    for (const { d } of near) {
      if ((await balance(c.db, d.driver_id)).balance >= s.cashLimitFcfa) continue;
      const used = new Set((d.slots ?? "").split(",").map(Number));
      const slot = Array.from({ length: s.tourMax }, (_, i) => i + 1).find((n) => !used.has(n));
      if (!slot) continue;
      try {
        if (!(await moveJob(c.db, job.id, ["open"], "status = 'assigned', driver_id = ?, driver_station_id = null, assigned_at = ?, tour_slot = ?", d.driver_id, nowIso(), slot))) break;
      } catch (err) {
        // Another dispatch filled that slot at the same moment.
        if (!/UNIQUE/i.test(String(err))) throw err;
        continue;
      }
      await jobAudit(c as ParcelCtx, null, { ...job, driver_id: d.driver_id }, { status: ["open", "assigned"], tour_slot: slot }).run();
      offers.push(tellOffer(c.env, d.driver_id, job, s));
      // One offer at a time per driver: the next trip waits until they answer this one.
      drivers = drivers.filter((x) => x.driver_id !== d.driver_id);
      break;
    }
    if (!drivers.length) break;
  }
  await Promise.all(offers);
}

/** Trips customers booked from home: called off when no driver took them in time. Express trips stay with the station staff. */
const EXPIRING_KINDS: JobKind[] = ["pickup", "delivery", "ride", "courier"];

/**
 * A customer's trip nobody took within OPEN_JOB_EXPIRY_MINUTES is called off, so the
 * app does not show "looking for a driver" for ever; the customer is told and can book
 * again. Runs with every dispatch (the cron runs it every minute).
 */
async function expireOpenJobs(c: Pick<ParcelCtx, "db" | "audit"> & { env?: Env }) {
  const before = new Date(Date.now() - OPEN_JOB_EXPIRY_MINUTES * 60_000).toISOString();
  const { results } = await c.db
    .prepare(`${JOB_SELECT} where j.status = 'open' and j.created_at < ? and j.kind in (${EXPIRING_KINDS.map(() => "?").join(", ")}) limit 50`)
    .bind(before, ...EXPIRING_KINDS)
    .all<JobRow>();
  for (const job of results) {
    if (!(await closeJob(c, job, ["open"], NO_DRIVER))) continue;
    await tellUser(c.env, job.customer_user_id, job.parcel_id, "job_expired", {
      subject: "Aucun chauffeur disponible",
      text: `poinderecharge : aucun chauffeur n'a pu prendre votre course${job.tracking_no ? ` (colis ${job.tracking_no})` : ""}. Elle est annulée, rien n'est à payer. Vous pouvez en réserver une nouvelle dans l'app : ${APP_URL}`,
    });
  }
}

/**
 * The every-minute cron (worker/index.ts): offers go out and run out even while
 * nobody has the app open. Nothing happens while the driver module is off.
 */
export async function runDispatch(env: Env) {
  if (!(await driversEnabled(env.DB))) return;
  await dispatch({
    env,
    db: env.DB,
    audit: (actor, table, action, rowId, changes, ids = {}) =>
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(nowIso(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes)),
  });
}

// The driver ---------------------------------------------------------------------

export async function driverHome(c: ParcelCtx): Promise<DriverHome> {
  const user = await c.requireUser();
  const [row, s, formerAccount] = await Promise.all([
    driverRow(c.db, user.id),
    driverSettings(c.db),
    user.role === "driver" ? formerAccountOf(c.db, user.id) : Promise.resolve(null),
  ]);
  if (!row) return { driver: null, job: null, history: [], ledger: [], settings: s, lastExpiredAt: null, formerAccount };
  const [driver, jobs, history, entries, expired, payout] = await Promise.all([
    toDriver(c.db, row, true),
    busyJobs(c.db, user.id),
    c.db
      .prepare(`${JOB_SELECT} where j.driver_id = ? and j.status not in ${BUSY_SQL} order by j.created_at desc limit 30`)
      .bind(user.id)
      .all<JobRow>(),
    c.db
      .prepare("select * from driver_ledger where driver_id = ? order by at desc limit 100")
      .bind(user.id)
      .all<{ id: string; at: string; kind: LedgerEntry["kind"]; amount_fcfa: number; job_id: string | null; station_id: string | null }>(),
    // The offer that ran out is logged under the driver it was offered to (dispatch).
    c.db
      .prepare(
        `select max(at) as at from audit_log where table_name = 'delivery_jobs' and user_id = ? and json_extract(changes, '$.reason') = 'not_confirmed'`,
      )
      .bind(user.id)
      .first<{ at: string | null }>(),
    payoutOf(c.db, user.id),
  ]);
  return {
    payout,
    driver,
    job: jobs[0] ? toJob(jobs[0]) : null,
    jobs: jobs.map(toJob),
    history: history.results.map(toJob),
    ledger: entries.results.map((e) => ({ id: e.id, at: e.at, kind: e.kind, amountFcfa: e.amount_fcfa, jobId: e.job_id, stationId: e.station_id })),
    settings: s,
    lastExpiredAt: expired?.at ?? null,
    formerAccount,
  };
}

/** The key the driver passes are signed with: made once, kept in app_settings (never sent to anyone). */
export async function passSecret(db: D1Database): Promise<string> {
  const read = () => db.prepare("select value from app_settings where key = 'driver_pass_secret'").first<{ value: string }>();
  const row = await read();
  if (row) return row.value;
  const fresh = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await db
    .prepare("insert or ignore into app_settings (key, value, updated_at) values ('driver_pass_secret', ?, ?)")
    .bind(fresh, nowIso())
    .run();
  return (await read())!.value;
}

/**
 * The signed QR code the driver shows at a station (src/lib/drivers.ts, R10): staff hand
 * over parcels with it, and a battery swap billed to the driver's fleet needs it.
 */
export async function driverPass(c: ParcelCtx): Promise<DriverPass> {
  const { row } = await requireDriver(c);
  const fleet = await c.db.prepare("select manager_id from fleet_manager_drivers where driver_id = ?").bind(row.user_id).first<{ manager_id: string }>();
  return signDriverPass(await passSecret(c.db), row.code, fleet?.manager_id ?? null);
}

function cleanText(value: unknown, min: number, max: number): string {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) throw new ApiError("bad_request");
  return text;
}

/** The fields of a driver application, checked (400 otherwise). */
export function cleanApplication(input: DriverApplication | null | undefined): DriverApplication {
  const fullName = cleanText(input?.fullName, 2, 80);
  const idNumber = cleanText(input?.idNumber, 3, 40);
  const licenseNumber = cleanText(input?.licenseNumber, 3, 40);
  if (!input || !FLEET_VEHICLE_TYPES.includes(input.wantedType)) throw new ApiError("bad_request");
  return { fullName, idNumber, licenseNumber, wantedType: input.wantedType };
}

/**
 * Applies (or applies again after a refusal) to drive one of our vehicles. A driver account
 * whose application is still open (invited by a fleet, worker/fleet.ts) completes it here.
 */
export async function applyDriver(c: ParcelCtx, input: DriverApplication) {
  const user = await c.requireUser();
  // Customers apply; staff, owners, fleet managers and admins keep their role (F1, one role per account).
  if (user.role !== "customer" && user.role !== "driver") throw new ApiError("forbidden", 403);
  await requireDrivers(c.db);
  if (!user.phone) throw new ApiError("phone_required");
  const { fullName, idNumber, licenseNumber } = cleanApplication(input);
  const existing = await driverRow(c.db, user.id);
  if (existing && (existing.status === "active" || existing.status === "suspended")) throw new ApiError("forbidden", 403);
  if (!existing && user.role === "driver") throw new ApiError("forbidden", 403);
  const now = nowIso();
  if (existing) {
    await c.db.batch([
      c.db
        .prepare("update drivers set status = 'pending', full_name = ?, id_number = ?, license_number = ?, wanted_type = ? where user_id = ?")
        .bind(fullName, idNumber, licenseNumber, input.wantedType, user.id),
      c.audit(user.id, "drivers", "update", user.id, { status: [existing.status, "pending"] }, { userId: user.id }),
    ]);
    return;
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await c.db.batch([
        c.db
          .prepare(
            "insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values (?, 'pending', ?, ?, ?, ?, ?, ?)",
          )
          .bind(user.id, fullName, idNumber, licenseNumber, input.wantedType, newDriverCode(), now),
        c.audit(user.id, "drivers", "insert", user.id, { status: "pending", wanted_type: input.wantedType }, { userId: user.id }),
      ]);
      return;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
  throw new ApiError("unknown", 500);
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

/** Reads an uploaded photo (already shrunk in the app). */
async function readImage(c: ParcelCtx, request: Request): Promise<{ body: ArrayBuffer; type: string; ext: string }> {
  const type = (request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new ApiError("bad_request");
  if (Number(request.headers.get("Content-Length")) > MAX_DRIVER_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  const body = await request.arrayBuffer();
  if (!body.byteLength) throw new ApiError("bad_request");
  if (body.byteLength > MAX_DRIVER_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  return { body, type, ext };
}

const DOC_COLUMN: Record<DriverDocument, "id_doc_key" | "license_doc_key" | "portrait_key"> = {
  id: "id_doc_key",
  license: "license_doc_key",
  portrait: "portrait_key",
};

/** A photo of the ID card, the licence or the driver. Private: only admins see it. */
export async function uploadDriverDocument(c: ParcelCtx, kind: string, request: Request) {
  const user = await c.requireUser();
  // A customer applying, or a driver account invited by a fleet whose application is still open.
  if (user.role !== "customer" && user.role !== "driver") throw new ApiError("forbidden", 403);
  await requireDrivers(c.db);
  const column = DOC_COLUMN[kind as DriverDocument];
  if (!column) throw new ApiError("bad_request");
  const row = await driverRow(c.db, user.id);
  // No open application to complete: nothing to find (the role itself was checked above, R2).
  if (!row || (row.status !== "pending" && row.status !== "rejected")) throw new ApiError("driver_not_found", 404);
  const image = await readImage(c, request);
  const key = `drivers/${user.id}/${kind}-${uuid()}.${image.ext}`;
  await c.env.MEDIA.put(key, image.body, { httpMetadata: { contentType: image.type } });
  await c.db.prepare(`update drivers set ${column} = ? where user_id = ?`).bind(key, user.id).run();
  const old = row[column];
  if (old) await c.env.MEDIA.delete(old);
  return { key };
}

export async function joinQueue(c: ParcelCtx, stationId: string, position: unknown) {
  const { user, row } = await requireDriver(c);
  await requireDrivers(c.db);
  if (!row.vehicle_id || !row.v_active) throw new ApiError("no_vehicle");
  if (await currentJob(c.db, user.id)) throw new ApiError("driver_busy");
  // Checked in at a shop: only its trips until the driver checks out.
  if (await openCheckin(c.db, user.id)) throw new ApiError("checked_in_at_shop");
  const s = await driverSettings(c.db);
  if ((await balance(c.db, user.id)).balance >= s.cashLimitFcfa) throw new ApiError("cash_limit");
  await requireDepot(c.db, stationId);
  // Drivers queue only where the station is unlocked for them (worker/services.ts).
  await requireService(c.db, stationId, "drivers");
  if (s.queueRadiusM > 0) {
    const at = await stationPoint(c.db, stationId);
    if (!validPoint(position) || !at || distanceMeters(position, at) > s.queueRadiusM) throw new ApiError("too_far");
  }
  const mine = await queueOf(c.db, user.id);
  if (mine?.stationId !== stationId) {
    await c.db
      .prepare(
        "insert into driver_queue (driver_id, station_id, since) values (?, ?, ?) on conflict (driver_id) do update set station_id = excluded.station_id, since = excluded.since",
      )
      .bind(user.id, stationId, nowIso())
      .run();
  }
  await dispatch(c);
}

/**
 * The driver app reports where the driver is (driver phase 2), every POSITION_REPORT_SECONDS
 * while on duty: in a queue, checked in at a shop or on a trip. Off duty nothing is kept.
 * Returns whether the position was kept.
 */
export async function reportPosition(c: ParcelCtx, input: unknown): Promise<{ kept: boolean }> {
  const { user, row } = await requireDriver(c);
  const p = input as { lat?: unknown; lng?: unknown; accuracyM?: unknown } | null;
  const point = { lat: Number(p?.lat), lng: Number(p?.lng) };
  if (!validPoint(point)) throw new ApiError("bad_request");
  const accuracy = Number(p?.accuracyM);
  if (row.status !== "active") return { kept: false };
  const onDuty = await c.db
    .prepare(
      `select (exists (select 1 from driver_queue where driver_id = ?1)
            or exists (select 1 from merchant_checkins where driver_id = ?1 and out_at is null)
            or exists (select 1 from delivery_jobs where driver_id = ?1 and status in ${BUSY_SQL})) as on_duty`,
    )
    .bind(user.id)
    .first<{ on_duty: number }>();
  if (!onDuty?.on_duty) {
    await c.db.prepare("delete from driver_positions where driver_id = ?").bind(user.id).run();
    return { kept: false };
  }
  await c.db
    .prepare(
      `insert into driver_positions (driver_id, lat, lng, accuracy_m, at) values (?, ?, ?, ?, ?)
       on conflict (driver_id) do update set lat = excluded.lat, lng = excluded.lng, accuracy_m = excluded.accuracy_m, at = excluded.at`,
    )
    .bind(user.id, point.lat, point.lng, Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(accuracy, 100_000) : null, nowIso())
    .run();
  return { kept: true };
}

export async function leaveQueue(c: ParcelCtx) {
  const { user } = await requireDriver(c);
  await c.db.prepare("delete from driver_queue where driver_id = ?").bind(user.id).run();
}

async function myJob(c: ParcelCtx, jobId: string): Promise<{ user: Profile; job: JobRow }> {
  const { user } = await requireDriver(c);
  const job = await loadJob(c.db, jobId);
  if (job.driver_id !== user.id) throw new ApiError("job_not_found", 404);
  return { user, job };
}

export async function acceptJob(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  // An offer older than acceptMinutes has run out even if the cron has not taken it back yet.
  const s = await driverSettings(c.db);
  const stale = new Date(Date.now() - s.acceptMinutes * 60_000).toISOString();
  const res = job.driver_id
    ? await c.db
        .prepare("update delivery_jobs set status = 'accepted', accepted_at = ? where id = ? and driver_id = ? and status = 'assigned' and assigned_at >= ?")
        .bind(nowIso(), job.id, job.driver_id, stale)
        .run()
    : null;
  if (!res?.meta.changes) throw new ApiError("job_wrong_status");
  await jobAudit(c, user.id, job, { status: ["assigned", "accepted"] }).run();
}

/** The driver says no: the trip goes to the next in line, and the driver goes to the back of the line. */
export async function declineJob(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (!(await moveMyJob(c.db, job, ["assigned"], "status = 'open', driver_id = null, assigned_at = null, declined = declined || ?", `,${user.id}`))) {
    throw new ApiError("job_wrong_status");
  }
  const batch = [jobAudit(c, user.id, job, { status: ["assigned", "open"], reason: "declined" })];
  if (job.driver_station_id && !(await currentJob(c.db, user.id))) {
    batch.push(
      c.db
        .prepare("insert or replace into driver_queue (driver_id, station_id, since) values (?, ?, ?)")
        .bind(user.id, job.driver_station_id, nowIso()),
    );
  }
  await c.db.batch(batch);
  await dispatch(c);
}

/**
 * The driver gives back a trip they accepted, before they have the parcel or the
 * customer (the customer was not there, the parcel does not fit, something else):
 * the trip goes to the next in line and the driver to the end of the line.
 */
export async function abandonJob(c: ParcelCtx, jobId: string, reasonOrRead: unknown) {
  // The driver first (R2): the body of someone else's request is never read.
  const { user, job } = await myJob(c, jobId);
  const reason = typeof reasonOrRead === "function" ? await (reasonOrRead as () => Promise<unknown>)() : reasonOrRead;
  if (!ABANDON_REASONS.includes(reason as AbandonReason)) throw new ApiError("bad_request");
  if (
    !(await moveMyJob(
      c.db,
      job,
      ["accepted"],
      "status = 'open', driver_id = null, assigned_at = null, accepted_at = null, declined = declined || ?",
      `,${user.id}`,
    ))
  ) {
    throw new ApiError("job_wrong_status");
  }
  const s = await driverSettings(c.db);
  await c.db.batch([
    jobAudit(c, user.id, job, { status: ["accepted", "open"], reason: "abandoned", abandon_reason: reason }),
    ...(await requeue(c.db, user.id, job.driver_station_id, s)),
  ]);
  await tellUser(c.env, job.customer_user_id, job.parcel_id, "driver_abandoned", {
    subject: "Changement de chauffeur",
    text: `poinderecharge : votre chauffeur ne peut pas assurer votre course${job.tracking_no ? ` (colis ${job.tracking_no})` : ""}. Nous la proposons à un autre chauffeur. Suivi : ${APP_URL}`,
  });
  await dispatch(c);
}

/** The depot a parcel collected at home counts as handed in at: the nearest open one other than the destination. */
async function originDepot(db: D1Database, home: LatLng, toStationId: string): Promise<DepotPoint | null> {
  const unlocked = await unlockedStations(db, "parcels");
  const depots = (await depotStations(db)).filter((d) => d.id !== toStationId && unlocked.has(d.id));
  return nearestStation(home, depots);
}

/** Pickup at the customer's home: the driver measured and weighed, checked the content and took the cash. */
export async function collectPickup(c: ParcelCtx, jobId: string, rawMeasures: ParcelMeasures) {
  const { user, job } = await myJob(c, jobId);
  if (job.kind !== "pickup" || job.status !== "accepted") throw new ApiError("job_wrong_status");
  const measures = {
    lengthCm: Number(rawMeasures?.lengthCm),
    widthCm: Number(rawMeasures?.widthCm),
    heightCm: Number(rawMeasures?.heightCm),
    weightKg: Number(rawMeasures?.weightKg),
  };
  const tier = validMeasures(measures) ? sizeFor(measures, await sizes(c.db)) : null;
  if (!tier) throw new ApiError("parcel_too_large");
  const s = await driverSettings(c.db);
  const row = (await driverRow(c.db, user.id))!;
  if (!row.v_type || !vehicleFits(row.v_type, tier.size, measures.weightKg, s)) throw new ApiError("vehicle_too_small");
  const sender = job.customer_user_id
    ? await c.db.prepare("select id, phone, full_name from users where id = ?").bind(job.customer_user_id).first<{ id: string; phone: string | null; full_name: string | null }>()
    : null;
  const senderPhone = job.home_phone ?? sender?.phone ?? "";
  const senderAccount = sender ?? { id: (await accountFor(c, senderPhone, job.customer_name, user.id)).id };
  const recipient = await accountFor(c, job.recipient_phone!, job.recipient_name, user.id);
  // Counted as coming from the depot nearest the customer's home.
  const from = await originDepot(c.db, { lat: job.home_lat!, lng: job.home_lng! }, job.to_station_id!);
  if (!from) throw new ApiError("no_origin_depot");
  const collect = tier.priceFcfa + job.fare_fcfa;
  // The trip first: if the customer called it off in the meantime, no parcel is created.
  if (
    !(await moveMyJob(
      c.db,
      job,
      ["accepted"],
      "status = 'picked_up', picked_up_at = ?, size = ?, weight_kg = ?, collect_fcfa = ?",
      nowIso(),
      tier.size,
      measures.weightKg,
      collect,
    ))
  ) {
    throw new ApiError("job_wrong_status");
  }
  let created: { id: string; trackingNo: string };
  try {
    created = await insertParcel(c, {
      fromStationId: from.id,
      toStationId: job.to_station_id!,
      senderId: senderAccount.id,
      senderPhone,
      senderName: job.customer_name,
      recipientId: recipient.id,
      recipientPhone: job.recipient_phone!,
      recipientName: job.recipient_name,
      content: job.content,
      declared: job.declared_value,
      measures,
      tier,
      paymentMethod: "cash_driver",
      status: "in_transit",
      express: true,
      jobId: job.id,
      actor: user.id,
    });
  } catch (err) {
    // No parcel: the trip is the driver's to collect again.
    await moveMyJob(c.db, job, ["picked_up"], "status = 'accepted', picked_up_at = null");
    throw err;
  }
  const { id, trackingNo } = created;
  await c.db.batch([
    c.db.prepare("update delivery_jobs set parcel_id = ? where id = ?").bind(id, job.id),
    // The parcel is numbered at the door, in the driver's hands: the driver's record is the handover (plan phase 7).
    scanStatement(c.db, { parcelId: id, runId: job.id, kind: "handover_to_driver", driverId: user.id, stationId: null, by: user.id, role: "driver" }),
    ledger(c, user.id, "collected", collect, job.id, null, user.id),
    jobAudit(c, user.id, job, { status: ["accepted", "picked_up"], tracking_no: trackingNo, collect_fcfa: collect }),
  ]);
  const to = await station(c.db, job.to_station_id!);
  await Promise.all([
    notifyPerson(c.env, id, "deposited", senderAccount.id, {
      subject: `Colis ${trackingNo} enlevé`,
      text: `poinderecharge : votre colis ${trackingNo} a été enlevé par ${row.full_name} et part en express vers ${to?.name}. ${collect} FCFA payés. Suivi : ${APP_URL}`,
    }),
    notifyPerson(c.env, id, "deposited", recipient.id, {
      subject: `Un colis est en route pour vous (${trackingNo})`,
      text: `poinderecharge : un colis de ${party(job.customer_name, senderPhone)} est en route vers ${to?.name}. N° ${trackingNo}. Le code de retrait sera dans l'app à son arrivée. Suivi : ${APP_URL}`,
    }),
  ]);
  return toJob(await loadJob(c.db, job.id));
}

/**
 * A shop's courier comes back to the shop when the recipient is absent (planung/marchand.md),
 * so like a home delivery it has a door step: at the door, then delivered or back.
 */
function shopCourier(job: Pick<JobRow, "kind" | "merchant_id">): boolean {
  return job.kind === "courier" && !!job.merchant_id;
}

/** Trips with a door step: home deliveries and shop couriers. */
function hasDoorStep(job: Pick<JobRow, "kind" | "merchant_id">): boolean {
  return job.kind === "delivery" || shopCourier(job);
}

export async function arriveAtDoor(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (!hasDoorStep(job) || !(await moveMyJob(c.db, job, ["picked_up"], "status = 'at_door', at_door_at = ?", nowIso()))) {
    throw new ApiError("job_wrong_status");
  }
  await jobAudit(c, user.id, job, { status: ["picked_up", "at_door"] }).run();
}

/** The photo taken at the door when handing the parcel over. */
export async function uploadProof(c: ParcelCtx, jobId: string, request: Request) {
  const { job } = await myJob(c, jobId);
  // Home deliveries and couriers: the photo of the handover at the door.
  const atDoor = hasDoorStep(job) ? ["picked_up", "at_door"] : job.kind === "courier" ? ["picked_up"] : [];
  if (!atDoor.includes(job.status)) throw new ApiError("job_wrong_status");
  const image = await readImage(c, request);
  const key = `proofs/${job.id}-${uuid()}.${image.ext}`;
  await c.env.MEDIA.put(key, image.body, { httpMetadata: { contentType: image.type } });
  await c.db.prepare("update delivery_jobs set proof_key = ? where id = ?").bind(key, job.id).run();
  if (job.proof_key) await c.env.MEDIA.delete(job.proof_key);
  return { key };
}

/** At the door: the recipient gives their pickup code, the driver takes the cash. */
export async function deliverJob(c: ParcelCtx, jobId: string, rawCode: unknown) {
  const { user, job } = await myJob(c, jobId);
  if (job.kind !== "delivery" || !["picked_up", "at_door"].includes(job.status) || !job.parcel_id) throw new ApiError("job_wrong_status");
  if (!job.proof_key) throw new ApiError("photo_missing");
  const parcel = await withPickupCodeTry(c.db, `job:${job.id}`, PARCEL_MAX_CODE_FAILURES, PARCEL_CODE_LOCK_MINUTES, async () => {
    const row = await c.db.prepare("select * from parcels where id = ?").bind(job.parcel_id).first<ParcelRow>();
    if (!row || row.status !== "arrived" || row.delivery_status !== "out_for_delivery") throw new ApiError("parcel_wrong_status");
    const input = parsePickupInput(String(rawCode ?? ""));
    if (!input || input.code !== row.pickup_code || (input.trackingNo && input.trackingNo !== row.tracking_no)) throw new ApiError("wrong_pickup_code");
    return row;
  });
  const now = nowIso();
  const s = await driverSettings(c.db);
  if (!(await moveMyJob(c.db, job, ["picked_up", "at_door"], "status = 'done', done_at = ?", now))) throw new ApiError("job_wrong_status");
  // The driver's CO2 and greenpoints for this trip (worker/greenpoint.ts).
  const trip = await tripStatement(c.db, { driverId: user.id, jobId: job.id, distanceMeters: job.distance_m, stationId: job.from_station_id, createdBy: user.id });
  await c.db.batch([
    ...(trip ? [trip] : []),
    c.db
      .prepare(
        "update parcels set status = 'picked_up', picked_up_at = ?, picked_up_by = ?, delivery_status = 'delivered' where id = ? and status = 'arrived'",
      )
      .bind(now, user.id, parcel.id),
    event(c, parcel.id, user.id, "picked_up", null),
    // The recipient's code at the door is the scan of this handover.
    scanStatement(c.db, { parcelId: parcel.id, runId: job.id, kind: "delivered", driverId: user.id, stationId: null, by: user.id, role: "driver" }),
    c.audit(user.id, "parcels", "update", parcel.id, { status: ["arrived", "picked_up"], delivery_status: ["out_for_delivery", "delivered"] }, { userId: parcel.recipient_user_id }),
    ...(cashDue(job) ? [ledger(c, user.id, "collected", cashDue(job), job.id, null, user.id)] : []),
    ...(await earning(c, job, user.id, s, null, user.id)),
    jobAudit(c, user.id, job, { status: [job.status, "done"] }),
  ]);
  await notifyPerson(c.env, parcel.id, "picked_up", parcel.sender_user_id, {
    subject: `Colis ${parcel.tracking_no} livré`,
    text: `poinderecharge : votre colis ${parcel.tracking_no} a été livré à ${party(parcel.recipient_name, parcel.recipient_phone)} le ${now.slice(8, 10)}/${now.slice(5, 7)}.`,
  });
}

/**
 * Nobody at the door after the waiting time: the parcel goes back to its station, or for a
 * shop's courier back to where the driver took it (the shop is the sender).
 */
export async function failDelivery(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (!hasDoorStep(job) || job.status !== "at_door" || !job.at_door_at) throw new ApiError("job_wrong_status");
  const s = await driverSettings(c.db);
  if (Date.now() - new Date(job.at_door_at).getTime() < s.waitMinutes * 60_000) throw new ApiError("wait_longer");
  if (!(await moveMyJob(c.db, job, ["at_door"], "status = 'returning'"))) throw new ApiError("job_wrong_status");
  await jobAudit(c, user.id, job, { status: ["at_door", "returning"], ...(job.merchant_id ? { merchant_id: job.merchant_id } : {}) }).run();
  if (shopCourier(job)) {
    await tellUser(c.env, job.customer_user_id, null, "courier_returning", {
      subject: "Destinataire absent",
      text: `poinderecharge : ${party(job.recipient_name, job.recipient_phone ?? "")} n'était pas là. Le chauffeur ramène le colis${job.content ? ` (${job.content})` : ""} à ${job.home_note || "votre boutique"}. Confirmez sa réception dans l'app : ${APP_URL}/marchand`,
    });
  } else if (job.parcel_id) {
    const from = await station(c.db, job.from_station_id!);
    await notifyPerson(c.env, job.parcel_id, "delivery_failed", job.customer_user_id, {
      subject: `Livraison du colis ${job.tracking_no} manquée`,
      text: `poinderecharge : notre chauffeur ne vous a pas trouvé. Votre colis ${job.tracking_no} retourne à ${from?.name}. Vous pouvez l'y retirer avec votre code ou demander une nouvelle livraison dans l'app : ${APP_URL}`,
    });
  }
}

/**
 * Who pays when: couriers pay the fare at the start, and so do shops for every trip
 * (planung/marchand.md); a customer's ride pays at the end.
 */
function collectsAtStart(job: Pick<JobRow, "kind" | "merchant_id">): boolean {
  return job.kind === "courier" || (job.kind === "ride" && !!job.merchant_id);
}

/**
 * The driver's share of a finished trip, except for a shop trip driven while checked in
 * there at an hourly rate: the shop pays the hours, the whole fare is ours (decision A).
 */
async function earning(c: ParcelCtx, job: JobRow, driverId: string, s: DriverSettings, stationId: string | null, actor: string): Promise<D1PreparedStatement[]> {
  if (await hourlyTrip(c.db, { ...job, driver_id: driverId })) return [];
  return [ledger(c, driverId, "earning", driverEarning(job.fare_fcfa, s), job.id, stationId, actor)];
}

/** Trips that go from point A to point B without a station: rides and couriers. */
const POINT_TO_POINT: JobKind[] = ["ride", "courier"];

/**
 * Ride: the customer got on at the start point. Courier: the driver took the
 * parcel at the sender's door and was paid the fare in cash there.
 */
export async function boardRide(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  // Courier: the code the recipient gives at the door, made now; the sender sees it in the app.
  const code = job.kind === "courier" ? randomDigits(6) : null;
  if (
    !POINT_TO_POINT.includes(job.kind) ||
    !(await moveMyJob(c.db, job, ["accepted"], "status = 'picked_up', picked_up_at = ?, handover_code = coalesce(handover_code, ?)", nowIso(), code))
  ) {
    throw new ApiError("job_wrong_status");
  }
  await c.db.batch([
    ...(collectsAtStart(job) && cashDue(job) ? [ledger(c, user.id, "collected", cashDue(job), job.id, null, user.id)] : []),
    jobAudit(c, user.id, job, { status: ["accepted", "picked_up"] }),
  ]);
  if (job.kind === "courier") {
    const driver = await driverRow(c.db, user.id);
    await tellUser(c.env, await accountOfPhone(c.db, job.recipient_phone), null, "courier_on_the_way", {
      subject: "Un colis arrive chez vous",
      text: `poinderecharge : ${driver?.full_name ?? "un chauffeur"}${driver?.phone ? ` (${driver.phone})` : ""} vous apporte un colis de ${job.customer_name ?? "votre expéditeur"}. A la remise, donnez le code ${code} au chauffeur.`,
    });
  }
}

/** The account with this phone number, if any (couriers do not create accounts for recipients). */
async function accountOfPhone(db: D1Database, phone: string | null): Promise<string | null> {
  if (!phone) return null;
  return (await db.prepare("select id from users where phone = ?").bind(phone).first<{ id: string }>())?.id ?? null;
}

/**
 * Ride: the customer got off at the end point and paid the fare in cash.
 * Courier: the parcel was handed to the recipient (already paid at the start). Handed over
 * with the photo alone (no recipient code), the trip is done but the driver's share waits
 * (proof_review 'pending') until the sender confirms receipt or an admin approves the photo
 * (approveCourierProof).
 */
export async function finishRide(c: ParcelCtx, jobId: string, rawCode?: unknown) {
  const { user, job } = await myJob(c, jobId);
  if (!POINT_TO_POINT.includes(job.kind)) throw new ApiError("job_wrong_status");
  const byPhoto = job.kind === "courier" && (await checkCourierHandover(c, job, rawCode)) === "photo";
  const s = await driverSettings(c.db);
  const from: JobStatus[] = shopCourier(job) ? ["picked_up", "at_door"] : ["picked_up"];
  const set = byPhoto ? "status = 'done', done_at = ?, proof_review = 'pending'" : "status = 'done', done_at = ?";
  if (!(await moveMyJob(c.db, job, from, set, nowIso()))) throw new ApiError("job_wrong_status");
  const trip = await tripStatement(c.db, { driverId: user.id, jobId: job.id, distanceMeters: job.distance_m, stationId: job.driver_station_id, createdBy: user.id });
  await c.db.batch([
    ...(trip ? [trip] : []),
    ...(collectsAtStart(job) || !cashDue(job) ? [] : [ledger(c, user.id, "collected", cashDue(job), job.id, null, user.id)]),
    ...(byPhoto ? [] : await earning(c, job, user.id, s, null, user.id)),
    jobAudit(c, user.id, job, { status: [job.status, "done"], collect_fcfa: job.collect_fcfa, ...(byPhoto ? { proof_review: "pending" } : {}) }),
  ]);
  if (job.kind === "courier") {
    const delivered: Message = {
      subject: "Colis remis",
      text: `poinderecharge : le colis${job.content ? ` (${job.content})` : ""} a été remis à ${party(job.recipient_name, job.recipient_phone ?? "")} le ${shortDate(nowIso())}.${byPhoto ? ` Remis sans code, avec une photo : confirmez la réception dans l'app : ${APP_URL}` : ""}`,
    };
    await Promise.all([
      tellUser(c.env, job.customer_user_id, null, "courier_delivered", delivered),
      tellUser(c.env, await accountOfPhone(c.db, job.recipient_phone), null, "courier_delivered", delivered),
    ]);
  }
}

/**
 * Courier at the door (Atlas finding): like a home delivery, the driver hands over only
 * for the recipient's code, or with a photo of the handover when the recipient has no
 * code. Wrong codes count towards the lock of deliverJob. Says which of the two it was.
 */
async function checkCourierHandover(c: ParcelCtx, job: JobRow, rawCode: unknown): Promise<"code" | "photo"> {
  const typed = String(rawCode ?? "").replace(/\s/g, "");
  if (!typed) {
    if (!job.proof_key) throw new ApiError("proof_required");
    return "photo";
  }
  return withPickupCodeTry(c.db, `job:${job.id}`, PARCEL_MAX_CODE_FAILURES, PARCEL_CODE_LOCK_MINUTES, async () => {
    if (!job.handover_code || typed !== job.handover_code) throw new ApiError("wrong_pickup_code");
    return "code" as const;
  });
}

/**
 * The held share of a courier finished with the photo alone (finishRide) is booked: the
 * sender confirmed the parcel arrived, or an admin looked at the photo. Once only.
 */
async function approveCourierProof(c: ParcelCtx, job: JobRow, actorId: string, by: "sender" | "admin") {
  if (job.kind !== "courier" || job.status !== "done" || job.proof_review !== "pending" || !job.driver_id) throw new ApiError("job_wrong_status");
  const s = await driverSettings(c.db);
  const res = await c.db.prepare("update delivery_jobs set proof_review = 'approved' where id = ? and proof_review = 'pending'").bind(job.id).run();
  if (!res.meta.changes) throw new ApiError("job_wrong_status");
  await c.db.batch([
    ...(await earning(c, job, job.driver_id, s, null, actorId)),
    jobAudit(c, actorId, job, { proof_review: ["pending", "approved"], by }),
  ]);
}

/** The sender (or a member of the shop that booked it) confirms a courier handed over by photo arrived. */
export async function confirmCourierReceipt(c: ParcelCtx, jobId: string) {
  const user = await c.requireUser();
  const shop = user.role === "merchant" ? (await membershipOf(c.db, user.id))?.shop : null;
  if (!shop) refuseNonCustomer(user);
  const job = await loadJob(c.db, jobId);
  const mine = shop ? job.merchant_id === shop.id : job.customer_user_id === user.id;
  if (user.role !== "admin" && !mine) throw new ApiError("forbidden", 403);
  await approveCourierProof(c, job, user.id, mine ? "sender" : "admin");
}

/** Backoffice: an admin approves the photo of a courier handed over without the code. */
export async function approveProof(c: ParcelCtx, jobId: string) {
  const admin = await c.requireAdmin();
  await approveCourierProof(c, await loadJob(c.db, jobId), admin.id, "admin");
}

/** Longest reason an admin may give for rejecting a handover photo. */
export const PROOF_REJECT_REASON_MAX = 300;

/**
 * Backoffice: an admin rejects the photo of a courier handed over without the code
 * ({ reason }). The driver's held share is not booked, the trip can no longer be approved (nor
 * confirmed by the sender), and the driver and the sender are told why. Once only, and never
 * after an approval: the same guarded update as approveCourierProof decides which comes first.
 */
export async function rejectProof(c: ParcelCtx, jobId: string, body: () => Promise<{ reason?: unknown }>) {
  const admin = await c.requireAdmin();
  // The body is read once the caller is known to be an admin.
  const input = await body();
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason || reason.length > PROOF_REJECT_REASON_MAX) throw new ApiError("bad_request");
  const job = await loadJob(c.db, jobId);
  if (job.kind !== "courier" || job.status !== "done" || job.proof_review !== "pending" || !job.driver_id) throw new ApiError("job_wrong_status");
  const res = await c.db
    .prepare("update delivery_jobs set proof_review = 'rejected', proof_reject_reason = ? where id = ? and proof_review = 'pending'")
    .bind(reason, job.id)
    .run();
  if (!res.meta.changes) throw new ApiError("job_wrong_status");
  await jobAudit(c, admin.id, job, { proof_review: ["pending", "rejected"], reason }).run();
  const what = `le colis${job.content ? ` (${job.content})` : ""} remis le ${shortDate(job.done_at ?? nowIso())}`;
  await Promise.all([
    tellUser(c.env, job.driver_id, null, "courier_proof_rejected", {
      subject: "Photo de remise refusée",
      text: `poinderecharge : la photo de remise pour ${what} a été refusée (${reason}). Le gain de cette course n'est pas crédité. Contactez-nous en cas de question : ${DRIVER_URL}`,
    }),
    tellUser(c.env, job.customer_user_id, null, "courier_proof_rejected", {
      subject: "Remise du colis non validée",
      text: `poinderecharge : nous n'avons pas validé la photo de remise pour ${what} (${reason}). Contactez-nous si le colis n'est pas arrivé : ${APP_URL}`,
    }),
  ]);
}

/**
 * A member of the shop confirms the parcel of a courier whose recipient was absent is back
 * at the shop. The trip ends as failed; the shop paid the fare at the start, so the driver
 * keeps their share (none when checked in there at an hourly rate: decision A). The caller
 * checked that `actorId` belongs to the shop of the trip.
 */
export async function receiveShopReturn(c: ParcelCtx, job: JobRow, actorId: string) {
  if (!shopCourier(job) || job.status !== "returning" || !job.driver_id) throw new ApiError("job_wrong_status");
  const s = await driverSettings(c.db);
  if (!(await moveJob(c.db, job.id, ["returning"], "status = 'failed', done_at = ?", nowIso()))) throw new ApiError("job_wrong_status");
  await c.db.batch([
    ...(await earning(c, job, job.driver_id, s, null, actorId)),
    jobAudit(c, actorId, job, { status: ["returning", "failed"], merchant_id: job.merchant_id, reason: "returned_to_shop" }),
  ]);
  await tellUser(c.env, job.driver_id, null, "courier_returned", {
    subject: "Retour confirmé",
    text: `poinderecharge : la boutique a confirmé le retour du colis. La course est terminée : ${DRIVER_URL}`,
  });
}

// Station staff --------------------------------------------------------------------

export async function stationDrivers(c: ParcelCtx, stationId: string): Promise<StationDrivers> {
  await requireStaff(c, stationId);
  const [queue, outgoing, incoming] = await Promise.all([
    c.db
      .prepare(
        `select q.since, d.full_name, u.phone, v.plate, v.type from driver_queue q join drivers d on d.user_id = q.driver_id
         join users u on u.id = q.driver_id left join fleet_vehicles v on v.id = d.vehicle_id
         where q.station_id = ? order by q.since`,
      )
      .bind(stationId)
      .all<{ since: string; full_name: string; phone: string | null; plate: string | null; type: FleetVehicleType | null }>(),
    c.db
      .prepare(`${JOB_SELECT} where j.from_station_id = ? and j.kind in ('express', 'delivery') and j.status in ('open', 'assigned', 'accepted') order by j.created_at`)
      .bind(stationId)
      .all<JobRow>(),
    c.db
      .prepare(
        `${JOB_SELECT} where (j.to_station_id = ?1 and j.kind in ('express', 'pickup') and j.status = 'picked_up')
           or (j.from_station_id = ?1 and j.kind = 'delivery' and j.status = 'returning') order by j.created_at`,
      )
      .bind(stationId)
      .all<JobRow>(),
  ]);
  return {
    queue: queue.results.map((q) => ({ driver: { name: q.full_name, phone: q.phone, plate: q.plate, vehicleType: q.type }, since: q.since })),
    outgoing: outgoing.results.map(toJob),
    incoming: incoming.results.map(toJob),
  };
}

/**
 * The driver by what staff scanned or typed. A signed pass (src/lib/drivers.ts, R10) must be
 * genuine and not expired, also where the typed code would do (parcel handovers, runs): a
 * forged or old pass is refused, not read as its code. `needPass`: only a valid pass will do
 * (cash settlement); the typed code or the old static QR gets 409 driver_pass_required.
 */
export async function driverByBadge(c: ParcelCtx, badge: unknown, needPass = false): Promise<DriverRow> {
  const text = String(badge ?? "");
  let code: string | null;
  if (isDriverPassFormat(text)) {
    const pass = await checkDriverPass(await passSecret(c.db), text);
    if (!pass.ok) throw new ApiError(pass.error, 409);
    code = pass.code;
  } else if (needPass) {
    throw new ApiError("driver_pass_required", 409);
  } else {
    code = parseDriverBadge(text);
  }
  const row = code ? await c.db.prepare(`${DRIVER_SELECT} where d.code = ?`).bind(code).first<DriverRow>() : null;
  if (!drives(row)) throw new ApiError("driver_not_found", 404);
  return row;
}

function handOverJob(job: JobRow | null, stationId: string): JobRow | null {
  return job && job.from_station_id === stationId && (job.kind === "express" || job.kind === "delivery") && ["assigned", "accepted"].includes(job.status)
    ? job
    : null;
}

function receiveJob(job: JobRow | null, stationId: string): JobRow | null {
  if (!job) return null;
  if (job.status === "picked_up" && job.to_station_id === stationId && (job.kind === "express" || job.kind === "pickup")) return job;
  if (job.status === "returning" && job.from_station_id === stationId && job.kind === "delivery") return job;
  return null;
}

/** Staff scanned a driver's QR code: who it is, what they owe and which parcel they take or bring. */
export async function driverAtStation(c: ParcelCtx, stationId: string, badge: unknown): Promise<DriverAtStation> {
  await requireStaff(c, stationId);
  const row = await driverByBadge(c, badge);
  // On a tour the driver may take one parcel here and bring another.
  const jobs = await busyJobs(c.db, row.user_id);
  const handOver = jobs.map((j) => handOverJob(j, stationId)).find(Boolean) ?? null;
  const receive = jobs.map((j) => receiveJob(j, stationId)).find(Boolean) ?? null;
  return {
    driver: { userId: row.user_id, name: row.full_name, phone: row.phone, plate: row.v_plate, vehicleType: row.v_type },
    balanceFcfa: (await balance(c.db, row.user_id)).balance,
    handOver: handOver ? toJob(handOver) : null,
    receive: receive ? toJob(receive) : null,
  };
}

/**
 * The parcel staff scanned at the counter must be the one of the driver's trip (plan
 * phase 7): another parcel is refused, a parcel that cannot be read is not found.
 */
async function tripParcel(c: ParcelCtx, job: JobRow, code: unknown): Promise<ParcelRow> {
  const parcel = await scannedParcel(c.db, code);
  if (parcel.id !== job.parcel_id) throw new ApiError("parcel_not_in_run", 409);
  return parcel;
}

/** Staff scan the parcel of the driver's trip into the driver's hands (express, or a home delivery). */
export async function handToDriver(c: ParcelCtx, stationId: string, badge: unknown, jobId: string, parcelCode: unknown) {
  const { user: staff, role } = await parcelStationActor(c, stationId);
  const row = await driverByBadge(c, badge);
  const job = handOverJob((await busyJobs(c.db, row.user_id)).find((j) => j.id === jobId) ?? null, stationId);
  if (!job || !job.parcel_id) throw new ApiError("job_wrong_status");
  const parcel = await tripParcel(c, job, parcelCode);
  const now = nowIso();
  if (job.kind === "express") {
    if (parcel.status !== "deposited" || parcel.from_station_id !== stationId) throw new ApiError("parcel_wrong_status");
  } else if (parcel.status !== "arrived" || parcel.to_station_id !== stationId || parcel.delivery_status !== "booked") {
    throw new ApiError("parcel_wrong_status");
  }
  if (!(await moveMyJob(c.db, job, ["assigned", "accepted"], "status = 'picked_up', picked_up_at = ?, accepted_at = coalesce(accepted_at, ?)", now, now))) {
    throw new ApiError("job_wrong_status");
  }
  const parcelUpdate =
    job.kind === "express"
      ? [
          c.db.prepare("update parcels set status = 'in_transit', in_transit_at = ? where id = ? and status = 'deposited'").bind(now, parcel.id),
          event(c, parcel.id, staff.id, "in_transit", stationId),
          c.audit(staff.id, "parcels", "update", parcel.id, { status: ["deposited", "in_transit"], driver: row.user_id }, { stationId }),
        ]
      : [
          c.db.prepare("update parcels set delivery_status = 'out_for_delivery' where id = ? and delivery_status = 'booked'").bind(parcel.id),
          c.audit(staff.id, "parcels", "update", parcel.id, { delivery_status: ["booked", "out_for_delivery"], driver: row.user_id }, { stationId }),
        ];
  await c.db.batch([
    ...parcelUpdate,
    scanStatement(c.db, { parcelId: parcel.id, runId: job.id, kind: "handover_to_driver", driverId: row.user_id, stationId, by: staff.id, role }),
    jobAudit(c, staff.id, job, { status: [job.status, "picked_up"], role }),
  ]);
  if (job.kind === "delivery") {
    await notifyPerson(c.env, parcel.id, "out_for_delivery", parcel.recipient_user_id, {
      subject: `Votre colis ${parcel.tracking_no} est en route`,
      text: `poinderecharge : ${row.full_name}${row.phone ? ` (${row.phone})` : ""}${row.v_plate ? `, ${row.v_plate}` : ""} vous apporte votre colis ${parcel.tracking_no}. Préparez votre code de retrait${cashDue(job) ? ` et ${cashDue(job)} FCFA` : " (course déjà payée)"}. Suivi : ${APP_URL}`,
    });
  }
}

/**
 * Staff scan in the parcel a driver brings: it arrives here (express, pickup), or comes
 * back after a failed delivery.
 */
export async function receiveFromDriver(c: ParcelCtx, stationId: string, badge: unknown, jobId: string, parcelCode: unknown) {
  const { user: staff, role } = await parcelStationActor(c, stationId);
  const row = await driverByBadge(c, badge);
  const job = receiveJob((await busyJobs(c.db, row.user_id)).find((j) => j.id === jobId) ?? null, stationId);
  if (!job || !job.parcel_id) throw new ApiError("job_wrong_status");
  const parcel = await tripParcel(c, job, parcelCode);
  const now = nowIso();
  const scan = scanStatement(c.db, { parcelId: parcel.id, runId: job.id, kind: "received_at_station", driverId: row.user_id, stationId, by: staff.id, role });
  if (job.status === "returning") {
    if (!(await moveMyJob(c.db, job, ["returning"], "status = 'failed', done_at = ?", now))) throw new ApiError("job_wrong_status");
    await c.db.batch([
      scan,
      c.db.prepare("update parcels set delivery_status = 'failed' where id = ? and delivery_status = 'out_for_delivery'").bind(parcel.id),
      c.audit(staff.id, "parcels", "update", parcel.id, { delivery_status: ["out_for_delivery", "failed"] }, { stationId }),
      jobAudit(c, staff.id, job, { status: ["returning", "failed"] }),
      // Nobody was home: the recipient pays nothing (planung/fahrer.md), an online payment goes back.
      ...refundStatements(c.db, job, refundLabel(job)),
    ]);
    return;
  }
  if (parcel.status !== "in_transit" || parcel.to_station_id !== stationId) throw new ApiError("parcel_wrong_status");
  const s = await driverSettings(c.db);
  if (!(await moveMyJob(c.db, job, ["picked_up"], "status = 'done', done_at = ?", now))) throw new ApiError("job_wrong_status");
  const trip = await tripStatement(c.db, { driverId: row.user_id, jobId: job.id, distanceMeters: job.distance_m, stationId, createdBy: staff.id });
  await c.db.batch([
    ...(trip ? [trip] : []),
    ...(await earning(c, job, row.user_id, s, stationId, staff.id)),
    jobAudit(c, staff.id, job, { status: ["picked_up", "done"], role }),
  ]);
  await arriveParcel(c, parcel, staff.id, stationId, await station(c.db, stationId));
  await scan.run();
}

/**
 * The daily settlement: the driver hands in what they owe, or the station pays
 * out their earnings. `amount` is the balance staff saw, so a trip finished in
 * between is not settled by mistake. Cash changes hands, so only for the signed pass the
 * driver's app shows (driverByBadge): the 8-character code is printed and never changes.
 */
export async function settleDriver(c: ParcelCtx, stationId: string, badge: unknown, amount: unknown) {
  const staff = await requireStationActor(c, stationId);
  const row = await driverByBadge(c, badge, true);
  const current = (await balance(c.db, row.user_id)).balance;
  if (Number(amount) !== current) throw new ApiError("balance_changed");
  // Phase 2: a payout to the phone is on its way; paying here too would pay twice.
  if (current < 0 && (await hasOpenPayout(c.db, row.user_id))) throw new ApiError("payout_pending");
  if (current === 0) return;
  await c.db.batch([
    ledger(c, row.user_id, "settlement", current, null, stationId, staff.id),
    c.audit(staff.id, "driver_ledger", "insert", row.user_id, { settlement: current }, { stationId, userId: row.user_id }),
  ]);
}

/** Phase 2: the driver asks for what we owe them on Flooz or T-Money (trip-payments.ts). */
export async function askPayout(c: ParcelCtx, input: unknown) {
  const { user } = await requireDriver(c);
  return requestPayout(c, user.id, (await balance(c.db, user.id)).balance, input);
}

// Customers ------------------------------------------------------------------------

function cleanHome(input: unknown): HomePoint {
  const h = input as HomePoint | null;
  if (!validPoint(h)) throw new ApiError("bad_request");
  if (!inServiceArea(h)) throw new ApiError("outside_area");
  const phone = normalizeTogoPhone(String(h.phone ?? ""));
  if (!phone) throw new ApiError("phone_not_allowed");
  return { lat: h.lat, lng: h.lng, note: String(h.note ?? "").trim().slice(0, 300), phone };
}

/** merchant_id and booked_by of a new trip: set when a shop's member books it. */
function shopColumns(shop: MerchantRow | null, user: Profile): [string | null, string | null] {
  return shop ? [shop.id, user.id] : [null, null];
}

/** The shop in the audit entry of a new trip, so it shows in the shop's activity log. */
function shopAudit(shop: MerchantRow | null): Record<string, unknown> {
  return shop ? { merchant_id: shop.id } : {};
}

/** A customer (or a shop) asks a driver to fetch a parcel at home and bring it to station B. */
export async function bookPickup(c: ParcelCtx, input: PickupBooking): Promise<DeliveryJob> {
  const user = await c.requireUser();
  const shop = await bookingShop(c.db, user);
  await requireDrivers(c.db);
  const home = cleanHome(input?.home);
  const toStationId = String(input?.toStationId ?? "");
  await requireDepot(c.db, toStationId);
  const recipientPhone = normalizeTogoPhone(String(input?.recipientPhone ?? ""));
  if (!recipientPhone) throw new ApiError("phone_not_allowed");
  await requireCustomerNumber(c.db, recipientPhone, "recipient_not_customer");
  const content = String(input?.content ?? "").trim().slice(0, 300);
  if (!content) throw new ApiError("bad_request");
  if (!PARCEL_SIZES.includes(input?.size)) throw new ApiError("bad_request");
  // The collected parcel is counted from the depot nearest the home (collectPickup), which
  // must not be the destination: with no other depot the trip would fail only at the door.
  if (!(await originDepot(c.db, home, toStationId))) throw new ApiError("no_origin_depot");
  const declared = input.declaredValue == null ? null : Number(input.declaredValue);
  if (declared !== null && !(Number.isInteger(declared) && declared >= 0 && declared <= 100_000_000)) throw new ApiError("bad_request");
  const to = (await stationPoint(c.db, toStationId))!;
  const s = await driverSettings(c.db);
  const distance = Math.round(distanceMeters(home, to));
  const fare = fareFor(distance, false, s);
  const tier = (await sizes(c.db)).find((t) => t.size === input.size)!;
  const id = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into delivery_jobs (id, kind, status, customer_user_id, customer_name, to_station_id, home_lat, home_lng, home_note, home_phone,
         size, weight_kg, content, declared_value, recipient_phone, recipient_name, distance_m, fare_fcfa, collect_fcfa, created_at, merchant_id, booked_by)
         values (?, 'pickup', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        shop?.name ?? user.fullName,
        toStationId,
        home.lat,
        home.lng,
        home.note,
        home.phone,
        tier.size,
        tier.maxWeightKg,
        content,
        declared,
        recipientPhone,
        cleanName(input.recipientName),
        distance,
        fare,
        tier.priceFcfa + fare,
        nowIso(),
        ...shopColumns(shop, user),
      ),
    c.audit(user.id, "delivery_jobs", "insert", id, { kind: "pickup", to_station_id: toStationId, fare_fcfa: fare, ...shopAudit(shop) }, { stationId: toStationId, userId: user.id }),
  ]);
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/** Where a ride or courier ends: a pin in the service area and a description. */
function cleanDropoff(input: unknown): { lat: number; lng: number; note: string } {
  const d = input as { lat: number; lng: number; note?: unknown } | null;
  if (!validPoint(d)) throw new ApiError("bad_request");
  if (!inServiceArea(d)) throw new ApiError("outside_area");
  return { lat: d.lat, lng: d.lng, note: String(d.note ?? "").trim().slice(0, 300) };
}

/** A customer books a driver to take them (and others, as seats allow) from A to B. Not offered in the app at the moment. */
export async function bookRide(c: ParcelCtx, input: RideBooking): Promise<DeliveryJob> {
  const user = await c.requireUser();
  const shop = await bookingShop(c.db, user);
  await requireDrivers(c.db);
  const pickup = cleanHome(input?.pickup);
  const d = cleanDropoff(input?.dropoff);
  const passengers = Number(input?.passengers);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_PASSENGERS) throw new ApiError("bad_request");
  // A customer rides once at a time; a shop books rides for several people.
  const open = shop
    ? null
    : await c.db
        .prepare(`select 1 from delivery_jobs where customer_user_id = ? and kind = 'ride' and status not in ('done', 'failed', 'cancelled')`)
        .bind(user.id)
        .first();
  if (open) throw new ApiError("ride_open");
  const passenger = shop ? cleanName(input.passengerName) : null;
  const payWith = shop ? "cash" : cleanPayWith(input?.payWith);
  const s = await driverSettings(c.db);
  const distance = Math.round(distanceMeters(pickup, d));
  const fare = fareFor(distance, false, s);
  const id = uuid();
  const pay = payWith === "wallet" ? await walletPayment(c, user, id, fare, tripLabel("ride", null)) : [];
  await c.db.batch([
    c.db
      .prepare(
        `insert into delivery_jobs (id, kind, status, customer_user_id, customer_name, home_lat, home_lng, home_note, home_phone,
         dropoff_lat, dropoff_lng, dropoff_note, passengers, size, distance_m, fare_fcfa, collect_fcfa, created_at, merchant_id, booked_by)
         values (?, 'ride', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'S', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        shop ? (passenger ?? shop.name) : user.fullName,
        pickup.lat,
        pickup.lng,
        pickup.note,
        pickup.phone,
        d.lat,
        d.lng,
        d.note,
        passengers,
        distance,
        fare,
        fare,
        nowIso(),
        ...shopColumns(shop, user),
      ),
    ...pay,
    c.audit(user.id, "delivery_jobs", "insert", id, { kind: "ride", passengers, fare_fcfa: fare, ...shopAudit(shop), ...(pay.length ? { prepaid_fcfa: fare } : {}) }, { userId: user.id }),
  ]).catch(walletFailure);
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/**
 * A driver takes a parcel at one place and brings it straight to its destination:
 * "Envoi express" (any vehicle) or the "Courses" tab (only the vehicle picked there).
 */
export async function bookCourier(c: ParcelCtx, input: CourierBooking): Promise<DeliveryJob> {
  const user = await c.requireUser();
  const shop = await bookingShop(c.db, user);
  await requireDrivers(c.db);
  const pickup = cleanHome(input?.pickup);
  const d = cleanDropoff(input?.dropoff);
  if (!d.note) throw new ApiError("bad_request");
  const recipientPhone = normalizeTogoPhone(String(input?.recipientPhone ?? ""));
  if (!recipientPhone) throw new ApiError("phone_not_allowed");
  await requireCustomerNumber(c.db, recipientPhone, "recipient_not_customer");
  const content = String(input?.content ?? "").trim().slice(0, 300);
  if (!content) throw new ApiError("bad_request");
  if (!PARCEL_SIZES.includes(input?.size)) throw new ApiError("bad_request");
  const s = await driverSettings(c.db);
  const weight = await maxWeight(c.db, input.size);
  const vehicleType = input.vehicleType ?? null;
  if (vehicleType) {
    if (!BOOKABLE_VEHICLE_TYPES.includes(vehicleType)) throw new ApiError("bad_request");
    if (!(await bookableVehicles(c.db)).includes(vehicleType)) throw new ApiError("vehicle_soon");
    if (!vehicleFits(vehicleType, input.size, weight, s)) throw new ApiError("parcel_too_large");
  }
  const payWith = shop ? "cash" : cleanPayWith(input?.payWith);
  const distance = Math.round(distanceMeters(pickup, d));
  const fare = fareFor(distance, false, s);
  const id = uuid();
  const pay = payWith === "wallet" ? await walletPayment(c, user, id, fare, tripLabel("courier", null)) : [];
  await c.db.batch([
    c.db
      .prepare(
        `insert into delivery_jobs (id, kind, status, customer_user_id, customer_name, home_lat, home_lng, home_note, home_phone,
         dropoff_lat, dropoff_lng, dropoff_note, size, weight_kg, content, recipient_phone, recipient_name, vehicle_type, distance_m, fare_fcfa, collect_fcfa, created_at,
         merchant_id, booked_by)
         values (?, 'courier', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        shop?.name ?? user.fullName,
        pickup.lat,
        pickup.lng,
        pickup.note,
        pickup.phone,
        d.lat,
        d.lng,
        d.note,
        input.size,
        weight,
        content,
        recipientPhone,
        cleanName(input.recipientName),
        vehicleType,
        distance,
        fare,
        fare,
        nowIso(),
        ...shopColumns(shop, user),
      ),
    c.audit(
      user.id,
      "delivery_jobs",
      "insert",
      id,
      { kind: "courier", size: input.size, vehicle_type: vehicleType, fare_fcfa: fare, ...shopAudit(shop), ...(pay.length ? { prepaid_fcfa: fare } : {}) },
      { userId: user.id },
    ),
    ...pay,
  ]).catch(walletFailure);
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/** The recipient of a parcel waiting at a station has it brought home; this hands the pickup right to the driver. */
export async function bookDelivery(c: ParcelCtx, parcelId: string, rawHome: unknown, rawPayWith?: unknown): Promise<DeliveryJob> {
  const user = await c.requireUser();
  refuseNonCustomer(user);
  await requireDrivers(c.db);
  const home = cleanHome(rawHome);
  const payWith = cleanPayWith(rawPayWith);
  const parcel = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!parcel) throw new ApiError("parcel_not_found", 404);
  const isRecipient = parcel.recipient_user_id === user.id || (!!user.phone && parcel.recipient_phone === user.phone);
  if (!isRecipient) throw new ApiError("forbidden", 403);
  if (parcel.status !== "arrived" || (parcel.delivery_status && parcel.delivery_status !== "failed")) throw new ApiError("parcel_wrong_status");
  await requireDepot(c.db, parcel.to_station_id);
  const from = (await stationPoint(c.db, parcel.to_station_id))!;
  const s = await driverSettings(c.db);
  const distance = Math.round(distanceMeters(from, home));
  const fare = fareFor(distance, false, s);
  const id = uuid();
  const pay = payWith === "wallet" ? await walletPayment(c, user, id, fare, tripLabel("delivery", parcel.tracking_no)) : [];
  // Claim the parcel first, checking its delivery status as it is saved: of two bookings
  // at the same time only one gets it (Atlas finding: a home delivery booked twice).
  const claimed = await c.db
    .prepare(
      `update parcels set delivery_status = 'booked', job_id = ? where id = ? and status = 'arrived'
       and (delivery_status is null or delivery_status = 'failed')`,
    )
    .bind(id, parcel.id)
    .run();
  if (!claimed.meta.changes) throw new ApiError("parcel_wrong_status");
  try {
    await c.db.batch([
      c.db
        .prepare(
          `insert into delivery_jobs (id, kind, status, parcel_id, customer_user_id, customer_name, from_station_id, home_lat, home_lng, home_note, home_phone,
           size, weight_kg, content, distance_m, fare_fcfa, collect_fcfa, created_at)
           values (?, 'delivery', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          parcel.id,
          user.id,
          parcel.recipient_name ?? user.fullName,
          parcel.to_station_id,
          home.lat,
          home.lng,
          home.note,
          home.phone,
          parcel.size,
          parcel.weight_kg,
          parcel.content,
          distance,
          fare,
          fare,
          nowIso(),
        ),
      c.audit(user.id, "parcels", "update", parcel.id, { delivery_status: [parcel.delivery_status, "booked"] }, { stationId: parcel.to_station_id, userId: user.id }),
      ...pay,
    ]);
  } catch (err) {
    // The trip could not be saved: the parcel is free again.
    await c.db
      .prepare("update parcels set delivery_status = ?, job_id = ? where id = ? and job_id = ?")
      .bind(parcel.delivery_status, parcel.job_id, parcel.id, id)
      .run();
    if (/UNIQUE/i.test(String(err))) throw new ApiError("parcel_wrong_status");
    walletFailure(err);
  }
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/** Trips the signed-in customer booked (pickups, home deliveries and rides). */
export async function myJobs(c: ParcelCtx): Promise<DeliveryJob[]> {
  const user = await c.user();
  if (!user) return [];
  // A shop's members all see the shop's trips (planung/marchand.md, decision 4).
  const shop = user.role === "merchant" ? (await membershipOf(c.db, user.id))?.shop : null;
  if (user.role === "merchant" && !shop) return [];
  const { results } = await c.db
    .prepare(`${JOB_SELECT} where ${shop ? "j.merchant_id" : "j.customer_user_id"} = ? order by j.created_at desc limit 50`)
    .bind(shop ? shop.id : user.id)
    .all<JobRow>();
  // The sender of a courier sees the code the recipient gives at the door, to pass it on.
  return results.map((r) => ({ ...toJob(r), ...(r.kind === "courier" && r.handover_code && (r.status === "picked_up" || r.status === "at_door") ? { handoverCode: r.handover_code } : {}) }));
}

const CANCELLABLE: JobStatus[] = ["open", "assigned", "accepted"];

/** cancelled_by of trips called off because no driver took them in time (expireOpenJobs). */
const NO_DRIVER = "no_driver";

/** What the customer's wallet shows for a trip's payment and refund. */
function refundLabel(job: Pick<JobRow, "kind" | "tracking_no">): string {
  return tripLabel(job.kind, job.tracking_no);
}

function tripLabel(kind: JobKind, trackingNo: string | null): string {
  const what = kind === "ride" ? "trajet" : kind === "delivery" ? "livraison" : "coursier";
  return trackingNo ? `${what} ${trackingNo}` : what;
}

/** Calls a trip off while it is still in `from`; false when it moved on in the meantime. */
export async function closeJob(c: Pick<ParcelCtx, "db" | "audit">, job: JobRow, from: JobStatus[], actor: string): Promise<boolean> {
  if (!(await moveJob(c.db, job.id, from, "status = 'cancelled', done_at = ?, cancelled_by = ?", nowIso(), actor))) return false;
  const batch = [
    actor === NO_DRIVER
      ? jobAudit(c as ParcelCtx, null, job, { status: [job.status, "cancelled"], reason: NO_DRIVER })
      : jobAudit(c as ParcelCtx, actor, job, { status: [job.status, "cancelled"] }),
  ];
  if (job.parcel_id && job.kind === "delivery") {
    batch.push(c.db.prepare("update parcels set delivery_status = null where id = ? and delivery_status = 'booked'").bind(job.parcel_id));
  }
  // Paid online: the fare goes back to the wallet.
  batch.push(...refundStatements(c.db, job, refundLabel(job)));
  // An express parcel whose trip is called off goes on the next collection run.
  if (job.parcel_id && job.kind === "express") {
    batch.push(c.db.prepare("update parcels set express = 0 where id = ? and status = 'deposited'").bind(job.parcel_id));
  }
  // A driver who was offered the trip goes back into line where they were.
  if (job.driver_id && job.driver_station_id) {
    batch.push(
      c.db
        .prepare(
          `insert or ignore into driver_queue (driver_id, station_id, since) select ?1, ?2, ?3
            where not exists (select 1 from delivery_jobs where driver_id = ?1 and status in ${BUSY_SQL} and id <> ?4)`,
        )
        .bind(job.driver_id, job.driver_station_id, nowIso(), job.id),
    );
  }
  await c.db.batch(batch);
  return true;
}

async function cancelJobRow(c: ParcelCtx, job: JobRow, actor: string) {
  if (!(await closeJob(c, job, CANCELLABLE, actor))) throw new ApiError("job_wrong_status");
}

/** The customer (before the driver has the parcel) or an admin calls a trip off; the driver it was offered to is told. */
export async function cancelJob(c: ParcelCtx, jobId: string) {
  const user = await c.requireUser();
  const shop = user.role === "merchant" ? (await membershipOf(c.db, user.id))?.shop : null;
  if (!shop) refuseNonCustomer(user);
  const job = await loadJob(c.db, jobId);
  const mine = shop ? job.merchant_id === shop.id : job.customer_user_id === user.id;
  if (user.role !== "admin" && !mine) throw new ApiError("forbidden", 403);
  await cancelJobRow(c, job, user.id);
  // The driver it was offered to is back in line: the next open trip may go to them now.
  if (job.driver_id) await dispatch(c);
  if (job.driver_id) {
    await tellUser(c.env, job.driver_id, job.parcel_id, "job_cancelled", {
      subject: "Course annulée",
      text: `poinderecharge : la course qui vous était confiée${job.tracking_no ? ` (colis ${job.tracking_no})` : ""} a été annulée par ${mine ? "le client" : "l'équipe"}. Vous reprenez votre place dans la file : ${DRIVER_URL}`,
    });
  }
}

/** A parcel was cancelled at the counter or picked up in person: its open trip is off. */
export async function cancelParcelJob(c: ParcelCtx, parcelId: string, actor: string) {
  const job = await c.db
    .prepare(`${JOB_SELECT} where j.parcel_id = ? and j.status in ('open', 'assigned', 'accepted')`)
    .bind(parcelId)
    .first<JobRow>();
  if (job) await cancelJobRow(c, job, actor);
}

/** Express at the counter: the trip to station B, priced with the express surcharge. Returns the fare. */
export async function createExpressJob(c: ParcelCtx, parcelId: string, actor: string): Promise<number> {
  const parcel = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!parcel) throw new ApiError("parcel_not_found", 404);
  const [from, to, s] = await Promise.all([
    stationPoint(c.db, parcel.from_station_id),
    stationPoint(c.db, parcel.to_station_id),
    driverSettings(c.db),
  ]);
  const distance = from && to ? Math.round(distanceMeters(from, to)) : 0;
  const fare = fareFor(distance, true, s);
  const id = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into delivery_jobs (id, kind, status, parcel_id, from_station_id, to_station_id, size, weight_kg, content, distance_m, fare_fcfa, collect_fcfa, created_at)
         values (?, 'express', 'open', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      )
      .bind(id, parcel.id, parcel.from_station_id, parcel.to_station_id, parcel.size, parcel.weight_kg, parcel.content, distance, fare, nowIso()),
    c.db.prepare("update parcels set job_id = ? where id = ?").bind(id, parcel.id),
    c.audit(actor, "delivery_jobs", "insert", id, { kind: "express", parcel: parcel.tracking_no, fare_fcfa: fare }, { stationId: parcel.from_station_id }),
  ]);
  await dispatch(c);
  return fare;
}

// Backoffice -------------------------------------------------------------------------

export async function adminDrivers(c: ParcelCtx): Promise<AdminDrivers> {
  await c.requireAdmin();
  const [drivers, vehicles, jobs, s, managers] = await Promise.all([
    c.db.prepare(`${DRIVER_SELECT} order by d.created_at desc`).all<DriverRow>(),
    c.db.prepare("select * from fleet_vehicles order by type, plate").all<{ id: string; type: FleetVehicleType; plate: string; is_active: number }>(),
    c.db.prepare(`${JOB_SELECT} order by j.created_at desc limit 500`).all<JobRow>(),
    driverSettings(c.db),
    c.db
      .prepare("select f.driver_id, u.id, u.full_name, u.phone, u.email from fleet_manager_drivers f join users u on u.id = f.manager_id")
      .all<{ driver_id: string; id: string; full_name: string | null; phone: string | null; email: string | null }>(),
  ]);
  const managerOf = new Map(managers.results.map((m) => [m.driver_id, { userId: m.id, label: m.full_name || m.phone || m.email || "?" }]));
  return {
    drivers: await Promise.all(drivers.results.map(async (r) => ({ ...(await toDriver(c.db, r, true)), manager: managerOf.get(r.user_id) ?? null }))),
    vehicles: vehicles.results.map(toVehicle),
    jobs: jobs.results.map(toJob),
    settings: s,
  };
}

export async function reviewDriver(c: ParcelCtx, userId: string, decision: DriverDecision) {
  const admin = await c.requireAdmin();
  const row = await driverRow(c.db, userId);
  if (!row) throw new ApiError("driver_not_found", 404);
  const now = nowIso();
  const busy = await currentJob(c.db, userId);
  const audit = (changes: Record<string, unknown>) => c.audit(admin.id, "drivers", "update", userId, changes, { userId });
  const vehicleFree = async (vehicleId: string) => {
    const v = await c.db.prepare("select is_active from fleet_vehicles where id = ?").bind(vehicleId).first<{ is_active: number }>();
    if (!v?.is_active) throw new ApiError("vehicle_unavailable");
    const other = await c.db.prepare("select user_id from drivers where vehicle_id = ? and user_id <> ?").bind(vehicleId, userId).first();
    if (other) throw new ApiError("vehicle_unavailable");
  };
  switch (decision?.action) {
    case "approve": {
      if (row.status !== "pending" && row.status !== "rejected") throw new ApiError("forbidden", 403);
      if (!row.id_doc_key || !row.license_doc_key || !row.portrait_key) throw new ApiError("documents_missing");
      // The customer account becomes a driver account (one role per account): staff and others keep theirs.
      if (row.u_role !== DB_CUSTOMER && row.u_role !== DB_DRIVER) throw new ApiError("has_other_role");
      // R15: only with nothing open as a customer.
      if (row.u_role === DB_CUSTOMER && (await customerThingsOpen(c.db, userId, row.phone))) throw new ApiError("role_change_blocked", 409);
      await vehicleFree(String(decision.vehicleId));
      await c.db.batch([
        c.db
          .prepare("update drivers set status = 'active', vehicle_id = ?, reviewed_at = ?, reviewed_by = ? where user_id = ?")
          .bind(decision.vehicleId, now, admin.id, userId),
        c.db.prepare("update users set role = ? where id = ? and role = ?").bind(DB_DRIVER, userId, DB_CUSTOMER),
        audit({ status: [row.status, "active"], vehicle_id: [row.vehicle_id, decision.vehicleId] }),
        ...(row.u_role === DB_CUSTOMER ? [c.audit(admin.id, "profiles", "update", userId, { role: ["customer", "driver"] }, { userId })] : []),
      ]);
      return;
    }
    case "reject":
      if (row.status !== "pending") throw new ApiError("forbidden", 403);
      await c.db.batch([
        c.db.prepare("update drivers set status = 'rejected', reviewed_at = ?, reviewed_by = ? where user_id = ?").bind(now, admin.id, userId),
        audit({ status: ["pending", "rejected"] }),
      ]);
      return;
    case "suspend":
      if (row.status !== "active") throw new ApiError("forbidden", 403);
      if (busy && !["assigned", "accepted"].includes(busy.status)) throw new ApiError("driver_busy");
      if (busy) await cancelOffer(c, busy, admin.id);
      await c.db.batch([
        c.db.prepare("update drivers set status = 'suspended', reviewed_at = ?, reviewed_by = ? where user_id = ?").bind(now, admin.id, userId),
        c.db.prepare("delete from driver_queue where driver_id = ?").bind(userId),
        audit({ status: ["active", "suspended"] }),
      ]);
      return;
    case "reactivate":
      if (row.status !== "suspended") throw new ApiError("forbidden", 403);
      await c.db.batch([
        c.db.prepare("update drivers set status = 'active', reviewed_at = ?, reviewed_by = ? where user_id = ?").bind(now, admin.id, userId),
        audit({ status: ["suspended", "active"] }),
      ]);
      return;
    case "vehicle": {
      if (busy) throw new ApiError("driver_busy");
      const vehicleId = decision.vehicleId ? String(decision.vehicleId) : null;
      if (vehicleId) await vehicleFree(vehicleId);
      await c.db.batch([
        c.db.prepare("update drivers set vehicle_id = ? where user_id = ?").bind(vehicleId, userId),
        ...(vehicleId ? [] : [c.db.prepare("delete from driver_queue where driver_id = ?").bind(userId)]),
        audit({ vehicle_id: [row.vehicle_id, vehicleId] }),
      ]);
      return;
    }
    case "release": {
      // R15: driver back to customer only with no trip under way, no cash open and out of any fleet.
      if (row.u_role !== DB_DRIVER) throw new ApiError("forbidden", 403);
      if (busy) throw new ApiError("driver_busy");
      const inFleet = await c.db.prepare("select 1 from fleet_manager_drivers where driver_id = ?").bind(userId).first();
      if (inFleet || (await balance(c.db, userId)).balance !== 0) throw new ApiError("role_change_blocked", 409);
      await c.db.batch([
        c.db.prepare("delete from driver_queue where driver_id = ?").bind(userId),
        // W1: the drivers table only holds driver accounts. Trips and the cash ledger stay (no foreign key).
        c.db.prepare("delete from drivers where user_id = ?").bind(userId),
        c.db.prepare("update users set role = ? where id = ? and role = ?").bind(DB_CUSTOMER, userId, DB_DRIVER),
        audit({ status: [row.status, null], released: true }),
        c.audit(admin.id, "profiles", "update", userId, { role: ["driver", "customer"] }, { userId }),
      ]);
      return;
    }
    default:
      throw new ApiError("bad_request");
  }
}

/**
 * R15: what keeps a customer account from becoming a driver account: money in the
 * wallet, an active reservation, an open parcel (sent or to receive) or a booked trip.
 */
export async function customerThingsOpen(db: D1Database, userId: string, phone: string | null): Promise<boolean> {
  const row = await db
    .prepare(
      `select
         (select coalesce(sum(balance_xof), 0) from wallets where user_id = ?1) as balance,
         (select count(*) from reservations where user_id = ?1 and status = 'active' and expires_at > ?3) as reservations,
         (select count(*) from parcels where (sender_user_id = ?1 or recipient_user_id = ?1 or (?2 is not null and (sender_phone = ?2 or recipient_phone = ?2)))
            and status in ('deposited', 'in_transit', 'arrived', 'stored')) as parcels,
         (select count(*) from delivery_jobs where customer_user_id = ?1 and status not in ('done', 'failed', 'cancelled')) as trips`,
    )
    .bind(userId, phone, nowIso())
    .first<{ balance: number; reservations: number; parcels: number; trips: number }>();
  return !!row && (row.balance > 0 || row.reservations > 0 || row.parcels > 0 || row.trips > 0);
}

/** Takes an offered trip back from a driver (it becomes open again). */
async function cancelOffer(c: ParcelCtx, job: JobRow, actor: string) {
  if (await moveJob(c.db, job.id, ["assigned", "accepted"], "status = 'open', driver_id = null, assigned_at = null, accepted_at = null")) {
    await jobAudit(c, actor, job, { status: [job.status, "open"], reason: "reassigned" }).run();
  }
}

export async function saveFleetVehicle(c: ParcelCtx, id: string | null, input: FleetVehicleInput) {
  const admin = await c.requireAdmin();
  if (!FLEET_VEHICLE_TYPES.includes(input?.type)) throw new ApiError("bad_request");
  const plate = String(input.plate ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  if (plate.length < 2 || plate.length > 20) throw new ApiError("bad_request");
  const active = input.isActive ? 1 : 0;
  try {
    if (id) {
      const before = await c.db.prepare("select * from fleet_vehicles where id = ?").bind(id).first<{ type: string; plate: string; is_active: number }>();
      if (!before) throw new ApiError("bad_request");
      const statements = [
        c.db.prepare("update fleet_vehicles set type = ?, plate = ?, is_active = ? where id = ?").bind(input.type, plate, active, id),
        c.audit(admin.id, "fleet_vehicles", "update", id, { type: [before.type, input.type], plate: [before.plate, plate], is_active: [!!before.is_active, !!active] }),
      ];
      // A vehicle taken out of service: its driver leaves the line.
      if (!active) {
        statements.push(c.db.prepare("delete from driver_queue where driver_id in (select user_id from drivers where vehicle_id = ?)").bind(id));
      }
      await c.db.batch(statements);
    } else {
      const newId = uuid();
      await c.db.batch([
        c.db.prepare("insert into fleet_vehicles (id, type, plate, is_active, created_at) values (?, ?, ?, ?, ?)").bind(newId, input.type, plate, active, nowIso()),
        c.audit(admin.id, "fleet_vehicles", "insert", newId, { type: input.type, plate }),
      ]);
    }
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("vehicle_unavailable");
    throw err;
  }
}

/** The admin gives an open trip (or one offered to someone else) to a driver; the driver confirms as usual. */
export async function assignJob(c: ParcelCtx, jobId: string, driverId: string) {
  const admin = await c.requireAdmin();
  const job = await loadJob(c.db, jobId);
  if (!["open", "assigned", "accepted"].includes(job.status)) throw new ApiError("job_wrong_status");
  await handJob(c, admin.id, job, driverId, "admin");
}

/** Gives a trip to a driver ahead of the queue (admin or fleet manager); the driver confirms as usual. */
export async function handJob(c: ParcelCtx, actorId: string, job: JobRow, driverId: string, by: "admin" | "fleet") {
  const row = await driverRow(c.db, driverId);
  if (!drives(row) || !row.v_type || !row.v_active) throw new ApiError("driver_not_found");
  if (await currentJob(c.db, driverId)) throw new ApiError("driver_busy");
  // A driver checked in at a shop takes only that shop's trips (planung/marchand.md).
  const checkin = await openCheckin(c.db, driverId);
  if (checkin && checkin.merchant_id !== job.merchant_id) throw new ApiError("driver_checked_in");
  const s = await driverSettings(c.db);
  if (!rowFits(job, row.v_type, job.weight_kg ?? (await maxWeight(c.db, job.size)), s)) throw new ApiError("vehicle_too_small");
  if (job.status !== "open") await cancelOffer(c, job, actorId);
  const queued = checkin ? null : await queueOf(c.db, driverId);
  if (!(await moveJob(c.db, job.id, ["open"], "status = 'assigned', driver_id = ?, driver_station_id = ?, assigned_at = ?, tour_slot = 1", driverId, queued?.stationId ?? null, nowIso()))) {
    throw new ApiError("job_wrong_status");
  }
  await c.db.batch([
    c.db.prepare("delete from driver_queue where driver_id = ?").bind(driverId),
    jobAudit(c, actorId, { ...job, driver_id: driverId }, { status: ["open", "assigned"], by }),
  ]);
  await tellOffer(c.env, driverId, job, s);
}

/** A private photo (driver documents, door photos), for admins. */
export async function driverFile(c: ParcelCtx, key: string): Promise<Response> {
  await c.requireAdmin();
  if (!/^(drivers\/[\w-]+\/(id|license|portrait)|proofs\/[\w-]+)-[\w-]+\.(jpg|png|webp)$/.test(key)) throw new ApiError("bad_request");
  const object = await c.env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

