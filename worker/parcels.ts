// Parcel depot (phase 1, at the counter). See src/lib/parcels.ts for the shared
// rules and planung/paketdepot.md for the plan.
import type { AuditEntry, AuditTable } from "../src/lib/admin/types";
import { normalizeTogoPhone } from "../src/lib/phone";
import {
  newTrackingNo,
  PARCEL_CODE_LOCK_MINUTES,
  PARCEL_MAX_CODE_FAILURES,
  PARCEL_PICKUP_DAYS,
  PARCEL_REMINDER_DAYS,
  PARCEL_SIZES,
  parsePickupInput,
  sizeFor,
  validMeasures,
  type AdminParcels,
  type Parcel,
  type ParcelDepot,
  type ParcelDepotInput,
  type ParcelInfo,
  type ParcelInput,
  type ParcelSize,
  type ParcelSizeTier,
  type ParcelStatus,
} from "../src/lib/parcels";
import type { DeliveryStatus } from "../src/lib/drivers";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { cancelParcelJob, createExpressJob, driverSettings } from "./drivers";
import { ApiError, nowIso, randomDigits, uuid } from "./http";
import { notifyPerson, type Message } from "./notify";

/** What the parcel handlers need from the request context (worker/api.ts). */
export interface ParcelCtx {
  env: Env;
  db: D1Database;
  user(): Promise<Profile | null>;
  requireUser(): Promise<Profile>;
  requireAdmin(): Promise<Profile>;
  isStaffOf(user: Profile, stationId: string): Promise<boolean>;
  audit(
    actor: string | null,
    table: AuditTable,
    action: AuditEntry["action"],
    rowId: string,
    changes: Record<string, unknown>,
    ids?: { stationId?: string | null; userId?: string | null },
  ): D1PreparedStatement;
}

export const APP_URL = "https://app.poinderecharge.com/colis";

export interface ParcelRow {
  id: string;
  tracking_no: string;
  from_station_id: string;
  to_station_id: string;
  sender_user_id: string | null;
  sender_phone: string;
  sender_name: string | null;
  recipient_user_id: string | null;
  recipient_phone: string;
  recipient_name: string | null;
  content: string;
  declared_value: number | null;
  length_cm: number;
  width_cm: number;
  height_cm: number;
  weight_kg: number;
  size: ParcelSize;
  price_fcfa: number;
  payment_method: string;
  paid_at: string | null;
  status: ParcelStatus;
  pickup_code: string | null;
  locker_no: number | null;
  pickup_deadline: string | null;
  reminders_sent: number;
  created_at: string;
  in_transit_at: string | null;
  arrived_at: string | null;
  picked_up_at: string | null;
  express: number;
  delivery_status: DeliveryStatus | null;
  job_id: string | null;
}

interface SizeRow {
  size: ParcelSize;
  max_length_cm: number;
  max_width_cm: number;
  max_height_cm: number;
  max_weight_kg: number;
  price_fcfa: number;
}

interface DepotRow {
  station_id: string;
  is_active: number;
  note: string;
  lockers: number;
}

export function toParcel(r: ParcelRow, withCode: boolean): Parcel {
  return {
    id: r.id,
    trackingNo: r.tracking_no,
    fromStationId: r.from_station_id,
    toStationId: r.to_station_id,
    sender: { userId: r.sender_user_id, phone: r.sender_phone, name: r.sender_name },
    recipient: { userId: r.recipient_user_id, phone: r.recipient_phone, name: r.recipient_name },
    content: r.content,
    declaredValue: r.declared_value,
    measures: { lengthCm: r.length_cm, widthCm: r.width_cm, heightCm: r.height_cm, weightKg: r.weight_kg },
    size: r.size,
    priceFcfa: r.price_fcfa,
    paymentMethod: r.payment_method,
    paidAt: r.paid_at,
    status: r.status,
    createdAt: r.created_at,
    inTransitAt: r.in_transit_at,
    arrivedAt: r.arrived_at,
    pickedUpAt: r.picked_up_at,
    pickupDeadline: r.pickup_deadline,
    lockerNo: r.locker_no,
    express: !!r.express,
    deliveryStatus: r.delivery_status ?? null,
    jobId: r.job_id ?? null,
    ...(withCode && r.status === "arrived" && r.pickup_code ? { pickupCode: r.pickup_code } : {}),
  };
}

