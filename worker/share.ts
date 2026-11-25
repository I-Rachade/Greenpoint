import type { AuditEntry, AuditTable } from "../shared/admin/types";
import { distanceMeters } from "../shared/geo";
import {
  cleanShareStation,
  cleanTariff,
  cleanVehicle,
  documentsFor,
  rideCost,
  rideTimes,
  SHARE_DOCUMENTS,
  SHARE_FIX_MAX_AGE_MS,
  SHARE_LONG_RIDE_HOURS,
  SHARE_RESERVE_MINUTES,
  SHARE_VEHICLE_KINDS,
  SHARE_VEHICLE_STATUSES,
  STAFF_VEHICLE_STATUSES,
  stationAt,
  validLatLng,
  type AdminShare,
  type AdminShareRide,
  type AdminShareStation,
  type AdminShareVehicle,
  type AdminShareVerification,
  type ShareDocument,
  type ShareIncident,
  type ShareMe,
  type ShareOverview,
  type ShareRide,
  type ShareStation,
  type ShareStationInput,
  type ShareTariff,
  type ShareTariffInput,
  type ShareTrackPoint,
  type ShareVehicle,
  type ShareVehicleInput,
  type ShareVehicleKind,
  type ShareVehicleStatus,
  type StationShare,
} from "../shared/share";
import type { LatLng } from "../shared/geo";
import type { Profile } from "../shared/types";
import { newTrxId, personLabel } from "../shared/wallet";
import { verifyPin } from "./auth";
import { walletAccess } from "./wallet";
import type { Env } from "./env";
import { ApiError, nowIso, readJson, uuid } from "./http";
import { mobilePaymentOffered, startSharePayment, type Payment } from "./payments";
import { roleAtStation, stationActor, type WorkCtx } from "./station-work";
import { newBoxToken } from "./devices";
import { featuresOf, storedShare } from "./features";
import { refuseNonCustomer } from "./roles";
import { trackerFromEnv, TrackerError, tutrackTime, type Tracker, type TrackerAction } from "./tutrack";

// Share (migration 0060_share.sql, shared/share.ts, docs/SHARE.md): customers rent a vehicle
// at a Share station and hand it back within the radius of any Share station. The server
// unlocks the ignition through the tracker when the ride starts and locks it when it ends, and
// computes the price; the app never names an amount. Paid after the ride with Flooz/T-Money
// (worker/payments.ts), from Green Credit with the PIN, or in cash to the staff of the station
// where it ended.

export interface ShareCtx extends WorkCtx {
  url: URL;
  requireAdmin(): Promise<Profile>;
  audit(
    actor: string | null,
    table: AuditTable,
    action: AuditEntry["action"],
    rowId: string,
    changes: Record<string, unknown>,
    ids?: { stationId?: string | null; userId?: string | null },
  ): D1PreparedStatement;
}

/** The tracker in use; tests replace it. */
let trackerOverride: Tracker | null = null;
export function setTrackerForTests(tracker: Tracker | null) {
  trackerOverride = tracker;
}
function tracker(env: Env): Tracker {
  return trackerOverride ?? trackerFromEnv(env);
}

// Module switch -------------------------------------------------------------------------

/** Whether customers and staff see Share: its own switch, and not while the Lite preset is on. */
export async function shareEnabled(db: D1Database): Promise<boolean> {
  return (await featuresOf(db)).share;
}

/** A switched-off module answers as if it did not exist (as parcels do); the backoffice keeps its pages. */
async function requireShare(db: D1Database) {
  if (!(await shareEnabled(db))) throw new ApiError("not_found", 404);
}

/** Renting is for customers (and admins, to test), like reservations and payments: others 403. */
async function shareCustomer(c: ShareCtx): Promise<Profile> {
  const user = await c.requireUser();
  refuseNonCustomer(user);
  await requireShare(c.db);
  return user;
}

