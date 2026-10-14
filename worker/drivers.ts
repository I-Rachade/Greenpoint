// Drivers: express trips between stations, pickups at a customer's home, home
// deliveries, rides (the customer themselves from A to B) and couriers (a parcel door to door). Shared rules in src/lib/drivers.ts, plan in planung/fahrer.md.
import {
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
  MAX_PASSENGERS,
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
import { requireDrivers } from "./features";
import { tripStatement } from "./greenpoint";
import { ApiError, nowIso, uuid } from "./http";
import { notifyPerson } from "./notify";
import {
  accountFor,
  APP_URL,
  arriveParcel,
  cleanName,
  event,
  insertParcel,
  party,
  requireDepot,
  requireStaff,
  sizes,
  station,
  type ParcelCtx,
  type ParcelRow,
} from "./parcels";

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
  v_type: FleetVehicleType | null;
  v_plate: string | null;
  v_active: number | null;
}

export const DRIVER_SELECT = `select d.*, u.phone, v.type as v_type, v.plate as v_plate, v.is_active as v_active
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
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  dropoff_note: string | null;
  passengers: number | null;
  vehicle_type: FleetVehicleType | null;
  tracking_no: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_plate: string | null;
  driver_vehicle: FleetVehicleType | null;
}

export const JOB_SELECT = `select j.*, p.tracking_no, d.full_name as driver_name, u.phone as driver_phone,
    v.plate as driver_plate, v.type as driver_vehicle
  from delivery_jobs j
  left join parcels p on p.id = j.parcel_id
  left join drivers d on d.user_id = j.driver_id
  left join users u on u.id = j.driver_id
  left join fleet_vehicles v on v.id = d.vehicle_id`;

export const BUSY_SQL = `(${BUSY_JOB_STATUSES.map((s) => `'${s}'`).join(", ")})`;

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
    collectFcfa: r.collect_fcfa,
    recipient: r.recipient_phone ? { phone: r.recipient_phone, name: r.recipient_name } : null,
    declaredValue: r.declared_value,
    driver: r.driver_id
      ? { name: r.driver_name ?? "", phone: r.driver_phone ?? null, plate: r.driver_plate ?? null, vehicleType: r.driver_vehicle ?? null }
      : null,
    customerName: r.customer_name,
    createdAt: r.created_at,
    assignedAt: r.assigned_at,
    acceptedAt: r.accepted_at,
    pickedUpAt: r.picked_up_at,
    atDoorAt: r.at_door_at,
    doneAt: r.done_at,
    proofKey: r.proof_key,
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

async function driverRow(db: D1Database, userId: string): Promise<DriverRow | null> {
  return db.prepare(`${DRIVER_SELECT} where d.user_id = ?`).bind(userId).first<DriverRow>();
}

/** The signed-in user as an active driver. */
async function requireDriver(c: ParcelCtx): Promise<{ user: Profile; row: DriverRow }> {
  const user = await c.requireUser();
  const row = await driverRow(c.db, user.id);
  if (!row || row.status !== "active") throw new ApiError("not_a_driver", 403);
  return { user, row };
}

export async function loadJob(db: D1Database, id: string): Promise<JobRow> {
  const row = await db.prepare(`${JOB_SELECT} where j.id = ?`).bind(id).first<JobRow>();
  if (!row) throw new ApiError("job_not_found", 404);
  return row;
}

async function currentJob(db: D1Database, driverId: string): Promise<JobRow | null> {
  return db.prepare(`${JOB_SELECT} where j.driver_id = ? and j.status in ${BUSY_SQL}`).bind(driverId).first<JobRow>();
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

function jobAudit(c: ParcelCtx, actor: string | null, r: Pick<JobRow, "id" | "from_station_id" | "to_station_id" | "driver_id">, changes: Record<string, unknown>) {
  return c.audit(actor, "delivery_jobs", "update", r.id, changes, { stationId: r.from_station_id ?? r.to_station_id, userId: r.driver_id });
}

function ledger(c: ParcelCtx, driverId: string, kind: LedgerEntry["kind"], amount: number, jobId: string | null, stationId: string | null, actor: string) {
  return c.db
    .prepare("insert into driver_ledger (id, driver_id, at, kind, amount_fcfa, job_id, station_id, actor) values (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(uuid(), driverId, nowIso(), kind, amount, jobId, stationId, actor);
}

// Dispatch -----------------------------------------------------------------------

/**
 * Hands open trips to drivers: offers not confirmed in time go back (the driver
 * leaves the line), then each open trip goes to the first in line at the
 * nearest station with a fitting vehicle. Runs whenever a trip or a driver
 * changes and when drivers or staff load their page.
 */
export async function dispatch(c: Pick<ParcelCtx, "db" | "audit">) {
  const s = await driverSettings(c.db);
  const stale = new Date(Date.now() - s.acceptMinutes * 60_000).toISOString();
  const { results: expired } = await c.db
    .prepare("select id, driver_id, from_station_id, to_station_id from delivery_jobs where status = 'assigned' and assigned_at < ?")
    .bind(stale)
    .all<Pick<JobRow, "id" | "driver_id" | "from_station_id" | "to_station_id">>();
  for (const r of expired) {
    const declined = r.driver_id ? `,${r.driver_id}` : "";
    if (await moveJob(c.db, r.id, ["assigned"], "status = 'open', driver_id = null, assigned_at = null, declined = declined || ?", declined)) {
      await jobAudit(c as ParcelCtx, null, r, { status: ["assigned", "open"], reason: "not_confirmed" }).run();
    }
  }

  const { results: open } = await c.db
    .prepare("select * from delivery_jobs where status = 'open' order by created_at limit 50")
    .all<JobRow>();
  if (!open.length) return;
  const { results: queueRows } = await c.db
    .prepare(
      `select q.driver_id, q.station_id, q.since, v.type from driver_queue q
       join drivers d on d.user_id = q.driver_id join fleet_vehicles v on v.id = d.vehicle_id
       where d.status = 'active' and v.is_active = 1`,
    )
    .all<{ driver_id: string; station_id: string; since: string; type: FleetVehicleType }>();
  let queue: QueueEntry[] = queueRows.map((q) => ({ driverId: q.driver_id, stationId: q.station_id, since: q.since, vehicleType: q.type }));
  if (!queue.length) return;
  const stations = await depotStations(c.db);
  const points = new Map(stations.map((st) => [st.id, st]));

  for (const job of open) {
    const fromHome = job.kind === "pickup" || job.kind === "ride" || job.kind === "courier";
    const start = fromHome ? (job.home_lat != null ? { lat: job.home_lat, lng: job.home_lng! } : null) : points.get(job.from_station_id ?? "") ?? (await stationPoint(c.db, job.from_station_id));
    if (!start) continue;
    const declined = new Set(job.declined.split(",").filter(Boolean));
    const weight = job.weight_kg ?? (await maxWeight(c.db, job.size));
    const fits = (type: FleetVehicleType) => rowFits(job, type, weight, s);
    const pick = pickDriver(start, queue.filter((q) => !declined.has(q.driverId)), stations, fits);
    if (!pick) continue;
    queue = queue.filter((q) => q.driverId !== pick.driverId);
    const now = nowIso();
    try {
      if (
        await moveJob(c.db, job.id, ["open"], "status = 'assigned', driver_id = ?, driver_station_id = ?, assigned_at = ?", pick.driverId, pick.stationId, now)
      ) {
        await c.db.batch([
          c.db.prepare("delete from driver_queue where driver_id = ?").bind(pick.driverId),
          jobAudit(c as ParcelCtx, null, { ...job, driver_id: pick.driverId }, { status: ["open", "assigned"], station: pick.stationId }),
        ]);
      }
    } catch (err) {
      // The driver got another trip in the meantime (one trip per driver).
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
}

// The driver ---------------------------------------------------------------------

export async function driverHome(c: ParcelCtx): Promise<DriverHome> {
  const user = await c.requireUser();
  await dispatch(c);
  const [row, s] = await Promise.all([driverRow(c.db, user.id), driverSettings(c.db)]);
  if (!row) return { driver: null, job: null, history: [], ledger: [], settings: s };
  const [driver, job, history, entries] = await Promise.all([
    toDriver(c.db, row, true),
    currentJob(c.db, user.id),
    c.db
      .prepare(`${JOB_SELECT} where j.driver_id = ? and j.status not in ${BUSY_SQL} order by j.created_at desc limit 30`)
      .bind(user.id)
      .all<JobRow>(),
    c.db
      .prepare("select * from driver_ledger where driver_id = ? order by at desc limit 100")
      .bind(user.id)
      .all<{ id: string; at: string; kind: LedgerEntry["kind"]; amount_fcfa: number; job_id: string | null; station_id: string | null }>(),
  ]);
  return {
    driver,
    job: job ? toJob(job) : null,
    history: history.results.map(toJob),
    ledger: entries.results.map((e) => ({ id: e.id, at: e.at, kind: e.kind, amountFcfa: e.amount_fcfa, jobId: e.job_id, stationId: e.station_id })),
    settings: s,
  };
}

function cleanText(value: unknown, min: number, max: number): string {
  const text = String(value ?? "").trim();
  if (text.length < min || text.length > max) throw new ApiError("bad_request");
  return text;
}

/** Applies (or applies again after a refusal) to drive one of our vehicles. */
export async function applyDriver(c: ParcelCtx, input: DriverApplication) {
  const user = await c.requireUser();
  if (!user.phone) throw new ApiError("phone_required");
  const fullName = cleanText(input?.fullName, 2, 80);
  const idNumber = cleanText(input?.idNumber, 3, 40);
  const licenseNumber = cleanText(input?.licenseNumber, 3, 40);
  if (!FLEET_VEHICLE_TYPES.includes(input?.wantedType)) throw new ApiError("bad_request");
  const existing = await driverRow(c.db, user.id);
  if (existing && (existing.status === "active" || existing.status === "suspended")) throw new ApiError("forbidden", 403);
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
  const column = DOC_COLUMN[kind as DriverDocument];
  if (!column) throw new ApiError("bad_request");
  const row = await driverRow(c.db, user.id);
  if (!row || (row.status !== "pending" && row.status !== "rejected")) throw new ApiError("forbidden", 403);
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
  if (!row.vehicle_id || !row.v_active) throw new ApiError("no_vehicle");
  if (await currentJob(c.db, user.id)) throw new ApiError("driver_busy");
  const s = await driverSettings(c.db);
  if ((await balance(c.db, user.id)).balance >= s.cashLimitFcfa) throw new ApiError("cash_limit");
  await requireDepot(c.db, stationId);
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

export async function leaveQueue(c: ParcelCtx) {
  const user = await c.requireUser();
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
  if (!(await moveJob(c.db, job.id, ["assigned"], "status = 'accepted', accepted_at = ?", nowIso()))) throw new ApiError("job_wrong_status");
  await jobAudit(c, user.id, job, { status: ["assigned", "accepted"] }).run();
}

/** The driver says no: the trip goes to the next in line, and the driver goes to the back of the line. */
export async function declineJob(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (!(await moveJob(c.db, job.id, ["assigned"], "status = 'open', driver_id = null, assigned_at = null, declined = declined || ?", `,${user.id}`))) {
    throw new ApiError("job_wrong_status");
  }
  const batch = [jobAudit(c, user.id, job, { status: ["assigned", "open"], reason: "declined" })];
  if (job.driver_station_id) {
    batch.push(
      c.db
        .prepare("insert or replace into driver_queue (driver_id, station_id, since) values (?, ?, ?)")
        .bind(user.id, job.driver_station_id, nowIso()),
    );
  }
  await c.db.batch(batch);
  await dispatch(c);
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
  const depots = (await depotStations(c.db)).filter((d) => d.id !== job.to_station_id);
  const from = nearestStation({ lat: job.home_lat!, lng: job.home_lng! }, depots);
  if (!from) throw new ApiError("depot_inactive");
  const { id, trackingNo } = await insertParcel(c, {
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
  const collect = tier.priceFcfa + job.fare_fcfa;
  const now = nowIso();
  if (
    !(await moveJob(
      c.db,
      job.id,
      ["accepted"],
      "status = 'picked_up', picked_up_at = ?, parcel_id = ?, size = ?, weight_kg = ?, collect_fcfa = ?",
      now,
      id,
      tier.size,
      measures.weightKg,
      collect,
    ))
  ) {
    throw new ApiError("job_wrong_status");
  }
  await c.db.batch([
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

export async function arriveAtDoor(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (job.kind !== "delivery" || !(await moveJob(c.db, job.id, ["picked_up"], "status = 'at_door', at_door_at = ?", nowIso()))) {
    throw new ApiError("job_wrong_status");
  }
  await jobAudit(c, user.id, job, { status: ["picked_up", "at_door"] }).run();
}

/** The photo taken at the door when handing the parcel over. */
export async function uploadProof(c: ParcelCtx, jobId: string, request: Request) {
  const { job } = await myJob(c, jobId);
  if (job.kind !== "delivery" || !["picked_up", "at_door"].includes(job.status)) throw new ApiError("job_wrong_status");
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
  const lockKey = `job:${job.id}`;
  const since = new Date(Date.now() - PARCEL_CODE_LOCK_MINUTES * 60_000).toISOString();
  const failures = await c.db
    .prepare("select count(*) as n from parcel_code_failures where station_id = ? and at > ?")
    .bind(lockKey, since)
    .first<{ n: number }>();
  if ((failures?.n ?? 0) >= PARCEL_MAX_CODE_FAILURES) throw new ApiError("code_locked", 429);
  const parcel = await c.db.prepare("select * from parcels where id = ?").bind(job.parcel_id).first<ParcelRow>();
  if (!parcel || parcel.status !== "arrived" || parcel.delivery_status !== "out_for_delivery") throw new ApiError("parcel_wrong_status");
  const input = parsePickupInput(String(rawCode ?? ""));
  if (!input || input.code !== parcel.pickup_code || (input.trackingNo && input.trackingNo !== parcel.tracking_no)) {
    await c.db.prepare("insert into parcel_code_failures (station_id, at) values (?, ?)").bind(lockKey, nowIso()).run();
    throw new ApiError("wrong_pickup_code");
  }
  const now = nowIso();
  const s = await driverSettings(c.db);
  if (!(await moveJob(c.db, job.id, ["picked_up", "at_door"], "status = 'done', done_at = ?", now))) throw new ApiError("job_wrong_status");
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
    c.audit(user.id, "parcels", "update", parcel.id, { status: ["arrived", "picked_up"], delivery_status: ["out_for_delivery", "delivered"] }, { userId: parcel.recipient_user_id }),
    ...(job.collect_fcfa ? [ledger(c, user.id, "collected", job.collect_fcfa, job.id, null, user.id)] : []),
    ledger(c, user.id, "earning", driverEarning(job.fare_fcfa, s), job.id, null, user.id),
    jobAudit(c, user.id, job, { status: [job.status, "done"] }),
  ]);
  await notifyPerson(c.env, parcel.id, "picked_up", parcel.sender_user_id, {
    subject: `Colis ${parcel.tracking_no} livré`,
    text: `poinderecharge : votre colis ${parcel.tracking_no} a été livré à ${party(parcel.recipient_name, parcel.recipient_phone)} le ${now.slice(8, 10)}/${now.slice(5, 7)}.`,
  });
}

/** Nobody at the door after the waiting time: the parcel goes back to its station. */
export async function failDelivery(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (job.kind !== "delivery" || job.status !== "at_door" || !job.at_door_at) throw new ApiError("job_wrong_status");
  const s = await driverSettings(c.db);
  if (Date.now() - new Date(job.at_door_at).getTime() < s.waitMinutes * 60_000) throw new ApiError("wait_longer");
  if (!(await moveJob(c.db, job.id, ["at_door"], "status = 'returning'"))) throw new ApiError("job_wrong_status");
  await jobAudit(c, user.id, job, { status: ["at_door", "returning"] }).run();
  if (job.parcel_id) {
    const from = await station(c.db, job.from_station_id!);
    await notifyPerson(c.env, job.parcel_id, "delivery_failed", job.customer_user_id, {
      subject: `Livraison du colis ${job.tracking_no} manquée`,
      text: `poinderecharge : notre chauffeur ne vous a pas trouvé. Votre colis ${job.tracking_no} retourne à ${from?.name}. Vous pouvez l'y retirer avec votre code ou demander une nouvelle livraison dans l'app : ${APP_URL}`,
    });
  }
}

/** Trips that go from point A to point B without a station: rides and couriers. */
const POINT_TO_POINT: JobKind[] = ["ride", "courier"];

/**
 * Ride: the customer got on at the start point. Courier: the driver took the
 * parcel at the sender's door and was paid the fare in cash there.
 */
export async function boardRide(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (!POINT_TO_POINT.includes(job.kind) || !(await moveJob(c.db, job.id, ["accepted"], "status = 'picked_up', picked_up_at = ?", nowIso()))) {
    throw new ApiError("job_wrong_status");
  }
  await c.db.batch([
    ...(job.kind === "courier" ? [ledger(c, user.id, "collected", job.collect_fcfa, job.id, null, user.id)] : []),
    jobAudit(c, user.id, job, { status: ["accepted", "picked_up"] }),
  ]);
}

/**
 * Ride: the customer got off at the end point and paid the fare in cash.
 * Courier: the parcel was handed to the recipient (already paid at the start).
 */
export async function finishRide(c: ParcelCtx, jobId: string) {
  const { user, job } = await myJob(c, jobId);
  if (!POINT_TO_POINT.includes(job.kind)) throw new ApiError("job_wrong_status");
  const s = await driverSettings(c.db);
  if (!(await moveJob(c.db, job.id, ["picked_up"], "status = 'done', done_at = ?", nowIso()))) throw new ApiError("job_wrong_status");
  const trip = await tripStatement(c.db, { driverId: user.id, jobId: job.id, distanceMeters: job.distance_m, stationId: job.driver_station_id, createdBy: user.id });
  await c.db.batch([
    ...(trip ? [trip] : []),
    ...(job.kind === "ride" ? [ledger(c, user.id, "collected", job.collect_fcfa, job.id, null, user.id)] : []),
    ledger(c, user.id, "earning", driverEarning(job.fare_fcfa, s), job.id, null, user.id),
    jobAudit(c, user.id, job, { status: ["picked_up", "done"], collect_fcfa: job.collect_fcfa }),
  ]);
}

// Station staff --------------------------------------------------------------------

export async function stationDrivers(c: ParcelCtx, stationId: string): Promise<StationDrivers> {
  await requireStaff(c, stationId);
  await dispatch(c);
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

async function driverByBadge(c: ParcelCtx, badge: unknown): Promise<DriverRow> {
  const code = parseDriverBadge(String(badge ?? ""));
  const row = code ? await c.db.prepare(`${DRIVER_SELECT} where d.code = ?`).bind(code).first<DriverRow>() : null;
  if (!row || row.status !== "active") throw new ApiError("driver_not_found", 404);
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
  const job = await currentJob(c.db, row.user_id);
  const handOver = handOverJob(job, stationId);
  const receive = receiveJob(job, stationId);
  return {
    driver: { userId: row.user_id, name: row.full_name, phone: row.phone, plate: row.v_plate, vehicleType: row.v_type },
    balanceFcfa: (await balance(c.db, row.user_id)).balance,
    handOver: handOver ? toJob(handOver) : null,
    receive: receive ? toJob(receive) : null,
  };
}

/** Staff hand the parcel of the driver's trip over (express, or a home delivery). */
export async function handToDriver(c: ParcelCtx, stationId: string, badge: unknown, jobId: string) {
  const staff = await requireStaff(c, stationId);
  const row = await driverByBadge(c, badge);
  const job = handOverJob(await currentJob(c.db, row.user_id), stationId);
  if (!job || job.id !== jobId || !job.parcel_id) throw new ApiError("job_wrong_status");
  const parcel = await c.db.prepare("select * from parcels where id = ?").bind(job.parcel_id).first<ParcelRow>();
  if (!parcel) throw new ApiError("parcel_not_found", 404);
  const now = nowIso();
  if (job.kind === "express") {
    if (parcel.status !== "deposited" || parcel.from_station_id !== stationId) throw new ApiError("parcel_wrong_status");
  } else if (parcel.status !== "arrived" || parcel.to_station_id !== stationId || parcel.delivery_status !== "booked") {
    throw new ApiError("parcel_wrong_status");
  }
  if (!(await moveJob(c.db, job.id, ["assigned", "accepted"], "status = 'picked_up', picked_up_at = ?, accepted_at = coalesce(accepted_at, ?)", now, now))) {
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
  await c.db.batch([...parcelUpdate, jobAudit(c, staff.id, job, { status: [job.status, "picked_up"] })]);
  if (job.kind === "delivery") {
    await notifyPerson(c.env, parcel.id, "out_for_delivery", parcel.recipient_user_id, {
      subject: `Votre colis ${parcel.tracking_no} est en route`,
      text: `poinderecharge : ${row.full_name}${row.phone ? ` (${row.phone})` : ""}${row.v_plate ? `, ${row.v_plate}` : ""} vous apporte votre colis ${parcel.tracking_no}. Préparez votre code de retrait et ${job.collect_fcfa} FCFA. Suivi : ${APP_URL}`,
    });
  }
}

/** Staff take a parcel from a driver: it arrives here (express, pickup), or comes back after a failed delivery. */
export async function receiveFromDriver(c: ParcelCtx, stationId: string, badge: unknown, jobId: string) {
  const staff = await requireStaff(c, stationId);
  const row = await driverByBadge(c, badge);
  const job = receiveJob(await currentJob(c.db, row.user_id), stationId);
  if (!job || job.id !== jobId || !job.parcel_id) throw new ApiError("job_wrong_status");
  const parcel = await c.db.prepare("select * from parcels where id = ?").bind(job.parcel_id).first<ParcelRow>();
  if (!parcel) throw new ApiError("parcel_not_found", 404);
  const now = nowIso();
  if (job.status === "returning") {
    if (!(await moveJob(c.db, job.id, ["returning"], "status = 'failed', done_at = ?", now))) throw new ApiError("job_wrong_status");
    await c.db.batch([
      c.db.prepare("update parcels set delivery_status = 'failed' where id = ? and delivery_status = 'out_for_delivery'").bind(parcel.id),
      c.audit(staff.id, "parcels", "update", parcel.id, { delivery_status: ["out_for_delivery", "failed"] }, { stationId }),
      jobAudit(c, staff.id, job, { status: ["returning", "failed"] }),
    ]);
    return;
  }
  if (parcel.status !== "in_transit" || parcel.to_station_id !== stationId) throw new ApiError("parcel_wrong_status");
  const s = await driverSettings(c.db);
  if (!(await moveJob(c.db, job.id, ["picked_up"], "status = 'done', done_at = ?", now))) throw new ApiError("job_wrong_status");
  const trip = await tripStatement(c.db, { driverId: row.user_id, jobId: job.id, distanceMeters: job.distance_m, stationId, createdBy: staff.id });
  await c.db.batch([
    ...(trip ? [trip] : []),
    ledger(c, row.user_id, "earning", driverEarning(job.fare_fcfa, s), job.id, stationId, staff.id),
    jobAudit(c, staff.id, job, { status: ["picked_up", "done"] }),
  ]);
  await arriveParcel(c, parcel, staff.id, stationId, await station(c.db, stationId));
}

/**
 * The daily settlement: the driver hands in what they owe, or the station pays
 * out their earnings. `amount` is the balance staff saw, so a trip finished in
 * between is not settled by mistake.
 */
export async function settleDriver(c: ParcelCtx, stationId: string, badge: unknown, amount: unknown) {
  const staff = await requireStaff(c, stationId);
  const row = await driverByBadge(c, badge);
  const current = (await balance(c.db, row.user_id)).balance;
  if (Number(amount) !== current) throw new ApiError("balance_changed");
  if (current === 0) return;
  await c.db.batch([
    ledger(c, row.user_id, "settlement", current, null, stationId, staff.id),
    c.audit(staff.id, "driver_ledger", "insert", row.user_id, { settlement: current }, { stationId, userId: row.user_id }),
  ]);
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

/** A customer asks a driver to fetch a parcel at home and bring it to station B. */
export async function bookPickup(c: ParcelCtx, input: PickupBooking): Promise<DeliveryJob> {
  const user = await c.requireUser();
  await requireDrivers(c.db);
  const home = cleanHome(input?.home);
  const toStationId = String(input?.toStationId ?? "");
  await requireDepot(c.db, toStationId);
  const recipientPhone = normalizeTogoPhone(String(input?.recipientPhone ?? ""));
  if (!recipientPhone) throw new ApiError("phone_not_allowed");
  const content = String(input?.content ?? "").trim().slice(0, 300);
  if (!content) throw new ApiError("bad_request");
  if (!PARCEL_SIZES.includes(input?.size)) throw new ApiError("bad_request");
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
         size, weight_kg, content, declared_value, recipient_phone, recipient_name, distance_m, fare_fcfa, collect_fcfa, created_at)
         values (?, 'pickup', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        user.fullName,
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
      ),
    c.audit(user.id, "delivery_jobs", "insert", id, { kind: "pickup", to_station_id: toStationId, fare_fcfa: fare }, { stationId: toStationId, userId: user.id }),
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
  await requireDrivers(c.db);
  const pickup = cleanHome(input?.pickup);
  const d = cleanDropoff(input?.dropoff);
  const passengers = Number(input?.passengers);
  if (!Number.isInteger(passengers) || passengers < 1 || passengers > MAX_PASSENGERS) throw new ApiError("bad_request");
  const open = await c.db
    .prepare(`select 1 from delivery_jobs where customer_user_id = ? and kind = 'ride' and status not in ('done', 'failed', 'cancelled')`)
    .bind(user.id)
    .first();
  if (open) throw new ApiError("ride_open");
  const s = await driverSettings(c.db);
  const distance = Math.round(distanceMeters(pickup, d));
  const fare = fareFor(distance, false, s);
  const id = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into delivery_jobs (id, kind, status, customer_user_id, customer_name, home_lat, home_lng, home_note, home_phone,
         dropoff_lat, dropoff_lng, dropoff_note, passengers, size, distance_m, fare_fcfa, collect_fcfa, created_at)
         values (?, 'ride', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'S', ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        user.fullName,
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
      ),
    c.audit(user.id, "delivery_jobs", "insert", id, { kind: "ride", passengers, fare_fcfa: fare }, { userId: user.id }),
  ]);
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/**
 * A driver takes a parcel at one place and brings it straight to its destination:
 * "Envoi express" (any vehicle) or the "Courses" tab (only the vehicle picked there).
 */
export async function bookCourier(c: ParcelCtx, input: CourierBooking): Promise<DeliveryJob> {
  const user = await c.requireUser();
  await requireDrivers(c.db);
  const pickup = cleanHome(input?.pickup);
  const d = cleanDropoff(input?.dropoff);
  if (!d.note) throw new ApiError("bad_request");
  const recipientPhone = normalizeTogoPhone(String(input?.recipientPhone ?? ""));
  if (!recipientPhone) throw new ApiError("phone_not_allowed");
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
  const distance = Math.round(distanceMeters(pickup, d));
  const fare = fareFor(distance, false, s);
  const id = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into delivery_jobs (id, kind, status, customer_user_id, customer_name, home_lat, home_lng, home_note, home_phone,
         dropoff_lat, dropoff_lng, dropoff_note, size, weight_kg, content, recipient_phone, recipient_name, vehicle_type, distance_m, fare_fcfa, collect_fcfa, created_at)
         values (?, 'courier', 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        user.id,
        user.fullName,
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
      ),
    c.audit(user.id, "delivery_jobs", "insert", id, { kind: "courier", size: input.size, vehicle_type: vehicleType, fare_fcfa: fare }, { userId: user.id }),
  ]);
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/** The recipient of a parcel waiting at a station has it brought home; this hands the pickup right to the driver. */
export async function bookDelivery(c: ParcelCtx, parcelId: string, rawHome: unknown): Promise<DeliveryJob> {
  const user = await c.requireUser();
  await requireDrivers(c.db);
  const home = cleanHome(rawHome);
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
    c.db
      .prepare("update parcels set delivery_status = 'booked', job_id = ? where id = ? and status = 'arrived'")
      .bind(id, parcel.id),
    c.audit(user.id, "parcels", "update", parcel.id, { delivery_status: [parcel.delivery_status, "booked"] }, { stationId: parcel.to_station_id, userId: user.id }),
  ]);
  await dispatch(c);
  return toJob(await loadJob(c.db, id));
}

/** Trips the signed-in customer booked (pickups, home deliveries and rides). */
export async function myJobs(c: ParcelCtx): Promise<DeliveryJob[]> {
  const user = await c.user();
  if (!user) return [];
  const { results } = await c.db
    .prepare(`${JOB_SELECT} where j.customer_user_id = ? order by j.created_at desc limit 50`)
    .bind(user.id)
    .all<JobRow>();
  return results.map(toJob);
}

const CANCELLABLE: JobStatus[] = ["open", "assigned", "accepted"];

async function cancelJobRow(c: ParcelCtx, job: JobRow, actor: string) {
  if (!(await moveJob(c.db, job.id, CANCELLABLE, "status = 'cancelled', done_at = ?, cancelled_by = ?", nowIso(), actor))) {
    throw new ApiError("job_wrong_status");
  }
  const batch = [jobAudit(c, actor, job, { status: [job.status, "cancelled"] })];
  if (job.parcel_id && job.kind === "delivery") {
    batch.push(c.db.prepare("update parcels set delivery_status = null where id = ? and delivery_status = 'booked'").bind(job.parcel_id));
  }
  // An express parcel whose trip is called off goes on the next collection run.
  if (job.parcel_id && job.kind === "express") {
    batch.push(c.db.prepare("update parcels set express = 0 where id = ? and status = 'deposited'").bind(job.parcel_id));
  }
  // A driver who was offered the trip goes back into line where they were.
  if (job.driver_id && job.driver_station_id) {
    batch.push(
      c.db.prepare("insert or ignore into driver_queue (driver_id, station_id, since) values (?, ?, ?)").bind(job.driver_id, job.driver_station_id, nowIso()),
    );
  }
  await c.db.batch(batch);
}

/** The customer (before the driver has the parcel) or an admin calls a trip off. */
export async function cancelJob(c: ParcelCtx, jobId: string) {
  const user = await c.requireUser();
  const job = await loadJob(c.db, jobId);
  if (user.role !== "admin" && job.customer_user_id !== user.id) throw new ApiError("forbidden", 403);
  await cancelJobRow(c, job, user.id);
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
  await dispatch(c);
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
    case "approve":
      if (row.status !== "pending" && row.status !== "rejected") throw new ApiError("forbidden", 403);
      if (!row.id_doc_key || !row.license_doc_key || !row.portrait_key) throw new ApiError("documents_missing");
      await vehicleFree(String(decision.vehicleId));
      await c.db.batch([
        c.db
          .prepare("update drivers set status = 'active', vehicle_id = ?, reviewed_at = ?, reviewed_by = ? where user_id = ?")
          .bind(decision.vehicleId, now, admin.id, userId),
        audit({ status: [row.status, "active"], vehicle_id: [row.vehicle_id, decision.vehicleId] }),
      ]);
      return;
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
    default:
      throw new ApiError("bad_request");
  }
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
  if (!row || row.status !== "active" || !row.v_type || !row.v_active) throw new ApiError("driver_not_found");
  if (await currentJob(c.db, driverId)) throw new ApiError("driver_busy");
  const s = await driverSettings(c.db);
  if (!rowFits(job, row.v_type, job.weight_kg ?? (await maxWeight(c.db, job.size)), s)) throw new ApiError("vehicle_too_small");
  if (job.status !== "open") await cancelOffer(c, job, actorId);
  const queued = await queueOf(c.db, driverId);
  if (!(await moveJob(c.db, job.id, ["open"], "status = 'assigned', driver_id = ?, driver_station_id = ?, assigned_at = ?", driverId, queued?.stationId ?? null, nowIso()))) {
    throw new ApiError("job_wrong_status");
  }
  await c.db.batch([
    c.db.prepare("delete from driver_queue where driver_id = ?").bind(driverId),
    jobAudit(c, actorId, { ...job, driver_id: driverId }, { status: ["open", "assigned"], by }),
  ]);
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