const toTier = (r: SizeRow): ParcelSizeTier => ({
  size: r.size,
  maxLengthCm: r.max_length_cm,
  maxWidthCm: r.max_width_cm,
  maxHeightCm: r.max_height_cm,
  maxWeightKg: r.max_weight_kg,
  priceFcfa: r.price_fcfa,
});

const toDepot = (r: DepotRow): ParcelDepot => ({
  stationId: r.station_id,
  isActive: !!r.is_active,
  note: r.note,
  lockers: r.lockers,
});

export async function sizes(db: D1Database): Promise<ParcelSizeTier[]> {
  const { results } = await db.prepare("select * from parcel_sizes").all<SizeRow>();
  return results.map(toTier).sort((a, b) => PARCEL_SIZES.indexOf(a.size) - PARCEL_SIZES.indexOf(b.size));
}

/** Public: active depots and prices. */
export async function parcelInfo(c: ParcelCtx): Promise<ParcelInfo> {
  const [depots, tiers, driverSettingsValue] = await Promise.all([
    c.db
      .prepare(
        "select d.* from parcel_depots d join stations s on s.id = d.station_id where d.is_active = 1 and s.is_active = 1",
      )
      .all<DepotRow>(),
    sizes(c.db),
    driverSettings(c.db),
  ]);
  return { depots: depots.results.map(toDepot), sizes: tiers, driverSettings: driverSettingsValue };
}

export interface StationInfo {
  id: string;
  name: string;
  address: string;
  opening_hours: string;
}

export async function station(db: D1Database, id: string): Promise<StationInfo | null> {
  return db.prepare("select id, name, address, opening_hours from stations where id = ?").bind(id).first<StationInfo>();
}

export async function requireDepot(db: D1Database, stationId: string) {
  const row = await db
    .prepare(
      "select 1 from parcel_depots d join stations s on s.id = d.station_id where d.station_id = ? and d.is_active = 1 and s.is_active = 1",
    )
    .bind(stationId)
    .first();
  if (!row) throw new ApiError("depot_inactive");
}

