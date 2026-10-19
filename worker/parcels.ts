// Parcel depot (phase 1, at the counter). See src/lib/parcels.ts for the shared
// rules and planung/paketdepot.md for the plan.
import type { AuditEntry, AuditTable } from "../src/lib/admin/types";
import { normalizeTogoPhone } from "../src/lib/phone";
import {
  newTrackingNo,
  OPEN_PARCEL_STATUSES,
  PARCEL_CODE_LOCK_MINUTES,
  PARCEL_MAX_CODE_FAILURES,
  PARCEL_PICKUP_DAYS,
  PARCEL_REMINDER_DAYS,
  PARCEL_SIZES,
  normalizeTrackingNo,
  parseHandoverInput,
  sizeFor,
  sortHistory,
  validMeasures,
  type AdminParcels,
  type Parcel,
  type ParcelDepot,
  type ParcelDepotInput,
  type ParcelHistoryEntry,
  type ParcelInfo,
  type ParcelInput,
  type ParcelMeasures,
  type ParcelScanKind,
  type ParcelSize,
  type ParcelSizeTier,
  type ParcelStatus,
} from "../src/lib/parcels";
import type { DeliveryStatus } from "../src/lib/drivers";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { cancelParcelJob, createExpressJob, driverSettings, bookableVehicles } from "./drivers";
import { requireDrivers } from "./features";
import { stationUnlocked, unlockedSql } from "./services";
import { ApiError, nowIso, randomDigits, uuid } from "./http";
import { DB_CUSTOMER, roleToDb } from "./roles";
import { stationActor, type StationActor } from "./station-work";
import { withPickupCodeTry } from "./code-tries";
import { notifyPerson, type Message } from "./notify";

/** What the parcel handlers need from the request context (worker/api.ts). */
export interface ParcelCtx {
  env: Env;
  db: D1Database;
  /** The request, for the active station header (station actions, plan phase 3). */
  request?: Request;
  user(): Promise<Profile | null>;
  requireUser(): Promise<Profile>;
  requireAdmin(): Promise<Profile>;
  isStaffOf(user: Profile, stationId: string): Promise<boolean>;
  /** See WorkCtx.onStationActor (worker/station-work.ts). */
  onStationActor?(stationId: string, actor: StationActor): void;
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
  run_id?: string | null;
  label_printed_at?: string | null;
  /** Only in STAFF_SELECT: 1 when the sender has signed in to the app. */
  sender_has_app?: number;
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
  has_counter?: number;
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
    runId: r.run_id ?? null,
    labelPrintedAt: r.label_printed_at ?? null,
    ...(r.sender_has_app === undefined ? {} : { senderHasApp: !!r.sender_has_app }),
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
  counter: r.has_counter !== 0,
  lockers: r.lockers,
});

export async function sizes(db: D1Database): Promise<ParcelSizeTier[]> {
  const { results } = await db.prepare("select * from parcel_sizes").all<SizeRow>();
  return results.map(toTier).sort((a, b) => PARCEL_SIZES.indexOf(a.size) - PARCEL_SIZES.indexOf(b.size));
}

/** Public: active depots and prices. */
export async function parcelInfo(c: ParcelCtx): Promise<ParcelInfo> {
  const [depots, tiers, driverSettingsValue, bookableVehiclesValue] = await Promise.all([
    c.db
      .prepare(
        `select d.* from parcel_depots d join stations s on s.id = d.station_id where d.is_active = 1 and s.is_active = 1
           and ${unlockedSql("d.station_id", "parcels")}`,
      )
      .all<DepotRow>(),
    sizes(c.db),
    driverSettings(c.db),
    bookableVehicles(c.db),
  ]);
  return { depots: depots.results.map(toDepot), sizes: tiers, driverSettings: driverSettingsValue, bookableVehicles: bookableVehiclesValue };
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
  // The station must also be unlocked for parcels (worker/services.ts). The parcel module's
  // global switch is checked where it always was: it hides the parcel routes as a whole.
  if (!(await stationUnlocked(db, stationId, "parcels"))) throw new ApiError("depot_inactive");
}