export async function setShareEnabled(c: ShareCtx, enabled: boolean) {
  const admin = await c.requireAdmin();
  const value = enabled ? "1" : "0";
  await c.db.batch([
    c.db
      .prepare(
        `insert into app_settings (key, value, updated_by, updated_at) values ('share_enabled', ?1, ?2, ?3)
         on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
      )
      .bind(value, admin.id, nowIso()),
    c.audit(admin.id, "settings", "update", "share_enabled", { enabled }),
  ]);
}

// Rows ------------------------------------------------------------------------------------

interface VehicleRow {
  id: string;
  kind: ShareVehicleKind;
  name: string;
  plate: string;
  qr_token: string;
  home_station_id: string | null;
  station_id: string | null;
  station_name?: string | null;
  status: ShareVehicleStatus;
  tracker_id: string | null;
  imei: string;
  sim: string;
  unlock_command: string;
  lock_command: string;
  online: number;
  ignition: number | null;
  battery_percent: number | null;
  lat: number | null;
  lng: number | null;
  fix_at: string | null;
  last_seen_at: string | null;
  note: string;
}

const toVehicle = (v: VehicleRow): ShareVehicle => ({
  id: v.id,
  kind: v.kind,
  name: v.name,
  plate: v.plate,
  batteryPercent: v.battery_percent,
  stationId: v.station_id,
  status: v.status,
  lat: v.lat,
  lng: v.lng,
});

const toAdminVehicle = (v: VehicleRow): AdminShareVehicle => ({
  ...toVehicle(v),
  stationName: v.station_name ?? null,
  homeStationId: v.home_station_id,
  trackerId: v.tracker_id,
  imei: v.imei,
  sim: v.sim,
  unlockCommand: v.unlock_command,
  lockCommand: v.lock_command,
  online: !!v.online,
  ignition: v.ignition === null ? null : !!v.ignition,
  lastSeenAt: v.last_seen_at,
  note: v.note,
});

interface TariffRow {
  kind: ShareVehicleKind;
  unlock_xof: number;
  minute_xof: number;
  pause_minute_xof: number;
  deposit_xof: number;
  wrong_drop_xof: number;
  is_active: number;
}

const toTariff = (t: TariffRow): ShareTariff => ({
  kind: t.kind,
  unlockXof: t.unlock_xof,
  minuteXof: t.minute_xof,
  pauseMinuteXof: t.pause_minute_xof,
  depositXof: t.deposit_xof,
  wrongDropXof: t.wrong_drop_xof,
  isActive: !!t.is_active,
});

interface RideRow {
  id: string;
  user_id: string | null;
  vehicle_id: string;
  from_station_id: string;
  to_station_id: string | null;
  end_station_id: string | null;
  status: ShareRide["status"];
  helmet: number;
  reserved_at: string;
  reserve_expires_at: string | null;
  started_at: string | null;
  paused_at: string | null;
  paused_seconds: number;
  ended_at: string | null;
  wrong_drop: number;
  distance_m: number;
  unlock_xof: number;
  minute_xof: number;
  pause_minute_xof: number;
  deposit_xof: number;
  wrong_drop_xof: number;
  amount_xof: number;
  payment_status: ShareRide["paymentStatus"];
  paid_with: ShareRide["paidWith"];
  paid_ref: string | null;
  // joined
  kind: ShareVehicleKind;
  v_name: string;
  plate: string;
  battery_percent: number | null;
  v_lat: number | null;
  v_lng: number | null;
  from_name: string;
  to_name: string | null;
  end_name: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
  t_unlock: number;
  t_minute: number;
  t_pause: number;
  t_deposit: number;
  t_wrong: number;
  t_active: number;
}

const RIDE_SELECT = `
  select r.*, v.kind, v.name as v_name, v.plate, v.battery_percent, v.lat as v_lat, v.lng as v_lng,
         fs.name as from_name, ts.name as to_name, es.name as end_name,
         u.full_name, u.phone, u.email,
         t.unlock_xof as t_unlock, t.minute_xof as t_minute, t.pause_minute_xof as t_pause,
         t.deposit_xof as t_deposit, t.wrong_drop_xof as t_wrong, t.is_active as t_active
    from share_rides r
    join share_vehicles v on v.id = r.vehicle_id
    join stations fs on fs.id = r.from_station_id
    left join stations ts on ts.id = r.to_station_id
    left join stations es on es.id = r.end_station_id
    left join users u on u.id = r.user_id
    left join share_tariffs t on t.kind = v.kind`;

/** The tariff of a ride: as copied when it started, the current one while only reserved. */
function rideTariff(r: RideRow): ShareTariff {
  if (r.started_at) {
    return {
      kind: r.kind,
      unlockXof: r.unlock_xof,
      minuteXof: r.minute_xof,
      pauseMinuteXof: r.pause_minute_xof,
      depositXof: r.deposit_xof,
      wrongDropXof: r.wrong_drop_xof,
      isActive: true,
    };
  }
  return {
    kind: r.kind,
    unlockXof: r.t_unlock ?? 0,
    minuteXof: r.t_minute ?? 0,
    pauseMinuteXof: r.t_pause ?? 0,
    depositXof: r.t_deposit ?? 0,
    wrongDropXof: r.t_wrong ?? 0,
    isActive: !!r.t_active,
  };
}

function toRide(r: RideRow, now = Date.now()): ShareRide {
  const ride: ShareRide = {
    id: r.id,
    vehicle: { id: r.vehicle_id, kind: r.kind, name: r.v_name, plate: r.plate, batteryPercent: r.battery_percent, lat: r.v_lat, lng: r.v_lng },
    fromStationId: r.from_station_id,
    fromStationName: r.from_name,
    toStationId: r.to_station_id,
    toStationName: r.to_name,
    endStationId: r.end_station_id,
    endStationName: r.end_name,
    status: r.status,
    helmet: !!r.helmet,
    reservedAt: r.reserved_at,
    reserveExpiresAt: r.reserve_expires_at,
    startedAt: r.started_at,
    pausedAt: r.paused_at,
    pausedSeconds: r.paused_seconds,
    endedAt: r.ended_at,
    distanceM: r.distance_m,
    amountXof: r.amount_xof,
    paymentStatus: r.payment_status,
    paidWith: r.paid_with,
    tariff: rideTariff(r),
  };
  // On the road: the running estimate, so the app shows what the ride costs so far.
  if (r.status === "riding" || r.status === "paused") ride.amountXof = rideCost(ride.tariff, rideTimes(ride, now));
  return ride;
}

const customerOf = (r: RideRow) => personLabel({ fullName: r.full_name, phone: r.phone, email: r.email });

async function loadRide(db: D1Database, id: string): Promise<RideRow> {
  const r = await db.prepare(`${RIDE_SELECT} where r.id = ?`).bind(id).first<RideRow>();
  if (!r) throw new ApiError("not_found", 404);
  return r;
}

async function ownRide(c: ShareCtx, id: string): Promise<{ user: Profile; ride: RideRow }> {
  const user = await shareCustomer(c);
  await expireReservations(c.db);
  const ride = await c.db.prepare(`${RIDE_SELECT} where r.id = ?`).bind(id).first<RideRow>();
  // Someone else's ride: as if it did not exist.
  if (!ride || ride.user_id !== user.id) throw new ApiError("not_found", 404);
  return { user, ride };
}

// Timers ------------------------------------------------------------------------------------

/** Reservations past their time give the vehicle back. Runs before every Share action and each minute. */
export async function expireReservations(db: D1Database) {
  const now = nowIso();
  await db.batch([
    db
      .prepare(
        `update share_vehicles set status = 'available'
          where status = 'reserved' and id in (select vehicle_id from share_rides where status = 'reserved' and reserve_expires_at <= ?)`,
      )
      .bind(now),
    db.prepare("update share_rides set status = 'cancelled', ended_at = ?1 where status = 'reserved' and reserve_expires_at <= ?1").bind(now),
  ]);
}

/** The minute cron: reservations run out, rides that last too long raise an incident. */
export async function runShareTimers(env: Env) {
  if (!(await shareEnabled(env.DB))) return;
  await expireReservations(env.DB);
  const since = new Date(Date.now() - SHARE_LONG_RIDE_HOURS * 3_600_000).toISOString();
  await env.DB.prepare(
    `insert or ignore into share_incidents (id, kind, vehicle_id, ride_id, note, created_at)
     select lower(hex(randomblob(16))), 'long_ride', vehicle_id, id, '', ?1 from share_rides
      where status in ('riding', 'paused') and started_at <= ?2
        -- Once per ride: a resolved one does not come back.
        and not exists (select 1 from share_incidents i where i.ride_id = share_rides.id and i.kind = 'long_ride')`,
  )
    .bind(nowIso(), since)
    .run();
}

// Public overview -------------------------------------------------------------------------

interface StationRow {
  station_id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radius_m: number;
  helmets: number;
}

const SHARE_STATIONS_SQL = `
  select ss.station_id, s.name, s.address, s.lat, s.lng, ss.radius_m, ss.helmets
    from share_stations ss join stations s on s.id = ss.station_id
   where ss.enabled = 1 and s.is_active = 1`;

async function shareStations(db: D1Database): Promise<StationRow[]> {
  return (await db.prepare(`${SHARE_STATIONS_SQL} order by s.name`).all<StationRow>()).results;
}

async function tariffs(db: D1Database): Promise<ShareTariff[]> {
  const { results } = await db.prepare("select * from share_tariffs").all<TariffRow>();
  return SHARE_VEHICLE_KINDS.map((k) => results.find((t) => t.kind === k)).filter((t): t is TariffRow => !!t).map(toTariff);
}

/** GET /api/share: Share stations with their free vehicles, and the prices. Open, so the map shows them signed out. */
export async function shareOverview(c: ShareCtx): Promise<ShareOverview> {
  if (!(await shareEnabled(c.db))) return { stations: [], tariffs: [] };
  await expireReservations(c.db);
  const [stations, vehicles, prices] = await Promise.all([
    shareStations(c.db),
    c.db.prepare("select * from share_vehicles where status = 'available' and station_id is not null order by name").all<VehicleRow>(),
    tariffs(c.db),
  ]);
  const active = new Set(prices.filter((t) => t.isActive).map((t) => t.kind));
  return {
    stations: stations.map(
      (s): ShareStation => ({
        stationId: s.station_id,
        name: s.name,
        address: s.address,
        lat: s.lat,
        lng: s.lng,
        radiusM: s.radius_m,
        helmets: s.helmets,
        // Parked vehicles stand at their station; kinds without a price are not offered.
        vehicles: vehicles.results
          .filter((v) => v.station_id === s.station_id && active.has(v.kind))
          .map((v) => ({ ...toVehicle(v), lat: v.lat ?? s.lat, lng: v.lng ?? s.lng })),
      }),
    ),
    tariffs: prices.filter((t) => t.isActive),
  };
}

// The customer ------------------------------------------------------------------------------

interface VerificationRow {
  user_id: string;
  status: "pending" | "approved" | "rejected";
  id_key: string | null;
  selfie_key: string | null;
  licence_key: string | null;
  submitted_at: string | null;
  reject_reason: string | null;
}

const DOC_COLUMN: Record<ShareDocument, "id_key" | "selfie_key" | "licence_key"> = { id: "id_key", selfie: "selfie_key", licence: "licence_key" };

const docsOf = (v: VerificationRow | null): ShareDocument[] => (v ? SHARE_DOCUMENTS.filter((d) => !!v[DOC_COLUMN[d]]) : []);

async function verification(db: D1Database, userId: string): Promise<VerificationRow | null> {
  return db.prepare("select * from share_verifications where user_id = ?").bind(userId).first<VerificationRow>();
}

export async function shareMe(c: ShareCtx): Promise<ShareMe> {
  const user = await shareCustomer(c);
  await expireReservations(c.db);
  const [v, open, unpaid, wallet, pending] = await Promise.all([
    verification(c.db, user.id),
    c.db.prepare(`${RIDE_SELECT} where r.user_id = ? and r.status in ('reserved', 'riding', 'paused')`).bind(user.id).first<RideRow>(),
    c.db.prepare(`${RIDE_SELECT} where r.user_id = ? and r.payment_status = 'unpaid' order by r.ended_at`).bind(user.id).all<RideRow>(),
    walletBalance(c.env, user),
    c.db
      .prepare(
        `select p.id, p.share_ride_id from payments p join share_rides r on r.id = p.share_ride_id
          where r.user_id = ? and r.payment_status = 'unpaid' and p.status = 'pending'`,
      )
      .bind(user.id)
      .all<{ id: string; share_ride_id: string }>(),
  ]);
  return {
    verification: v?.status ?? "none",
    documents: docsOf(v),
    rejectReason: v?.status === "rejected" ? v.reject_reason : null,
    ride: open ? toRide(open) : null,
    unpaid: unpaid.results.map((r) => toRide(r)),
    simulated: tracker(c.env).name === "simulated",
    payOptions: { mobile: mobilePaymentOffered(c.env, user), wallet: wallet !== null },
    walletBalanceXof: wallet,
    pendingPayments: Object.fromEntries(pending.results.map((p) => [p.share_ride_id, p.id])),
  };
}

/** The customer's Green Credit balance, or null while they cannot use Green Credit. */
async function walletBalance(env: Env, user: Profile): Promise<number | null> {
  try {
    await walletAccess(env, user);
  } catch {
    return null;
  }
  const w = await env.DB.prepare("select balance_xof, status from wallets where user_id = ?").bind(user.id).first<{ balance_xof: number; status: string }>();
  if (w?.status === "frozen") return null;
  return w?.balance_xof ?? 0;
}

export async function myShareRides(c: ShareCtx): Promise<ShareRide[]> {
  const user = await shareCustomer(c);
  const { results } = await c.db.prepare(`${RIDE_SELECT} where r.user_id = ? order by r.created_at desc limit 30`).bind(user.id).all<RideRow>();
  return results.map((r) => toRide(r));
}

const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_SHARE_IMAGE_BYTES = 2 * 1024 * 1024;

/** POST /api/share/documents/:kind (raw image): a photo of the ID, a selfie or the licence. Private: only admins see it. */
export async function uploadShareDocument(c: ShareCtx, kind: string) {
  const user = await shareCustomer(c);
  const column = DOC_COLUMN[kind as ShareDocument];
  if (!column) throw new ApiError("bad_request");
  const type = (c.request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new ApiError("bad_request");
  if (Number(c.request.headers.get("Content-Length")) > MAX_SHARE_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  const body = await c.request.arrayBuffer();
  if (!body.byteLength) throw new ApiError("bad_request");
  if (body.byteLength > MAX_SHARE_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  const before = await verification(c.db, user.id);
  // An approved customer only adds what a new kind needs (the licence for cars).
  if (before?.status === "approved" && before[column]) return { status: before.status, documents: docsOf(before) };
  const key = `share/${user.id}/${kind}-${uuid()}.${ext}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type } });
  const now = nowIso();
  await c.db
    .prepare(
      `insert into share_verifications (user_id, status, ${column}, submitted_at) values (?1, 'pending', ?2, ?3)
       on conflict (user_id) do update set ${column} = ?2, submitted_at = ?3,
         status = case when share_verifications.status = 'approved' then 'approved' else 'pending' end, reject_reason = null`,
    )
    .bind(user.id, key, now)
    .run();
  const old = before?.[column];
  if (old) await c.env.MEDIA.delete(old);
  const after = await verification(c.db, user.id);
  return { status: after?.status ?? "pending", documents: docsOf(after) };
}