export async function requireStaff(c: ParcelCtx, stationId: string): Promise<Profile> {
  const user = await c.requireUser();
  if (!(await c.isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  return user;
}

export function cleanName(value: unknown): string | null {
  const name = String(value ?? "").trim().slice(0, 80);
  return name || null;
}

/**
 * The account of this phone number; creates one without a PIN when there is
 * none. The person sets a PIN with "code by SMS" the first time they open the app.
 */
export async function accountFor(c: ParcelCtx, phone: string, name: string | null, actor: string): Promise<{ id: string; created: boolean }> {
  const find = () => c.db.prepare("select id from users where phone = ?").bind(phone).first<{ id: string }>();
  const existing = await find();
  if (existing) return { id: existing.id, created: false };
  const id = uuid();
  const now = nowIso();
  await c.db
    .prepare("insert into users (id, phone, full_name, role, created_at) values (?, ?, ?, 'rider', ?) on conflict do nothing")
    .bind(id, phone, name, now)
    .run();
  const user = await find();
  if (!user) throw new ApiError("unknown", 500);
  if (user.id === id) {
    await c.audit(actor, "profiles", "insert", id, { phone, role: "rider", source: "parcel" }, { userId: id }).run();
  }
  return { id: user.id, created: user.id === id };
}

export const event = (c: ParcelCtx, parcelId: string, actor: string | null, status: ParcelStatus, stationId: string | null) =>
  c.db
    .prepare("insert into parcel_events (parcel_id, at, actor, status, station_id) values (?, ?, ?, ?, ?)")
    .bind(parcelId, nowIso(), actor, status, stationId);

/** "12/10" in Lomé time (UTC, no daylight saving). */
export const shortDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export function party(name: string | null, phone: string) {
  return name ? `${name} (${phone})` : phone;
}

/** What a new parcel needs; shared by the counter (createParcel) and drivers collecting at home (worker/drivers.ts). */
export interface NewParcel {
  fromStationId: string;
  toStationId: string;
  senderId: string;
  senderPhone: string;
  senderName: string | null;
  recipientId: string;
  recipientPhone: string;
  recipientName: string | null;
  content: string;
  declared: number | null;
  measures: { lengthCm: number; widthCm: number; heightCm: number; weightKg: number };
  tier: ParcelSizeTier;
  paymentMethod: "cash" | "cash_driver";
  status: "deposited" | "in_transit";
  express: boolean;
  jobId?: string;
  actor: string;
}

/** Inserts a parcel with a fresh tracking number, its first history entry and the log entry. */
export async function insertParcel(c: ParcelCtx, p: NewParcel): Promise<{ id: string; trackingNo: string }> {
  const now = nowIso();
  const id = uuid();
  let trackingNo = "";
  for (let attempt = 0; attempt < 5 && !trackingNo; attempt++) {
    const candidate = newTrackingNo();
    try {
      await c.db
        .prepare(
          `insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_user_id, sender_phone, sender_name,
           recipient_user_id, recipient_phone, recipient_name, content, declared_value, length_cm, width_cm, height_cm,
           weight_kg, size, price_fcfa, payment_method, paid_at, status, created_by, created_at, in_transit_at, express, job_id)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id,
          candidate,
          p.fromStationId,
          p.toStationId,
          p.senderId,
          p.senderPhone,
          p.senderName,
          p.recipientId,
          p.recipientPhone,
          p.recipientName,
          p.content,
          p.declared,
          p.measures.lengthCm,
          p.measures.widthCm,
          p.measures.heightCm,
          p.measures.weightKg,
          p.tier.size,
          p.tier.priceFcfa,
          p.paymentMethod,
          now,
          p.status,
          p.actor,
          now,
          p.status === "in_transit" ? now : null,
          p.express ? 1 : 0,
          p.jobId ?? null,
        )
        .run();
      trackingNo = candidate;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
  if (!trackingNo) throw new ApiError("unknown", 500);
  await c.db.batch([
    event(c, id, p.actor, p.status, p.status === "deposited" ? p.fromStationId : null),
    c.audit(
      p.actor,
      "parcels",
      "insert",
      id,
      { tracking_no: trackingNo, to_station_id: p.toStationId, size: p.tier.size, price_fcfa: p.tier.priceFcfa, ...(p.express ? { express: true } : {}) },
      { stationId: p.fromStationId, userId: p.senderId },
    ),
  ]);
  return { id, trackingNo };
}

// Staff at station A -----------------------------------------------------------

export async function createParcel(c: ParcelCtx, fromStationId: string, input: ParcelInput): Promise<Parcel> {
  const staff = await requireStaff(c, fromStationId);
  if (!input || typeof input !== "object") throw new ApiError("bad_request");
  const senderPhone = normalizeTogoPhone(String(input.senderPhone ?? ""));
  const recipientPhone = normalizeTogoPhone(String(input.recipientPhone ?? ""));
  if (!senderPhone || !recipientPhone) throw new ApiError("phone_not_allowed");
  const toStationId = String(input.toStationId ?? "");
  if (toStationId === fromStationId) throw new ApiError("same_station");
  const content = String(input.content ?? "").trim().slice(0, 300);
  if (!content) throw new ApiError("bad_request");
  const declared = input.declaredValue == null || input.declaredValue === ("" as unknown) ? null : Number(input.declaredValue);
  if (declared !== null && !(Number.isInteger(declared) && declared >= 0 && declared <= 100_000_000)) {
    throw new ApiError("bad_request");
  }
  const measures = {
    lengthCm: Number(input.measures?.lengthCm),
    widthCm: Number(input.measures?.widthCm),
    heightCm: Number(input.measures?.heightCm),
    weightKg: Number(input.measures?.weightKg),
  };
  if (![measures.lengthCm, measures.widthCm, measures.heightCm, measures.weightKg].every((v) => Number.isFinite(v) && v > 0)) {
    throw new ApiError("bad_request");
  }
  await requireDepot(c.db, fromStationId);
  await requireDepot(c.db, toStationId);
  const tier = validMeasures(measures) ? sizeFor(measures, await sizes(c.db)) : null;
  if (!tier) throw new ApiError("parcel_too_large");

  const senderName = cleanName(input.senderName);
  const recipientName = cleanName(input.recipientName);
  const sender = await accountFor(c, senderPhone, senderName, staff.id);
  const recipient = await accountFor(c, recipientPhone, recipientName, staff.id);

  const { id, trackingNo } = await insertParcel(c, {
    fromStationId,
    toStationId,
    senderId: sender.id,
    senderPhone,
    senderName,
    recipientId: recipient.id,
    recipientPhone,
    recipientName,
    content,
    declared,
    measures,
    tier,
    paymentMethod: "cash",
    status: "deposited",
    express: !!input.express,
    actor: staff.id,
  });
  const fare = input.express ? await createExpressJob(c, id, staff.id) : 0;

  const [from, to] = await Promise.all([station(c.db, fromStationId), station(c.db, toStationId)]);
  await Promise.all([
    notifyPerson(c.env, id, "deposited", sender.id, {
      subject: `Colis ${trackingNo} déposé`,
      text: `poinderecharge : colis ${trackingNo} déposé à ${from?.name} pour ${to?.name}${fare ? " en express" : ""}. ${tier.priceFcfa + fare} FCFA payés. Suivi : ${APP_URL}`,
    }),
    notifyPerson(c.env, id, "deposited", recipient.id, {
      subject: `Un colis est en route pour vous (${trackingNo})`,
      text: `poinderecharge : un colis de ${party(senderName, senderPhone)} est en route vers ${to?.name}. N° ${trackingNo}. Le code de retrait sera dans l'app à son arrivée. Suivi : ${APP_URL}`,
    }),
  ]);

  const row = await c.db.prepare("select * from parcels where id = ?").bind(id).first<ParcelRow>();
  return toParcel(row!, false);
}

/** Parcels handed in here or coming here, for the station's staff. Staff never see pickup codes. */
export async function stationParcels(c: ParcelCtx, stationId: string): Promise<Parcel[]> {
  await requireStaff(c, stationId);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { results } = await c.db
    .prepare(
      `select * from parcels where (from_station_id = ?1 or to_station_id = ?1)
       and (status in ('deposited', 'in_transit', 'arrived') or created_at > ?2)
       order by created_at desc limit 300`,
    )
    .bind(stationId, since)
    .all<ParcelRow>();
  return results.map((r) => toParcel(r, false));
}

async function loadParcels(c: ParcelCtx, ids: unknown): Promise<ParcelRow[]> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw new ApiError("bad_request");
  const clean = ids.map(String);
  const { results } = await c.db
    .prepare(`select * from parcels where id in (${clean.map(() => "?").join(", ")})`)
    .bind(...clean)
    .all<ParcelRow>();
  if (results.length !== clean.length) throw new ApiError("parcel_not_found", 404);
  return results;
}