/** Read access to a station's lists: anyone with rights there, no active station needed. */
export async function requireStaff(c: ParcelCtx, stationId: string): Promise<Profile> {
  const user = await c.requireUser();
  if (!(await c.isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  return user;
}

/** A station action (counter, handover, cancel, …): the active-station rule (R7), logged with station, person and role. */
export async function requireStationActor(c: ParcelCtx, stationId: string): Promise<Profile> {
  return (await parcelStationActor(c, stationId)).user;
}

/**
 * Who acts at the station for a parcel scan or handover, as what (staff, owner, admin):
 * the active-station rule of worker/station-work.ts (403 without rights there, 409 when
 * an owner or admin did not choose this station as the one they work at).
 */
export async function parcelStationActor(c: ParcelCtx, stationId: string): Promise<StationActor> {
  return stationActor(
    {
      env: c.env,
      db: c.db,
      request: c.request ?? new Request("https://api.invalid/"),
      requireUser: () => c.requireUser(),
      onStationActor: (stationId, actor) => c.onStationActor?.(stationId, actor),
    },
    stationId,
  );
}

/**
 * R14: parcels are for customers only. A phone number that belongs to staff, an owner,
 * a driver, a fleet manager (W5) or an admin is refused when the parcel is created; the
 * sender gives another number.
 */
export async function requireCustomerNumber(db: D1Database, phone: string, error: "recipient_not_customer" | "sender_not_customer") {
  const row = await db.prepare("select role from users where phone = ?").bind(phone).first<{ role: string }>();
  if (row && row.role !== DB_CUSTOMER) throw new ApiError(error);
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
    .prepare("insert into users (id, phone, full_name, role, created_at) values (?, ?, ?, ?, ?) on conflict do nothing")
    .bind(id, phone, name, roleToDb("customer"), now)
    .run();
  const user = await find();
  if (!user) throw new ApiError("unknown", 500);
  if (user.id === id) {
    await c.audit(actor, "profiles", "insert", id, { phone, role: "customer", source: "parcel" }, { userId: id }).run();
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

/** What a new parcel row needs; shared by the counter (storeParcel) and drivers collecting at home (worker/drivers.ts). */
export interface ParcelInsert {
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
  paymentMethod: "cash" | "cash_driver" | "partner";
  status: "deposited" | "in_transit";
  express: boolean;
  jobId?: string;
  /** Booked through the partner API: keeps the booking's tracking number, billed to the partner. */
  partner?: { id: string; bookingId: string; trackingNo: string };
  actor: string;
}

/** Inserts a parcel with a fresh tracking number, its first history entry and the log entry. */
export async function insertParcel(c: ParcelCtx, p: ParcelInsert): Promise<{ id: string; trackingNo: string }> {
  const now = nowIso();
  const id = uuid();
  let trackingNo = "";
  for (let attempt = 0; attempt < 5 && !trackingNo; attempt++) {
    const candidate = attempt === 0 && p.partner ? p.partner.trackingNo : newTrackingNo();
    try {
      await c.db
        .prepare(
          `insert into parcels (id, tracking_no, from_station_id, to_station_id, sender_user_id, sender_phone, sender_name,
           recipient_user_id, recipient_phone, recipient_name, content, declared_value, length_cm, width_cm, height_cm,
           weight_kg, size, price_fcfa, payment_method, paid_at, status, created_by, created_at, in_transit_at, express, job_id,
           partner_id, partner_booking_id)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          // Partner parcels are billed to the partner, not paid at the counter.
          p.partner ? null : now,
          p.status,
          p.actor,
          now,
          p.status === "in_transit" ? now : null,
          p.express ? 1 : 0,
          p.jobId ?? null,
          p.partner?.id ?? null,
          p.partner?.bookingId ?? null,
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
      {
        tracking_no: trackingNo,
        to_station_id: p.toStationId,
        size: p.tier.size,
        price_fcfa: p.tier.priceFcfa,
        ...(p.express ? { express: true } : {}),
        ...(p.partner ? { partner_id: p.partner.id } : {}),
      },
      { stationId: p.fromStationId, userId: p.senderId },
    ),
  ]);
  return { id, trackingNo };
}

// Staff at station A -----------------------------------------------------------

export async function createParcel(c: ParcelCtx, fromStationId: string, input: ParcelInput): Promise<Parcel> {
  const staff = await requireStationActor(c, fromStationId);
  if (!input || typeof input !== "object") throw new ApiError("bad_request");
  const senderPhone = normalizeTogoPhone(String(input.senderPhone ?? ""));
  const recipientPhone = normalizeTogoPhone(String(input.recipientPhone ?? ""));
  if (!senderPhone || !recipientPhone) throw new ApiError("phone_not_allowed");
  await requireCustomerNumber(c.db, senderPhone, "sender_not_customer");
  const toStationId = String(input.toStationId ?? "");
  if (toStationId === fromStationId) throw new ApiError("same_station");
  const content = String(input.content ?? "").trim().slice(0, 300);
  if (!content) throw new ApiError("bad_request");
  const declared = input.declaredValue == null || input.declaredValue === ("" as unknown) ? null : Number(input.declaredValue);
  if (declared !== null && !(Number.isInteger(declared) && declared >= 0 && declared <= 100_000_000)) {
    throw new ApiError("bad_request");
  }
  const measures = cleanMeasures(input.measures);
  await requireDepot(c.db, fromStationId);
  await requireDepot(c.db, toStationId);
  // Express needs a driver to carry it to station B.
  if (input.express) await requireDrivers(c.db);
  return storeParcel(c, staff.id, {
    fromStationId,
    toStationId,
    sender: { phone: senderPhone, name: cleanName(input.senderName) },
    recipient: { phone: recipientPhone, name: cleanName(input.recipientName) },
    content,
    declaredValue: declared,
    measures,
    express: !!input.express,
  });
}

/** Measures from a request, or a bad_request error. */
export function cleanMeasures(input: Partial<ParcelMeasures> | undefined): ParcelMeasures {
  const measures = {
    lengthCm: Number(input?.lengthCm),
    widthCm: Number(input?.widthCm),
    heightCm: Number(input?.heightCm),
    weightKg: Number(input?.weightKg),
  };
  if (![measures.lengthCm, measures.widthCm, measures.heightCm, measures.weightKg].every((v) => Number.isFinite(v) && v > 0)) {
    throw new ApiError("bad_request");
  }
  return measures;
}

/** The size tier and price for these measures, or parcel_too_large. */
export async function tierFor(db: D1Database, measures: ParcelMeasures): Promise<ParcelSizeTier> {
  const tier = validMeasures(measures) ? sizeFor(measures, await sizes(db)) : null;
  if (!tier) throw new ApiError("parcel_too_large");
  return tier;
}

export interface NewParcel {
  fromStationId: string;
  toStationId: string;
  sender: { phone: string; name: string | null };
  recipient: { phone: string; name: string | null };
  content: string;
  declaredValue: number | null;
  measures: ParcelMeasures;
  /** Booked through the partner API (worker/partners.ts): billed to the partner, keeps the booking's tracking number. */
  partner?: { id: string; bookingId: string; trackingNo: string };
  /** A driver carries it straight to station B; the fare is paid at the counter too. */
  express?: boolean;
}

/**
 * Parcels as staff see them: with whether the sender has signed in to the app, so the
 * counter knows the drop-off slip reaches them there and is printed only on request.
 */
const STAFF_SELECT = `select p.*, exists (select 1 from users u where u.id = p.sender_user_id and u.last_sign_in_at is not null) as sender_has_app
  from parcels p`;

/**
 * Stores a parcel handed in at the counter (status deposited), creates accounts
 * for unknown phone numbers and tells sender and recipient. Inputs are checked.
 */
export async function storeParcel(c: ParcelCtx, actor: string, p: NewParcel): Promise<Parcel> {
  await requireCustomerNumber(c.db, p.recipient.phone, "recipient_not_customer");
  const tier = await tierFor(c.db, p.measures);
  const { fromStationId, toStationId, measures } = p;
  const senderPhone = p.sender.phone;
  const senderName = p.sender.name;
  const recipientPhone = p.recipient.phone;
  const recipientName = p.recipient.name;
  const sender = await accountFor(c, senderPhone, senderName, actor);
  const recipient = await accountFor(c, recipientPhone, recipientName, actor);

  const { id, trackingNo } = await insertParcel(c, {
    fromStationId,
    toStationId,
    senderId: sender.id,
    senderPhone,
    senderName,
    recipientId: recipient.id,
    recipientPhone,
    recipientName,
    content: p.content,
    declared: p.declaredValue,
    measures,
    tier,
    paymentMethod: p.partner ? "partner" : "cash",
    status: "deposited",
    express: !!p.express,
    partner: p.partner,
    actor,
  });
  const fare = p.express ? await createExpressJob(c, id, actor) : 0;

  const [from, to] = await Promise.all([station(c.db, fromStationId), station(c.db, toStationId)]);
  await Promise.all([
    notifyPerson(c.env, id, "deposited", sender.id, {
      subject: `Colis ${trackingNo} déposé`,
      text: `poinderecharge : colis ${trackingNo} déposé à ${from?.name} pour ${to?.name}${fare ? " en express" : ""}. ${p.partner ? "" : `${tier.priceFcfa + fare} FCFA payés. `}Suivi : ${APP_URL}`,
    }),
    notifyPerson(c.env, id, "deposited", recipient.id, {
      subject: `Un colis est en route pour vous (${trackingNo})`,
      text: `poinderecharge : un colis de ${party(senderName, senderPhone)} est en route vers ${to?.name}. N° ${trackingNo}. Le code de retrait sera dans l'app à son arrivée. Suivi : ${APP_URL}`,
    }),
  ]);

  const row = await c.db.prepare(`${STAFF_SELECT} where p.id = ?`).bind(id).first<ParcelRow>();
  return toParcel(row!, false);
}

/**
 * Staff at the sending or receiving station confirm the shipping label is printed and
 * stuck on the parcel; a reprint (label torn or lost) is confirmed the same way. The
 * first confirmation lets the parcel go on a collection run; every one is in audit_log.
 */
export async function markLabelPrinted(c: ParcelCtx, stationId: string, parcelId: string): Promise<Parcel> {
  const actor = await parcelStationActor(c, stationId);
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!row || (row.from_station_id !== stationId && row.to_station_id !== stationId)) throw new ApiError("parcel_not_found", 404);
  if (!OPEN_PARCEL_STATUSES.includes(row.status)) throw new ApiError("parcel_wrong_status");
  await c.db.batch([
    c.db.prepare("update parcels set label_printed_at = coalesce(label_printed_at, ?) where id = ?").bind(nowIso(), parcelId),
    c.audit(actor.user.id, "parcels", "update", parcelId, { label: row.label_printed_at ? "reprinted" : "printed", role: actor.role }, { stationId }),
  ]);
  const updated = await c.db.prepare(`${STAFF_SELECT} where p.id = ?`).bind(parcelId).first<ParcelRow>();
  return toParcel(updated!, false);
}

/** Parcels handed in here or coming here, for the station's staff. Staff never see pickup codes. */
export async function stationParcels(c: ParcelCtx, stationId: string): Promise<Parcel[]> {
  await requireStaff(c, stationId);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { results } = await c.db
    .prepare(
      `${STAFF_SELECT} where (p.from_station_id = ?1 or p.to_station_id = ?1)
       and (p.status in ('deposited', 'in_transit', 'arrived') or p.created_at > ?2)
       order by p.created_at desc limit 300`,
    )
    .bind(stationId, since)
    .all<ParcelRow>();
  return results.map((r) => toParcel(r, false));
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
  // Station work (R2): staff, owners and admins only, before anything is looked up.
  const user = await c.requireUser();
  if (user.role !== "operator" && user.role !== "admin") throw new ApiError("forbidden", 403);
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!row) throw new ApiError("parcel_not_found", 404);
  await requireStationActor(c, row.to_station_id);
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
 * Hands a parcel to the recipient at station B, only for the recipient's pickup code: the
 * scanned QR code (parcel number and code) or the typed 6-digit code, with or without the
 * parcel number staff found the parcel by. The parcel number alone is printed on the label
 * and is no secret: it finds the parcel, but the handover needs the code (409
 * pickup_code_required). Wrong codes pause entry for a while (withPickupCodeTry): for that
 * parcel when its number came with the code, else for bare codes at this station, so someone
 * guessing the code of one parcel does not stop every other recipient at the counter.
 */
export async function pickUpParcel(c: ParcelCtx, stationId: string, rawInput: unknown, rawTrackingNo?: unknown): Promise<Parcel> {
  const staff = await requireStationActor(c, stationId);
  const input = parseHandoverInput(String(rawInput ?? ""));
  if (!input) throw new ApiError("wrong_pickup_code");
  const typedNo = rawTrackingNo == null || rawTrackingNo === "" ? null : normalizeTrackingNo(String(rawTrackingNo));
  if (rawTrackingNo != null && rawTrackingNo !== "" && !typedNo) throw new ApiError("parcel_not_found", 404);
  if (input.trackingNo && typedNo && input.trackingNo !== typedNo) throw new ApiError("wrong_pickup_code");
  const trackingNo = input.trackingNo ?? typedNo;

  // Found by its number: it must be waiting here, and not out with a driver.
  let known: ParcelRow | null = null;
  if (trackingNo) {
    known = await c.db.prepare("select * from parcels where tracking_no = ?").bind(trackingNo).first<ParcelRow>();
    if (!known) throw new ApiError("parcel_not_found", 404);
    if (known.to_station_id !== stationId || known.status !== "arrived") throw new ApiError("parcel_not_arrived");
    if (known.delivery_status === "out_for_delivery") throw new ApiError("parcel_with_driver");
  }
  const code = input.code;
  if (!code) throw new ApiError("pickup_code_required", 409);
  const row = await withPickupCodeTry(c.db, known ? `parcel:${known.id}` : stationId, PARCEL_MAX_CODE_FAILURES, PARCEL_CODE_LOCK_MINUTES, async () => {
    const found = known
      ? known.pickup_code === code
        ? known
        : null
      : await c.db
          .prepare("select * from parcels where to_station_id = ? and status = 'arrived' and pickup_code = ?")
          .bind(stationId, code)
          .first<ParcelRow>();
    if (!found) throw new ApiError("wrong_pickup_code");
    if (found.delivery_status === "out_for_delivery") throw new ApiError("parcel_with_driver");
    return found;
  });
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
    c.audit(
      staff.id,
      "parcels",
      "update",
      row.id,
      { status: ["arrived", "picked_up"], handedOverBy: input.trackingNo ? "pickup_qr" : "pickup_code" },
      { stationId, userId: row.recipient_user_id },
    ),
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
  // Station work (R2): staff, owners and admins only, before anything is looked up.
  const user = await c.requireUser();
  if (user.role !== "operator" && user.role !== "admin") throw new ApiError("forbidden", 403);
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcelId).first<ParcelRow>();
  if (!row) throw new ApiError("parcel_not_found", 404);
  const staff = await requireStationActor(c, row.from_station_id);
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

/**
 * Parcels the signed-in customer sent or is to receive. Recipient and sender see the pickup
 * code (the sender may pass it on to the recipient); staff never do.
 */
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
  const history = await parcelHistories(c.db, results.map((r) => r.id));
  return results.map((r) => {
    const received = r.recipient_user_id === user.id || (!!user.phone && r.recipient_phone === user.phone);
    return { ...toParcel(r, true), direction: received ? "received" : "sent", history: history.get(r.id) ?? [] };
  });
}

/**
 * What happened to each parcel, oldest first: its status changes (parcel_events) and the
 * scans when it changed hands (parcel_scans, plan phase 7). Customers see where and when,
 * never who.
 */
export async function parcelHistories(db: D1Database, ids: string[]): Promise<Map<string, ParcelHistoryEntry[]>> {
  const out = new Map<string, ParcelHistoryEntry[]>();
  if (!ids.length) return out;
  const marks = ids.map(() => "?").join(", ");
  const [events, scans] = await Promise.all([
    db
      .prepare(`select parcel_id, at, status as kind, station_id from parcel_events where parcel_id in (${marks}) order by id`)
      .bind(...ids)
      .all<{ parcel_id: string; at: string; kind: ParcelStatus; station_id: string | null }>(),
    db
      .prepare(`select parcel_id, created_at as at, kind, station_id from parcel_scans where parcel_id in (${marks}) order by id`)
      .bind(...ids)
      .all<{ parcel_id: string; at: string; kind: ParcelScanKind; station_id: string | null }>(),
  ]);
  for (const r of [...events.results, ...scans.results]) {
    const list = out.get(r.parcel_id) ?? [];
    list.push({ at: r.at, kind: r.kind, stationId: r.station_id });
    out.set(r.parcel_id, list);
  }
  for (const [id, list] of out) out.set(id, sortHistory(list));
  return out;
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

/** Statements that save a station's parcel depot (counter and lockers), with the audit entry. */
export async function depotStatements(c: Pick<ParcelCtx, "db" | "audit">, actor: string, stationId: string, input: ParcelDepotInput) {
  const lockers = Number(input?.lockers ?? 0);
  if (!Number.isInteger(lockers) || lockers < 0 || lockers > 500) throw new ApiError("bad_request");
  const note = String(input?.note ?? "").trim().slice(0, 200);
  const before = await c.db.prepare("select * from parcel_depots where station_id = ?").bind(stationId).first<DepotRow>();
  const counter = input?.counter ?? (before ? before.has_counter !== 0 : true);
  const after = { is_active: input?.isActive ? 1 : 0, note, lockers, has_counter: counter ? 1 : 0 };
  // An active depot needs a counter or at least one locker.
  if (after.is_active && !counter && lockers === 0) throw new ApiError("bad_request");
  return [
    c.db
      .prepare(
        `insert into parcel_depots (station_id, is_active, note, lockers, has_counter, updated_at) values (?, ?, ?, ?, ?, ?)
         on conflict (station_id) do update set is_active = excluded.is_active, note = excluded.note,
         lockers = excluded.lockers, has_counter = excluded.has_counter, updated_at = excluded.updated_at`,
      )
      .bind(stationId, after.is_active, note, lockers, after.has_counter, nowIso()),
    c.audit(actor, "parcel_depots", before ? "update" : "insert", stationId, before ? changed({ ...before }, after) : after, { stationId }),
  ];
}

export async function saveDepot(c: ParcelCtx, stationId: string, input: ParcelDepotInput) {
  const admin = await c.requireAdmin();
  const station = await c.db.prepare("select has_battery from stations where id = ?").bind(stationId).first<{ has_battery: number | null }>();
  if (!station) throw new ApiError("station_not_found", 404);
  const statements = await depotStatements(c, admin.id, stationId, input);
  // A parcel point has nothing else, so its depot cannot be switched off here.
  if (station.has_battery === 0 && !input?.isActive) throw new ApiError("station_without_point");
  await c.db.batch(statements);
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