/** Customers rent once an admin approved their photos; a car also needs the licence. */
function requireVerified(v: VerificationRow | null, kind: ShareVehicleKind) {
  if (v?.status !== "approved") throw new ApiError("share_not_verified", 403);
  if (documentsFor(kind).some((d) => !v[DOC_COLUMN[d]])) throw new ApiError("documents_missing");
}

async function vehicleRow(db: D1Database, where: string, value: string): Promise<VehicleRow | null> {
  return db.prepare(`select * from share_vehicles where ${where} = ?`).bind(value).first<VehicleRow>();
}

/**
 * POST /api/share/rides { vehicleId | qrToken, toStationId?, helmet?, start? }: reserves the vehicle
 * for SHARE_RESERVE_MINUTES, or starts the ride right away (start: true, at the vehicle).
 */
export async function reserveShareRide(c: ShareCtx) {
  const user = await shareCustomer(c);
  await expireReservations(c.db);
  const input = await readJson<{ vehicleId?: unknown; qrToken?: unknown; toStationId?: unknown; helmet?: unknown; start?: unknown }>(c.request);
  const vehicle =
    typeof input.vehicleId === "string"
      ? await vehicleRow(c.db, "id", input.vehicleId)
      : typeof input.qrToken === "string"
        ? await vehicleRow(c.db, "qr_token", input.qrToken)
        : null;
  if (!vehicle) throw new ApiError("not_found", 404);
  requireVerified(await verification(c.db, user.id), vehicle.kind);
  if (await c.db.prepare("select 1 from share_rides where user_id = ? and payment_status = 'unpaid'").bind(user.id).first()) {
    throw new ApiError("share_unpaid", 409);
  }
  if (await c.db.prepare("select 1 from share_rides where user_id = ? and status in ('reserved', 'riding', 'paused')").bind(user.id).first()) {
    throw new ApiError("share_ride_open", 409);
  }
  const stations = await shareStations(c.db);
  if (vehicle.status !== "available" || !vehicle.station_id || !stations.some((s) => s.station_id === vehicle.station_id)) {
    throw new ApiError("vehicle_unavailable", 409);
  }
  const tariff = (await tariffs(c.db)).find((t) => t.kind === vehicle.kind);
  if (!tariff?.isActive) throw new ApiError("share_price_missing", 409);
  const toStationId = typeof input.toStationId === "string" && input.toStationId ? input.toStationId : null;
  if (toStationId && !stations.some((s) => s.station_id === toStationId)) throw new ApiError("station_not_found", 404);

  // Taken by whoever's update lands first, also under parallel requests.
  const taken = await c.db.prepare("update share_vehicles set status = 'reserved' where id = ? and status = 'available'").bind(vehicle.id).run();
  if (!taken.meta.changes) throw new ApiError("vehicle_unavailable", 409);
  const id = uuid();
  const now = new Date();
  try {
    await c.db.batch([
      c.db
        .prepare(
          `insert into share_rides (id, user_id, vehicle_id, from_station_id, to_station_id, status, helmet, reserved_at, reserve_expires_at, created_at)
           values (?, ?, ?, ?, ?, 'reserved', ?, ?, ?, ?)`,
        )
        .bind(id, user.id, vehicle.id, vehicle.station_id, toStationId, input.helmet ? 1 : 0, now.toISOString(), new Date(now.getTime() + SHARE_RESERVE_MINUTES * 60_000).toISOString(), now.toISOString()),
      c.audit(user.id, "share_rides", "insert", id, { vehicle: vehicle.id, from: vehicle.station_id, to: toStationId }, { stationId: vehicle.station_id, userId: user.id }),
    ]);
  } catch (err) {
    await c.db.prepare("update share_vehicles set status = 'available' where id = ? and status = 'reserved'").bind(vehicle.id).run();
    if (/UNIQUE/i.test(String(err))) throw new ApiError("share_ride_open", 409);
    throw err;
  }
  if (input.start === true) return startShareRide(c, id);
  return toRide(await loadRide(c.db, id));
}