/** Staff at station A load the collected parcels for the run to their stations. */
export async function markInTransit(c: ParcelCtx, stationId: string, ids: unknown) {
  const staff = await requireStaff(c, stationId);
  const rows = await loadParcels(c, ids);
  // Express parcels go with a driver, not on the collection run.
  if (rows.some((r) => r.from_station_id !== stationId || r.status !== "deposited" || r.express)) throw new ApiError("parcel_wrong_status");
  const now = nowIso();
  await c.db.batch(
    rows.flatMap((r) => [
      c.db.prepare("update parcels set status = 'in_transit', in_transit_at = ? where id = ? and status = 'deposited'").bind(now, r.id),
      event(c, r.id, staff.id, "in_transit", stationId),
      c.audit(staff.id, "parcels", "update", r.id, { status: ["deposited", "in_transit"] }, { stationId }),
    ]),
  );
}

function deadlineFrom(iso: string): string {
  return new Date(new Date(iso).getTime() + PARCEL_PICKUP_DAYS * 86_400_000).toISOString();
}

function arrivalMessage(r: ParcelRow, to: StationInfo | null, reminder: boolean): Message {
  const where = [to?.name, to?.address].filter(Boolean).join(", ");
  const hours = to?.opening_hours ? ` Horaires : ${to.opening_hours}.` : "";
  const deadline = r.pickup_deadline ? ` A retirer avant le ${shortDate(r.pickup_deadline)}.` : "";
  return {
    subject: reminder ? `Rappel : votre colis ${r.tracking_no} vous attend` : `Votre colis ${r.tracking_no} est arrivé`,
    text: `poinderecharge : ${reminder ? "rappel, " : ""}votre colis ${r.tracking_no} ${reminder ? "vous attend" : "est arrivé"} à ${where}. Code de retrait : ${r.pickup_code}.${deadline}${hours} Code et QR code aussi dans l'app : ${APP_URL}`,
  };
}

/**
 * Staff at station B confirm the parcels that came in. Each gets a 6-digit
 * pickup code, unique among the parcels waiting at this station, and the
 * recipient is told.
 */
export async function markArrived(c: ParcelCtx, stationId: string, ids: unknown) {
  const staff = await requireStaff(c, stationId);
  const rows = await loadParcels(c, ids);
  // Express parcels arrive when staff scan the driver who brings them (worker/drivers.ts).
  if (rows.some((r) => r.to_station_id !== stationId || r.status !== "in_transit" || r.express)) throw new ApiError("parcel_wrong_status");
  const to = await station(c.db, stationId);
  for (const r of rows) await arriveParcel(c, r, staff.id, stationId, to);
}

/** One parcel arrives at its station: it gets its pickup code and the recipient is told. */
export async function arriveParcel(c: ParcelCtx, r: ParcelRow, actor: string, stationId: string, to: StationInfo | null) {
  const now = nowIso();
  const deadline = deadlineFrom(now);
  let code = "";
  for (let attempt = 0; attempt < 10 && !code; attempt++) {
    const candidate = randomDigits(6);
    try {
      const res = await c.db
        .prepare(
          "update parcels set status = 'arrived', pickup_code = ?, arrived_at = ?, pickup_deadline = ? where id = ? and status = 'in_transit'",
        )
        .bind(candidate, now, deadline, r.id)
        .run();
      if (!res.meta.changes) throw new ApiError("parcel_wrong_status");
      code = candidate;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err))) throw err;
    }
  }
  if (!code) throw new ApiError("unknown", 500);
  await c.db.batch([
    event(c, r.id, actor, "arrived", stationId),
    c.audit(actor, "parcels", "update", r.id, { status: ["in_transit", "arrived"] }, { stationId }),
  ]);
  await notifyPerson(c.env, r.id, "arrived", r.recipient_user_id, arrivalMessage({ ...r, pickup_code: code, pickup_deadline: deadline }, to, false));
}

/** Sends the arrival message again (the recipient lost it or changed phone). */
export async function resendPickupCode(c: ParcelCtx, parcelId: string) {
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!row) throw new ApiError("parcel_not_found", 404);
  await requireStaff(c, row.to_station_id);
  if (row.status !== "arrived") throw new ApiError("parcel_wrong_status");
  await notifyPerson(
    c.env,
    row.id,
    "arrived",
    row.recipient_user_id,
    arrivalMessage(row, await station(c.db, row.to_station_id), false),
  );
}