async function command(c: ShareCtx, vehicle: Pick<VehicleRow, "tracker_id" | "unlock_command" | "lock_command">, action: TrackerAction) {
  try {
    await tracker(c.env).command({ trackerId: vehicle.tracker_id, unlockCommand: vehicle.unlock_command, lockCommand: vehicle.lock_command }, action);
  } catch (err) {
    if (err instanceof TrackerError) {
      console.error("share tracker", action, vehicle.tracker_id, err.message);
      throw new ApiError("device_command_failed", 502);
    }
    throw err;
  }
}

/** POST /api/share/rides/:id/start: at the vehicle, the tracker releases the ignition and the clock runs. */
export async function startShareRide(c: ShareCtx, id: string): Promise<ShareRide> {
  const { user, ride } = await ownRide(c, id);
  if (ride.status !== "reserved") throw new ApiError("share_ride_wrong_status", 409);
  const tariff = rideTariff(ride);
  if (!tariff.isActive) throw new ApiError("share_price_missing", 409);
  const vehicle = (await vehicleRow(c.db, "id", ride.vehicle_id))!;
  await command(c, vehicle, "unlock");
  const now = nowIso();
  const started = await c.db.batch([
    c.db
      .prepare(
        `update share_rides set status = 'riding', started_at = ?, reserve_expires_at = null,
           unlock_xof = ?, minute_xof = ?, pause_minute_xof = ?, deposit_xof = ?, wrong_drop_xof = ?
         where id = ? and status = 'reserved'`,
      )
      .bind(now, tariff.unlockXof, tariff.minuteXof, tariff.pauseMinuteXof, tariff.depositXof, tariff.wrongDropXof, id),
    c.db.prepare("update share_vehicles set status = 'in_ride', station_id = null where id = ? and status = 'reserved'").bind(ride.vehicle_id),
    c.audit(user.id, "share_rides", "update", id, { status: ["reserved", "riding"] }, { stationId: ride.from_station_id, userId: user.id }),
  ]);
  if (!started[0].meta.changes) {
    // Cancelled meanwhile (expired): lock again, nothing was charged.
    await command(c, vehicle, "lock").catch(() => undefined);
    throw new ApiError("share_reservation_expired", 409);
  }
  return toRide(await loadRide(c.db, id));
}

export async function cancelShareRide(c: ShareCtx, id: string): Promise<ShareRide> {
  const { user, ride } = await ownRide(c, id);
  if (ride.status !== "reserved") throw new ApiError("share_ride_wrong_status", 409);
  const now = nowIso();
  await c.db.batch([
    c.db.prepare("update share_rides set status = 'cancelled', ended_at = ?, ended_by = ? where id = ? and status = 'reserved'").bind(now, user.id, id),
    c.db.prepare("update share_vehicles set status = 'available' where id = ? and status = 'reserved'").bind(ride.vehicle_id),
    c.audit(user.id, "share_rides", "update", id, { status: ["reserved", "cancelled"] }, { userId: user.id }),
  ]);
  return toRide(await loadRide(c.db, id));
}

/** POST /api/share/rides/:id/pause | resume: a pause cuts the ignition, the clock runs at the pause price. */
export async function pauseShareRide(c: ShareCtx, id: string, pause: boolean): Promise<ShareRide> {
  const { user, ride } = await ownRide(c, id);
  if (ride.status !== (pause ? "riding" : "paused")) throw new ApiError("share_ride_wrong_status", 409);
  const vehicle = (await vehicleRow(c.db, "id", ride.vehicle_id))!;
  await command(c, vehicle, pause ? "lock" : "unlock");
  const now = new Date();
  const statement = pause
    ? c.db.prepare("update share_rides set status = 'paused', paused_at = ? where id = ? and status = 'riding'").bind(now.toISOString(), id)
    : c.db
        .prepare("update share_rides set status = 'riding', paused_seconds = paused_seconds + ?, paused_at = null where id = ? and status = 'paused'")
        .bind(Math.max(0, Math.round((now.getTime() - Date.parse(ride.paused_at!)) / 1000)), id);
  await c.db.batch([statement, c.audit(user.id, "share_rides", "update", id, { status: [ride.status, pause ? "paused" : "riding"] }, { userId: user.id })]);
  return toRide(await loadRide(c.db, id));
}

/** Where the vehicle stands now: a fresh tracker fix, else the last one if recent enough. */
async function vehiclePosition(c: ShareCtx, vehicle: VehicleRow): Promise<LatLng | null> {
  if (vehicle.tracker_id) {
    const fresh = await tracker(c.env)
      .status(vehicle.tracker_id)
      .catch((err) => (console.error("share tracker status", vehicle.tracker_id, err), null));
    if (fresh?.lat != null && fresh.lng != null) {
      await c.db
        .prepare("update share_vehicles set lat = ?, lng = ?, fix_at = ?, battery_percent = coalesce(?, battery_percent), online = ?, last_seen_at = ? where id = ?")
        .bind(fresh.lat, fresh.lng, fresh.fixAt ?? nowIso(), fresh.batteryPercent, fresh.online ? 1 : 0, nowIso(), vehicle.id)
        .run();
      return { lat: fresh.lat, lng: fresh.lng };
    }
  }
  if (vehicle.lat != null && vehicle.lng != null && vehicle.fix_at && Date.now() - Date.parse(vehicle.fix_at) <= SHARE_FIX_MAX_AGE_MS) {
    return { lat: vehicle.lat, lng: vehicle.lng };
  }
  return null;
}

/** Length of the ride's track in metres. */
async function trackLength(db: D1Database, rideId: string): Promise<number> {
  const { results } = await db.prepare("select lat, lng from share_ride_points where ride_id = ? order by at").bind(rideId).all<LatLng>();
  let total = 0;
  for (let i = 1; i < results.length; i++) total += distanceMeters(results[i - 1], results[i]);
  return Math.round(total);
}

/**
 * POST /api/share/rides/:id/end { lat, lng }: hands the vehicle back. Only within the radius of a
 * Share station, measured on the tracker's position (the phone's while trackers are simulated);
 * then the ignition is cut and the price is fixed.
 */
export async function endShareRide(c: ShareCtx, id: string): Promise<ShareRide> {
  const { user, ride } = await ownRide(c, id);
  if (ride.status !== "riding" && ride.status !== "paused") throw new ApiError("share_ride_wrong_status", 409);
  const body = await readJson<{ lat?: unknown; lng?: unknown }>(c.request).catch(() => ({}) as { lat?: unknown; lng?: unknown });
  const vehicle = (await vehicleRow(c.db, "id", ride.vehicle_id))!;
  const simulated = tracker(c.env).name === "simulated";
  if (simulated && validLatLng(body)) await recordPosition(c.db, vehicle.id, ride.id, { lat: body.lat, lng: body.lng }, null, nowIso());
  const at = simulated && validLatLng(body) ? { lat: body.lat, lng: body.lng } : await vehiclePosition(c, vehicle);
  if (!at) throw new ApiError("device_offline", 409);
  const station = stationAt(
    (await shareStations(c.db)).map((s) => ({ ...s, lat: s.lat, lng: s.lng, radiusM: s.radius_m })),
    at,
  );
  if (!station) throw new ApiError("outside_share_zone", 409);
  await command(c, vehicle, "lock");
  return finishRide(c, ride, { stationId: station.station_id, at, by: user.id, wrongDrop: false });
}