/**
 * Hands a parcel to the recipient at station B: the scanned QR code or the typed
 * 6-digit code finds it. Too many wrong codes pause code entry at the station.
 */
export async function pickUpParcel(c: ParcelCtx, stationId: string, rawInput: unknown): Promise<Parcel> {
  const staff = await requireStaff(c, stationId);
  const input = parsePickupInput(String(rawInput ?? ""));
  if (!input) throw new ApiError("wrong_pickup_code");
  const since = new Date(Date.now() - PARCEL_CODE_LOCK_MINUTES * 60_000).toISOString();
  const failures = await c.db
    .prepare("select count(*) as n from parcel_code_failures where station_id = ? and at > ?")
    .bind(stationId, since)
    .first<{ n: number }>();
  if ((failures?.n ?? 0) >= PARCEL_MAX_CODE_FAILURES) throw new ApiError("code_locked", 429);

  const row = await c.db
    .prepare("select * from parcels where to_station_id = ? and status = 'arrived' and pickup_code = ?")
    .bind(stationId, input.code)
    .first<ParcelRow>();
  if (row?.delivery_status === "out_for_delivery") throw new ApiError("parcel_with_driver");
  if (!row || (input.trackingNo && row.tracking_no !== input.trackingNo)) {
    await c.db.batch([
      c.db.prepare("insert into parcel_code_failures (station_id, at) values (?, ?)").bind(stationId, nowIso()),
      c.db.prepare("delete from parcel_code_failures where at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()),
    ]);
    throw new ApiError("wrong_pickup_code");
  }
  const now = nowIso();
  const done = await c.db
    .prepare("update parcels set status = 'picked_up', picked_up_at = ?, picked_up_by = ? where id = ? and status = 'arrived'")
    .bind(now, staff.id, row.id)
    .run();
  if (!done.meta.changes) throw new ApiError("parcel_wrong_status");
  // The recipient came in person after booking a home delivery: the trip is off.
  if (row.delivery_status === "booked") await cancelParcelJob(c, row.id, staff.id);
  await c.db.batch([
    event(c, row.id, staff.id, "picked_up", stationId),
    c.audit(staff.id, "parcels", "update", row.id, { status: ["arrived", "picked_up"] }, { stationId, userId: row.recipient_user_id }),
  ]);
  const to = await station(c.db, stationId);
  await notifyPerson(c.env, row.id, "picked_up", row.sender_user_id, {
    subject: `Colis ${row.tracking_no} retiré`,
    text: `poinderecharge : votre colis ${row.tracking_no} a été retiré par ${party(row.recipient_name, row.recipient_phone)} à ${to?.name} le ${shortDate(now)}.`,
  });
  return toParcel({ ...row, status: "picked_up", picked_up_at: now }, false);
}

/** Staff at station A (or an admin) cancel a parcel that has not left yet; the sender is refunded at the counter. */
export async function cancelParcel(c: ParcelCtx, parcelId: string) {
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!row) throw new ApiError("parcel_not_found", 404);
  const staff = await requireStaff(c, row.from_station_id);
  if (row.status !== "deposited") throw new ApiError("parcel_wrong_status");
  await c.db.batch([
    c.db.prepare("update parcels set status = 'cancelled', closed_at = ? where id = ? and status = 'deposited'").bind(nowIso(), row.id),
    event(c, row.id, staff.id, "cancelled", row.from_station_id),
    c.audit(staff.id, "parcels", "update", row.id, { status: ["deposited", "cancelled"] }, { stationId: row.from_station_id }),
  ]);
  if (row.job_id) await cancelParcelJob(c, row.id, staff.id);
}

/**
 * Backoffice: a parcel in storage (not picked up in time) is handed out after all,
 * or recorded as auctioned.
 */