async function finishRide(c: ShareCtx, ride: RideRow, end: { stationId: string | null; at: LatLng | null; by: string; wrongDrop: boolean }): Promise<ShareRide> {
  const now = nowIso();
  const view = toRide(ride);
  const amount = rideCost(view.tariff, rideTimes({ ...view, endedAt: now }, Date.now()), end.wrongDrop);
  const distance = await trackLength(c.db, ride.id);
  const pausedExtra = ride.paused_at ? Math.max(0, Math.round((Date.parse(now) - Date.parse(ride.paused_at)) / 1000)) : 0;
  const done = await c.db.batch([
    c.db
      .prepare(
        `update share_rides set status = 'ended', ended_at = ?1, ended_by = ?2, end_station_id = ?3, paused_seconds = paused_seconds + ?4, paused_at = null,
           wrong_drop = ?5, distance_m = ?6, amount_xof = ?7,
           payment_status = case when ?7 > 0 then 'unpaid' else 'paid' end,
           paid_with = case when ?7 > 0 then null else 'free' end,
           paid_at = case when ?7 > 0 then null else ?1 end
         where id = ?8 and status in ('riding', 'paused')`,
      )
      .bind(now, end.by, end.stationId, pausedExtra, end.wrongDrop ? 1 : 0, distance, amount, ride.id),
    c.db
      .prepare(
        `update share_vehicles set status = case when ?1 is null then 'lost' else 'available' end, station_id = ?1,
           lat = coalesce(?2, lat), lng = coalesce(?3, lng), ignition = 0 where id = ?4`,
      )
      .bind(end.stationId, end.at?.lat ?? null, end.at?.lng ?? null, ride.vehicle_id),
    c.audit(end.by, "share_rides", "update", ride.id, { status: [ride.status, "ended"], station: end.stationId, amount_xof: amount }, { stationId: end.stationId, userId: ride.user_id }),
  ]);
  if (!done[0].meta.changes) throw new ApiError("share_ride_wrong_status", 409);
  return toRide(await loadRide(c.db, ride.id));
}

async function recordPosition(db: D1Database, vehicleId: string, rideId: string | null, at: LatLng, speed: number | null, time: string) {
  const statements = [
    db.prepare("update share_vehicles set lat = ?, lng = ?, fix_at = ?, last_seen_at = ?, online = 1 where id = ?").bind(at.lat, at.lng, time, nowIso(), vehicleId),
  ];
  if (rideId) statements.push(db.prepare("insert into share_ride_points (ride_id, at, lat, lng, speed_kmh) values (?, ?, ?, ?, ?)").bind(rideId, time, at.lat, at.lng, speed));
  await db.batch(statements);
}

/** POST /api/share/rides/:id/position { lat, lng }: the phone's position, only while the trackers are simulated. */
export async function reportSharePosition(c: ShareCtx, id: string) {
  const { ride } = await ownRide(c, id);
  if (tracker(c.env).name !== "simulated") throw new ApiError("forbidden", 403);
  if (ride.status !== "riding" && ride.status !== "paused") throw new ApiError("share_ride_wrong_status", 409);
  const body = await readJson<{ lat?: unknown; lng?: unknown }>(c.request);
  if (!validLatLng(body)) throw new ApiError("bad_request");
  // At most one point every 10 seconds.
  const last = await c.db.prepare("select max(at) as at from share_ride_points where ride_id = ?").bind(id).first<{ at: string | null }>();
  if (last?.at && Date.now() - Date.parse(last.at) < 10_000) return { ok: true };
  await recordPosition(c.db, ride.vehicle_id, id, { lat: body.lat, lng: body.lng }, null, nowIso());
  return { ok: true };
}

/** POST /api/share/rides/:id/problem { note }: a breakdown; the ride pauses (ignition cut) and the backoffice is told. */
export async function reportShareProblem(c: ShareCtx, id: string) {
  const { user, ride } = await ownRide(c, id);
  if (ride.status !== "riding" && ride.status !== "paused") throw new ApiError("share_ride_wrong_status", 409);
  const { note } = await readJson<{ note?: unknown }>(c.request).catch(() => ({ note: "" }));
  const incident = uuid();
  await c.db.batch([
    c.db
      .prepare("insert into share_incidents (id, kind, vehicle_id, ride_id, note, created_at) values (?, 'breakdown', ?, ?, ?, ?)")
      .bind(incident, ride.vehicle_id, ride.id, String(note ?? "").trim().slice(0, 500), nowIso()),
    c.audit(user.id, "share_incidents", "insert", incident, { kind: "breakdown", ride: ride.id }, { userId: user.id }),
  ]).catch((err) => {
    // One open breakdown per ride is enough.
    if (!/UNIQUE/i.test(String(err))) throw err;
  });
  if (ride.status === "riding") return pauseShareRide(c, id, true);
  return toRide(await loadRide(c.db, id));
}

/** POST /api/share/rides/:id/pay/mobile { network, phone }: Flooz/T-Money for an ended ride. */
export async function payShareRideMobile(c: ShareCtx, id: string): Promise<Payment> {
  const { user, ride } = await ownRide(c, id);
  if (ride.payment_status !== "unpaid") throw new ApiError("nothing_owed", 409);
  if (!mobilePaymentOffered(c.env, user)) throw new ApiError("payment_not_offered", 409);
  const body = await readJson<{ network?: unknown; phone?: unknown }>(c.request);
  return startSharePayment(c.env, user, { rideId: ride.id, stationId: ride.end_station_id ?? ride.from_station_id, amountXof: ride.amount_xof }, body);
}

/**
 * POST /api/share/rides/:id/pay/wallet { pin, idempotencyKey }: pays an ended ride from Green
 * Credit. The debit and its booking only apply when this request turned the ride paid, so a
 * second request takes no money; the balance check fails the whole batch when it is short.
 */
export async function payShareRideWallet(c: ShareCtx, id: string): Promise<ShareRide> {
  const { user, ride } = await ownRide(c, id);
  const input = await readJson<{ pin?: unknown; idempotencyKey?: unknown }>(c.request);
  if (ride.payment_status === "paid") return toRide(ride);
  if (ride.payment_status !== "unpaid") throw new ApiError("nothing_owed", 409);
  await walletAccess(c.env, user);
  const key = String(input.idempotencyKey ?? "");
  if (!/^[\w-]{8,64}$/.test(key)) throw new ApiError("bad_request");
  await verifyPin(c.env, user.id, input.pin);
  const wallet = await c.db.prepare("select balance_xof, status from wallets where user_id = ?").bind(user.id).first<{ balance_xof: number; status: string }>();
  if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
  const amount = ride.amount_xof;
  if (!wallet || wallet.balance_xof < amount) throw new ApiError("insufficient_balance");

  const trxId = newTrxId("trip");
  const now = nowIso();
  const mine = "(select paid_ref from share_rides where id = ?) = ?";
  try {
    await c.db.batch([
      c.db
        .prepare("update share_rides set payment_status = 'paid', paid_with = 'wallet', paid_at = ?, paid_ref = ? where id = ? and payment_status = 'unpaid'")
        .bind(now, trxId, id),
      c.db.prepare(`update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ? and ${mine}`).bind(amount, now, user.id, id, trxId),
      c.db
        .prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_label, idempotency_key, details, created_at)
           select ?1, ?2, ?3, 'trip', 'send', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7, ?8
            where (select paid_ref from share_rides where id = ?9) = ?2`,
        )
        .bind(uuid(), trxId, user.id, amount, `Share · ${ride.v_name}`, key, JSON.stringify({ shareRide: id }), now, id),
      c.audit(user.id, "share_rides", "update", id, { payment_status: ["unpaid", "paid"], paid_with: "wallet", amount_xof: amount, trx: trxId }, { userId: user.id }),
    ]);
  } catch (err) {
    if (/CHECK constraint failed/i.test(String(err))) throw new ApiError("insufficient_balance");
    if (/idempotency_key/.test(String(err))) return toRide((await c.db.prepare(`${RIDE_SELECT} where r.id = ?`).bind(id).first<RideRow>())!);
    throw err;
  }
  const after = (await c.db.prepare(`${RIDE_SELECT} where r.id = ?`).bind(id).first<RideRow>())!;
  // Paid meanwhile by another way: nothing was taken.
  if (after.paid_with !== "wallet") throw new ApiError("nothing_owed", 409);
  return toRide(after);
}

/** Called by payments.ts once Flooz/T-Money confirmed a ride's payment. */
export async function sharePaymentSucceeded(env: Env, p: { id: string; share_ride_id: string; amount_xof: number; network: "flooz" | "tmoney"; user_id: string | null }) {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("update share_rides set payment_status = 'paid', paid_with = ?, paid_at = ? where id = ? and payment_status = 'unpaid'").bind(p.network, now, p.share_ride_id),
    env.DB.prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'share_rides', 'update', ?, null, ?, ?)",
    ).bind(now, p.user_id, p.share_ride_id, p.user_id, JSON.stringify({ payment_status: ["unpaid", "paid"], paid_with: p.network, payment: p.id })),
  ]);
}

// Station staff ---------------------------------------------------------------------------

/** GET /api/stations/:id/share: the vehicles parked here, rides heading here, rides to take cash for. */
export async function stationShare(c: ShareCtx, stationId: string): Promise<StationShare> {
  const user = await c.requireUser();
  if (!(await roleAtStation(c.db, user, stationId))) throw new ApiError("forbidden", 403);
  await requireShare(c.db);
  await expireReservations(c.db);
  const [settings, vehicles, incoming, unpaid] = await Promise.all([
    c.db.prepare("select enabled, helmets from share_stations where station_id = ?").bind(stationId).first<{ enabled: number; helmets: number }>(),
    c.db.prepare("select * from share_vehicles where station_id = ? order by name").bind(stationId).all<VehicleRow>(),
    c.db
      .prepare(
        `${RIDE_SELECT} where (r.status in ('riding', 'paused') and r.to_station_id = ?1) or (r.status = 'reserved' and r.from_station_id = ?1)
         order by r.reserved_at`,
      )
      .bind(stationId)
      .all<RideRow>(),
    c.db.prepare(`${RIDE_SELECT} where r.end_station_id = ? and r.payment_status = 'unpaid' order by r.ended_at desc`).bind(stationId).all<RideRow>(),
  ]);
  return {
    enabled: !!settings?.enabled,
    helmets: settings?.helmets ?? 0,
    vehicles: vehicles.results.map(toVehicle),
    incoming: incoming.results.map((r) => toRide(r)),
    unpaid: unpaid.results.map((r) => ({ ...toRide(r), customer: customerOf(r) })),
  };
}

/** POST /api/stations/:id/share/vehicles/:vid/status { status }: on charge, back in service, out of service. */
export async function setStationVehicleStatus(c: ShareCtx, stationId: string, vehicleId: string) {
  const actor = await stationActor(c, stationId);
  await requireShare(c.db);
  const { status } = await readJson<{ status?: ShareVehicleStatus }>(c.request);
  if (!status || !STAFF_VEHICLE_STATUSES.includes(status)) throw new ApiError("bad_request");
  const v = await vehicleRow(c.db, "id", vehicleId);
  if (!v || v.station_id !== stationId) throw new ApiError("not_found", 404);
  if (!STAFF_VEHICLE_STATUSES.includes(v.status)) throw new ApiError("vehicle_unavailable", 409);
  const done = await c.db.batch([
    c.db.prepare("update share_vehicles set status = ? where id = ? and station_id = ? and status in ('available', 'charging', 'maintenance')").bind(status, vehicleId, stationId),
    c.audit(actor.user.id, "share_vehicles", "update", vehicleId, { status: [v.status, status] }, { stationId }),
  ]);
  if (!done[0].meta.changes) throw new ApiError("vehicle_unavailable", 409);
  return toVehicle({ ...v, status });
}

/** POST /api/stations/:id/share/rides/:rid/cash: staff took the cash for a ride that ended here. */
export async function payShareRideCash(c: ShareCtx, stationId: string, rideId: string): Promise<ShareRide> {
  const actor = await stationActor(c, stationId);
  await requireShare(c.db);
  const ride = await loadRide(c.db, rideId);
  if (ride.end_station_id !== stationId) throw new ApiError("not_found", 404);
  if (ride.payment_status !== "unpaid") throw new ApiError("nothing_owed", 409);
  const now = nowIso();
  const done = await c.db.batch([
    c.db
      .prepare("update share_rides set payment_status = 'paid', paid_with = 'cash', paid_at = ?, cash_by = ? where id = ? and payment_status = 'unpaid'")
      .bind(now, actor.user.id, rideId),
    c.audit(actor.user.id, "share_rides", "update", rideId, { payment_status: ["unpaid", "paid"], paid_with: "cash", amount_xof: ride.amount_xof }, { stationId, userId: ride.user_id }),
  ]);
  if (!done[0].meta.changes) throw new ApiError("nothing_owed", 409);
  return toRide(await loadRide(c.db, rideId));
}

// Backoffice ---------------------------------------------------------------------------------

const VEHICLE_SELECT = "select v.*, s.name as station_name from share_vehicles v left join stations s on s.id = v.station_id";

export async function adminShare(c: ShareCtx): Promise<AdminShare> {
  await c.requireAdmin();
  await expireReservations(c.db);
  // The switch itself: the Lite preset hides Share without turning it off.
  const [enabled, vehicles, stations, prices, rides, verifications, incidents] = await Promise.all([
    storedShare(c.db),
    c.db.prepare(`${VEHICLE_SELECT} order by v.name`).all<VehicleRow>(),
    c.db
      .prepare(
        `select s.id as station_id, s.name, coalesce(ss.enabled, 0) as enabled, coalesce(ss.radius_m, 50) as radius_m, coalesce(ss.helmets, 0) as helmets,
                (select count(*) from share_vehicles v where v.station_id = s.id) as vehicles
           from stations s left join share_stations ss on ss.station_id = s.id
          where s.is_active = 1 order by s.name`,
      )
      .all<{ station_id: string; name: string; enabled: number; radius_m: number; helmets: number; vehicles: number }>(),
    tariffs(c.db),
    c.db.prepare(`${RIDE_SELECT} order by r.created_at desc limit 200`).all<RideRow>(),
    c.db
      .prepare(
        `select v.*, u.full_name, u.phone, u.email from share_verifications v join users u on u.id = v.user_id
          order by case v.status when 'pending' then 0 else 1 end, v.submitted_at desc limit 200`,
      )
      .all<VerificationRow & { full_name: string | null; phone: string | null; email: string | null }>(),
    c.db
      .prepare(
        `select i.*, v.name as vehicle_name from share_incidents i left join share_vehicles v on v.id = i.vehicle_id
          order by case when i.resolved_at is null then 0 else 1 end, i.created_at desc limit 200`,
      )
      .all<{ id: string; kind: ShareIncident["kind"]; vehicle_id: string | null; vehicle_name: string | null; ride_id: string | null; note: string; created_at: string; resolved_at: string | null; resolution: string | null }>(),
  ]);
  return {
    enabled,
    simulated: tracker(c.env).name === "simulated",
    vehicles: vehicles.results.map(toAdminVehicle),
    stations: stations.results.map(
      (s): AdminShareStation => ({ stationId: s.station_id, name: s.name, enabled: !!s.enabled, radiusM: s.radius_m, helmets: s.helmets, vehicles: s.vehicles }),
    ),
    tariffs: prices,
    rides: rides.results.map((r): AdminShareRide => ({ ...toRide(r), customer: customerOf(r), customerId: r.user_id })),
    verifications: verifications.results.map(
      (v): AdminShareVerification => ({
        userId: v.user_id,
        customer: personLabel({ fullName: v.full_name, phone: v.phone, email: v.email }),
        status: v.status,
        documents: Object.fromEntries(SHARE_DOCUMENTS.filter((d) => v[DOC_COLUMN[d]]).map((d) => [d, v[DOC_COLUMN[d]]!])),
        submittedAt: v.submitted_at,
        rejectReason: v.reject_reason,
      }),
    ),
    incidents: incidents.results.map(
      (i): ShareIncident => ({
        id: i.id,
        kind: i.kind,
        vehicleId: i.vehicle_id,
        vehicleName: i.vehicle_name,
        rideId: i.ride_id,
        note: i.note,
        createdAt: i.created_at,
        resolvedAt: i.resolved_at,
        resolution: i.resolution,
      }),
    ),
  };
}

async function requireStation(db: D1Database, id: string | null) {
  if (id && !(await db.prepare("select 1 from stations where id = ?").bind(id).first())) throw new ApiError("station_not_found", 404);
}

/** POST /api/admin/share/vehicles { id, input }: adds a vehicle (parked at its home station, out of service) or changes one. */
export async function saveShareVehicle(c: ShareCtx) {
  const admin = await c.requireAdmin();
  const { id, input } = await readJson<{ id?: string | null; input: ShareVehicleInput }>(c.request);
  const clean = cleanVehicle(input);
  if (!clean) throw new ApiError("bad_request");
  await requireStation(c.db, clean.homeStationId);
  const row = {
    kind: clean.kind,
    name: clean.name,
    plate: clean.plate,
    home_station_id: clean.homeStationId,
    tracker_id: clean.trackerId,
    imei: clean.imei,
    sim: clean.sim,
    unlock_command: clean.unlockCommand,
    lock_command: clean.lockCommand,
    note: clean.note,
  };
  try {
    if (id) {
      const before = await c.db.prepare("select * from share_vehicles where id = ?").bind(id).first<Record<string, unknown>>();
      if (!before) throw new ApiError("not_found", 404);
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) if (before[k] !== v) changes[k] = [before[k], v];
      await c.db.batch([
        c.db
          .prepare(
            `update share_vehicles set kind = ?, name = ?, plate = ?, home_station_id = ?, tracker_id = ?, imei = ?, sim = ?,
               unlock_command = ?, lock_command = ?, note = ? where id = ?`,
          )
          .bind(...Object.values(row), id),
        c.audit(admin.id, "share_vehicles", "update", id, changes),
      ]);
      return { id };
    }
    const newId = uuid();
    await c.db.batch([
      c.db
        .prepare(
          `insert into share_vehicles (id, kind, name, plate, home_station_id, tracker_id, imei, sim, unlock_command, lock_command, note,
             qr_token, station_id, status, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'maintenance', ?)`,
        )
        .bind(newId, ...Object.values(row), newBoxToken(), clean.homeStationId, nowIso()),
      c.audit(admin.id, "share_vehicles", "insert", newId, row),
    ]);
    return { id: newId };
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("device_exists", 409);
    throw err;
  }
}

/** DELETE /api/admin/share/vehicles/:id: only a vehicle that never rode (its rides stay in the books otherwise). */
export async function deleteShareVehicle(c: ShareCtx, id: string) {
  const admin = await c.requireAdmin();
  const before = await c.db.prepare("select * from share_vehicles where id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) throw new ApiError("not_found", 404);
  if (await c.db.prepare("select 1 from share_rides where vehicle_id = ?").bind(id).first()) throw new ApiError("request_conflict", 409);
  await c.db.batch([c.db.prepare("delete from share_vehicles where id = ?").bind(id), c.audit(admin.id, "share_vehicles", "delete", id, before)]);
  return { ok: true };
}

/** POST /api/admin/share/vehicles/:id/state { status, stationId }: an admin moves or fetches a vehicle that has no open ride. */
export async function setShareVehicleState(c: ShareCtx, id: string) {
  const admin = await c.requireAdmin();
  const { status, stationId } = await readJson<{ status?: ShareVehicleStatus; stationId?: string | null }>(c.request);
  if (!status || !SHARE_VEHICLE_STATUSES.includes(status) || status === "reserved" || status === "in_ride") throw new ApiError("bad_request");
  const station = stationId ? String(stationId) : null;
  await requireStation(c.db, station);
  if (status === "available" && !station) throw new ApiError("bad_request");
  const v = await vehicleRow(c.db, "id", id);
  if (!v) throw new ApiError("not_found", 404);
  if (await c.db.prepare("select 1 from share_rides where vehicle_id = ? and status in ('reserved', 'riding', 'paused')").bind(id).first()) {
    throw new ApiError("share_ride_open", 409);
  }
  await c.db.batch([
    c.db.prepare("update share_vehicles set status = ?, station_id = ? where id = ?").bind(status, station, id),
    c.audit(admin.id, "share_vehicles", "update", id, { status: [v.status, status], station_id: [v.station_id, station] }, { stationId: station }),
  ]);
  return { ok: true };
}

/** POST /api/admin/share/vehicles/:id/command { action }: test the tracker (unlock, lock, locate). */
export async function shareVehicleCommand(c: ShareCtx, id: string) {
  const admin = await c.requireAdmin();
  const { action } = await readJson<{ action?: TrackerAction }>(c.request);
  if (action !== "unlock" && action !== "lock" && action !== "locate") throw new ApiError("bad_request");
  const v = await vehicleRow(c.db, "id", id);
  if (!v) throw new ApiError("not_found", 404);
  await command(c, v, action);
  await c.audit(admin.id, "share_vehicles", "update", id, { command: action }).run();
  if (action === "locate" && v.tracker_id) await vehiclePosition(c, v);
  return toAdminVehicle((await c.db.prepare(`${VEHICLE_SELECT} where v.id = ?`).bind(id).first<VehicleRow>())!);
}

/** POST /api/admin/share/stations/:id { enabled, radiusM, helmets } */
export async function saveShareStation(c: ShareCtx, stationId: string) {
  const admin = await c.requireAdmin();
  const clean = cleanShareStation(await readJson<ShareStationInput>(c.request));
  if (!clean) throw new ApiError("bad_request");
  await requireStation(c.db, stationId);
  await c.db.batch([
    c.db
      .prepare(
        `insert into share_stations (station_id, enabled, radius_m, helmets, updated_at) values (?1, ?2, ?3, ?4, ?5)
         on conflict (station_id) do update set enabled = ?2, radius_m = ?3, helmets = ?4, updated_at = ?5`,
      )
      .bind(stationId, clean.enabled ? 1 : 0, clean.radiusM, clean.helmets, nowIso()),
    c.audit(admin.id, "share_stations", "update", stationId, { ...clean }, { stationId }),
  ]);
  return { ok: true };
}

/** POST /api/admin/share/tariffs/:kind { … }: prices in FCFA. Rides already started keep theirs. */
export async function saveShareTariff(c: ShareCtx, kind: string) {
  const admin = await c.requireAdmin();
  if (!SHARE_VEHICLE_KINDS.includes(kind as ShareVehicleKind)) throw new ApiError("bad_request");
  const clean = cleanTariff(await readJson<ShareTariffInput>(c.request));
  if (!clean) throw new ApiError("bad_request");
  await c.db.batch([
    c.db
      .prepare(
        `update share_tariffs set unlock_xof = ?, minute_xof = ?, pause_minute_xof = ?, deposit_xof = ?, wrong_drop_xof = ?, is_active = ?, updated_at = ?
          where kind = ?`,
      )
      .bind(clean.unlockXof, clean.minuteXof, clean.pauseMinuteXof, clean.depositXof, clean.wrongDropXof, clean.isActive ? 1 : 0, nowIso(), kind),
    c.audit(admin.id, "share_tariffs", "update", kind, { ...clean }),
  ]);
  return { ok: true };
}

/** POST /api/admin/share/verifications/:userId { approve, reason } */
export async function decideShareVerification(c: ShareCtx, userId: string) {
  const admin = await c.requireAdmin();
  const { approve, reason } = await readJson<{ approve?: boolean; reason?: string }>(c.request);
  const v = await verification(c.db, userId);
  if (!v) throw new ApiError("not_found", 404);
  const why = String(reason ?? "").trim().slice(0, 300);
  if (approve === true) {
    if (!v.id_key || !v.selfie_key) throw new ApiError("documents_missing");
  } else if (!why) {
    throw new ApiError("reason_required");
  }
  const status = approve === true ? "approved" : "rejected";
  await c.db.batch([
    c.db
      .prepare("update share_verifications set status = ?, decided_at = ?, decided_by = ?, reject_reason = ? where user_id = ?")
      .bind(status, nowIso(), admin.id, approve === true ? null : why, userId),
    c.audit(admin.id, "share_verifications", "update", userId, { status: [v.status, status], ...(why ? { reason: why } : {}) }, { userId }),
  ]);
  return { ok: true };
}

/**
 * POST /api/admin/share/rides/:id/end { stationId, wrongDrop }: an admin ends a ride by hand (phone
 * died, tracker offline, vehicle fetched from outside a station). stationId null: left outside,
 * the vehicle becomes "lost" until someone brings it back.
 */
export async function adminEndShareRide(c: ShareCtx, id: string): Promise<ShareRide> {
  const admin = await c.requireAdmin();
  const { stationId, wrongDrop } = await readJson<{ stationId?: string | null; wrongDrop?: boolean }>(c.request);
  const station = stationId ? String(stationId) : null;
  await requireStation(c.db, station);
  const ride = await loadRide(c.db, id);
  if (ride.status === "reserved") {
    await c.db.batch([
      c.db.prepare("update share_rides set status = 'cancelled', ended_at = ?, ended_by = ? where id = ? and status = 'reserved'").bind(nowIso(), admin.id, id),
      c.db.prepare("update share_vehicles set status = 'available' where id = ? and status = 'reserved'").bind(ride.vehicle_id),
      c.audit(admin.id, "share_rides", "update", id, { status: ["reserved", "cancelled"] }, { userId: ride.user_id }),
    ]);
    return toRide(await loadRide(c.db, id));
  }
  if (ride.status !== "riding" && ride.status !== "paused") throw new ApiError("share_ride_wrong_status", 409);
  const vehicle = (await vehicleRow(c.db, "id", ride.vehicle_id))!;
  // Best effort: the vehicle may be out of reach, which is often why the admin ends it.
  await command(c, vehicle, "lock").catch(() => undefined);
  return finishRide(c, ride, { stationId: station, at: null, by: admin.id, wrongDrop: wrongDrop === true });
}

/** POST /api/admin/share/rides/:id/waive: an admin lets an unpaid ride go (goodwill, a breakdown). */
export async function waiveShareRide(c: ShareCtx, id: string) {
  const admin = await c.requireAdmin();
  const ride = await loadRide(c.db, id);
  if (ride.payment_status !== "unpaid") throw new ApiError("nothing_owed", 409);
  await c.db.batch([
    c.db.prepare("update share_rides set payment_status = 'paid', paid_with = 'free', paid_at = ? where id = ? and payment_status = 'unpaid'").bind(nowIso(), id),
    c.audit(admin.id, "share_rides", "update", id, { payment_status: ["unpaid", "paid"], paid_with: "free", amount_xof: ride.amount_xof }, { userId: ride.user_id }),
  ]);
  return { ok: true };
}

export async function shareRideTrack(c: ShareCtx, id: string): Promise<ShareTrackPoint[]> {
  await c.requireAdmin();
  const { results } = await c.db
    .prepare("select at, lat, lng, speed_kmh from share_ride_points where ride_id = ? order by at limit 5000")
    .bind(id)
    .all<{ at: string; lat: number; lng: number; speed_kmh: number | null }>();
  return results.map((p) => ({ at: p.at, lat: p.lat, lng: p.lng, speedKmh: p.speed_kmh }));
}

/** POST /api/admin/share/incidents/:id/resolve { resolution } */
export async function resolveShareIncident(c: ShareCtx, id: string) {
  const admin = await c.requireAdmin();
  const { resolution } = await readJson<{ resolution?: string }>(c.request);
  const text = String(resolution ?? "").trim().slice(0, 300);
  if (!text) throw new ApiError("reason_required");
  const done = await c.db.batch([
    c.db.prepare("update share_incidents set resolved_at = ?, resolved_by = ?, resolution = ? where id = ? and resolved_at is null").bind(nowIso(), admin.id, text, id),
    c.audit(admin.id, "share_incidents", "update", id, { resolution: text }),
  ]);
  if (!done[0].meta.changes) throw new ApiError("not_found", 404);
  return { ok: true };
}

/** A private document photo of a customer, for admins (GET /api/admin/share-files/<key>). */
export async function shareFile(c: ShareCtx, key: string): Promise<Response> {
  await c.requireAdmin();
  if (!/^share\/[\w-]+\/(id|selfie|licence)-[\w-]+\.(jpg|png|webp)$/.test(key)) throw new ApiError("bad_request");
  const object = await c.env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

// Tutrack pushes (worker/tutrack-bridge.ts) --------------------------------------------------

/** Alarms worth an incident when no ride is open (a vehicle moved or opened while parked). */
const PARKED_ALARMS = new Set(["SHAKE", "REMOVE", "POWER_OFF", "FENCE_OUT", "ACC"]);

/** One message of the Tutrack MQTT push: position, online status or alarm. */
export async function ingestTutrack(db: D1Database, message: unknown) {
  const m = message as { deviceId?: unknown; type?: unknown; payload?: Record<string, unknown> } | null;
  if (!m || typeof m.deviceId !== "string" || typeof m.type !== "string") return;
  const v = await db
    .prepare(
      `select v.id, v.status, (select id from share_rides r where r.vehicle_id = v.id and r.status in ('riding', 'paused')) as ride_id
         from share_vehicles v where v.tracker_id = ?`,
    )
    .bind(m.deviceId)
    .first<{ id: string; status: ShareVehicleStatus; ride_id: string | null }>();
  if (!v) return;
  const p = m.payload ?? {};
  const now = nowIso();
  if (m.type === "ENT_LOCATOR_POS") {
    const at = { lat: Number(p.lat), lng: Number(p.lng) };
    if (!validLatLng(at) || (!at.lat && !at.lng)) return;
    const speed = Number(p.speed);
    await recordPosition(db, v.id, v.ride_id, at, Number.isFinite(speed) ? speed : null, tutrackTime(p.deviceTime) ?? now);
  } else if (m.type === "ENT_ONLINE_STATUS") {
    const online = Number(p.onlineStatus) === 1;
    await db.prepare("update share_vehicles set online = ?, last_seen_at = ? where id = ?").bind(online ? 1 : 0, now, v.id).run();
  } else if (m.type === "ENT_ALARM") {
    const code = String(p.alarmCode ?? "");
    if (code === "LOW_POWER") return;
    // While a ride is open the customer moves it: only cut-off power and tampering matter.
    if (v.ride_id ? code !== "REMOVE" && code !== "POWER_OFF" : !PARKED_ALARMS.has(code)) return;
    // The same alarm of a parked vehicle within half an hour is one incident.
    const recent = await db
      .prepare("select 1 from share_incidents where vehicle_id = ? and kind = 'alarm' and resolved_at is null and created_at > ?")
      .bind(v.id, new Date(Date.now() - 30 * 60_000).toISOString())
      .first();
    if (recent) return;
    await db
      .prepare("insert or ignore into share_incidents (id, kind, vehicle_id, ride_id, note, created_at) values (?, 'alarm', ?, ?, ?, ?)")
      .bind(uuid(), v.id, v.ride_id, `${code} ${String(p.alarmDesc ?? "")}`.trim().slice(0, 300), now)
      .run();
  }
}