export async function closeStoredParcel(c: ParcelCtx, parcelId: string, outcome: "released" | "auctioned") {
  const admin = await c.requireAdmin();
  if (outcome !== "released" && outcome !== "auctioned") throw new ApiError("bad_request");
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!row) throw new ApiError("parcel_not_found", 404);
  if (row.status !== "stored") throw new ApiError("parcel_wrong_status");
  await c.db.batch([
    c.db.prepare("update parcels set status = ?, closed_at = ? where id = ? and status = 'stored'").bind(outcome, nowIso(), row.id),
    event(c, row.id, admin.id, outcome, null),
    c.audit(admin.id, "parcels", "update", row.id, { status: ["stored", outcome] }, { stationId: row.to_station_id }),
  ]);
}

// Customers --------------------------------------------------------------------

/** Parcels the signed-in customer sent or is to receive. Only the recipient sees the pickup code. */
export async function myParcels(c: ParcelCtx): Promise<Parcel[]> {
  const user = await c.user();
  if (!user) return [];
  const { results } = await c.db
    .prepare(
      `select * from parcels where sender_user_id = ?1 or recipient_user_id = ?1
         or (?2 is not null and (sender_phone = ?2 or recipient_phone = ?2))
       order by created_at desc limit 100`,
    )
    .bind(user.id, user.phone)
    .all<ParcelRow>();
  return results.map((r) => {
    const received = r.recipient_user_id === user.id || (!!user.phone && r.recipient_phone === user.phone);
    return { ...toParcel(r, received), direction: received ? "received" : "sent" };
  });
}

// Backoffice -------------------------------------------------------------------

export async function adminParcels(c: ParcelCtx): Promise<AdminParcels> {
  await c.requireAdmin();
  const [parcels, depots, tiers] = await Promise.all([
    c.db.prepare("select * from parcels order by created_at desc limit 1000").all<ParcelRow>(),
    c.db.prepare("select * from parcel_depots").all<DepotRow>(),
    sizes(c.db),
  ]);
  return { parcels: parcels.results.map((r) => toParcel(r, false)), depots: depots.results.map(toDepot), sizes: tiers };
}

export async function saveDepot(c: ParcelCtx, stationId: string, input: ParcelDepotInput) {
  const admin = await c.requireAdmin();
  const lockers = Number(input?.lockers ?? 0);
  if (!Number.isInteger(lockers) || lockers < 0 || lockers > 500) throw new ApiError("bad_request");
  const note = String(input?.note ?? "").trim().slice(0, 200);
  const exists = await c.db.prepare("select 1 from stations where id = ?").bind(stationId).first();
  if (!exists) throw new ApiError("station_not_found", 404);
  const before = await c.db.prepare("select * from parcel_depots where station_id = ?").bind(stationId).first<DepotRow>();
  const after = { is_active: input?.isActive ? 1 : 0, note, lockers };
  await c.db.batch([
    c.db
      .prepare(
        `insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values (?, ?, ?, ?, ?)
         on conflict (station_id) do update set is_active = excluded.is_active, note = excluded.note,
         lockers = excluded.lockers, updated_at = excluded.updated_at`,
      )
      .bind(stationId, after.is_active, note, lockers, nowIso()),
    c.audit(admin.id, "parcel_depots", before ? "update" : "insert", stationId, before ? changed({ ...before }, after) : after, { stationId }),
  ]);
}

function changed(before: Record<string, unknown>, after: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(after)) if (before[key] !== value) out[key] = [before[key] ?? null, value];
  return out;
}

export async function saveSizes(c: ParcelCtx, input: unknown) {
  const admin = await c.requireAdmin();
  if (!Array.isArray(input) || input.length !== PARCEL_SIZES.length) throw new ApiError("bad_request");
  const tiers = input as ParcelSizeTier[];
  if (PARCEL_SIZES.some((s) => !tiers.some((t) => t.size === s))) throw new ApiError("bad_request");
  const valid = (v: unknown, max: number) => typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max;
  for (const t of tiers) {
    if (![t.maxLengthCm, t.maxWidthCm, t.maxHeightCm].every((v) => valid(v, 500)) || !valid(t.maxWeightKg, 50)) {
      throw new ApiError("bad_request");
    }
    if (!Number.isInteger(t.priceFcfa) || t.priceFcfa < 0 || t.priceFcfa > 10_000_000) throw new ApiError("bad_request");
  }
  const before = await sizes(c.db);
  const now = nowIso();
  await c.db.batch(
    tiers.flatMap((t) => {
      const old = before.find((b) => b.size === t.size);
      const diff = old ? changed({ ...old }, { ...t }) : { ...t };
      return [
        c.db
          .prepare(
            "update parcel_sizes set max_length_cm = ?, max_width_cm = ?, max_height_cm = ?, max_weight_kg = ?, price_fcfa = ?, updated_at = ? where size = ?",
          )
          .bind(t.maxLengthCm, t.maxWidthCm, t.maxHeightCm, t.maxWeightKg, t.priceFcfa, now, t.size),
        ...(Object.keys(diff).length ? [c.audit(admin.id, "parcel_sizes", "update", t.size, diff)] : []),
      ];
    }),
  );
}

// Daily job --------------------------------------------------------------------

/**
 * Runs once a day (cron in wrangler.jsonc): reminds recipients on day 3 and 6
 * and moves parcels not picked up after 7 days into storage.
 */
export async function runParcelDeadlines(env: Env) {
  const now = new Date();
  // A parcel out with a driver is not at the station: no reminder, no storage.
  const { results } = await env.DB.prepare(
    "select * from parcels where status = 'arrived' and (delivery_status is null or delivery_status <> 'out_for_delivery')",
  ).all<ParcelRow>();
  for (const r of results) {
    if (!r.arrived_at) continue;
    const days = (now.getTime() - new Date(r.arrived_at).getTime()) / 86_400_000;
    const to = await station(env.DB, r.to_station_id);
    if (r.pickup_deadline && r.pickup_deadline <= now.toISOString()) {
      // Not picked up in time: into storage, to be auctioned (planung/paketdepot.md). The code stops working.
      const res = await env.DB.prepare(
        "update parcels set status = 'stored', pickup_code = null, stored_at = ? where id = ? and status = 'arrived'",
      )
        .bind(now.toISOString(), r.id)
        .run();
      if (!res.meta.changes) continue;
      await env.DB.batch([
        env.DB.prepare("insert into parcel_events (parcel_id, at, actor, status, station_id) values (?, ?, null, 'stored', ?)").bind(
          r.id,
          now.toISOString(),
          r.to_station_id,
        ),
        env.DB.prepare(
          "insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, null, 'parcels', 'update', ?, ?, ?)",
        ).bind(now.toISOString(), r.id, r.to_station_id, JSON.stringify({ status: ["arrived", "stored"] })),
      ]);
      const stored: Message = {
        subject: `Colis ${r.tracking_no} non retiré`,
        text: `poinderecharge : le colis ${r.tracking_no} n'a pas été retiré à ${to?.name} dans les ${PARCEL_PICKUP_DAYS} jours. Il est placé en entrepôt et sera vendu aux enchères selon nos conditions. Contactez-nous rapidement si vous souhaitez le récupérer.`,
      };
      await notifyPerson(env, r.id, "stored", r.sender_user_id, stored);
      await notifyPerson(env, r.id, "stored", r.recipient_user_id, stored);
      continue;
    }
    const due = PARCEL_REMINDER_DAYS.filter((d) => days >= d).length;
    if (due > r.reminders_sent) {
      await env.DB.prepare("update parcels set reminders_sent = ? where id = ?").bind(due, r.id).run();
      await notifyPerson(env, r.id, "reminder", r.recipient_user_id, arrivalMessage(r, to, true));
    }
  }
}
