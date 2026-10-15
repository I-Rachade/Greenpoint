// Partner API: other apps book parcel transports with an API key and receive
// every status change by webhook (signed) or by polling. Shared types and rules:
// src/lib/partners.ts. Docs: docs/PARTNER-API.md, public/partner-api/openapi.json
// and the page /developpeurs.
//
// A booking waits for drop-off at station A. The staff there take it in
// (measure, check the content) and it becomes an ordinary parcel with the same
// tracking number; from then on it follows the parcel depot (worker/parcels.ts).
// Every row written to parcel_events for a partner parcel is copied into
// partner_events and sent to the partner, so new statuses (drivers) need no change here.
import { normalizeTogoPhone } from "../src/lib/phone";
import { newTrackingNo, PARCEL_SIZES, type Parcel, type ParcelMeasures, type ParcelSize } from "../src/lib/parcels";
import {
  BOOKING_DAYS,
  keyPrefix,
  newApiKey,
  newWebhookSecret,
  PARTNER_API_BASE,
  signWebhook,
  validWebhookUrl,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RETRY_MINUTES,
  type AdminPartners,
  type Partner,
  type PartnerBooking,
  type PartnerEventLog,
  type PartnerInput,
  type PartnerKey,
  type StationBooking,
} from "../src/lib/partners";
import type { Env } from "./env";
import { ApiError, json, nowIso, sha256, uuid } from "./http";
import { unlockedSql } from "./services";
import { DB_CUSTOMER } from "./roles";
import { cleanMeasures, cleanName, requireDepot, requireStaff, sizes, storeParcel, tierFor, type ParcelCtx } from "./parcels";

const TRACKING_URL = "https://app.poinderecharge.com/colis";

// Rows -----------------------------------------------------------------------

interface PartnerRow {
  id: string;
  name: string;
  contact_email: string | null;
  contact_phone: string;
  is_active: number;
  webhook_url: string | null;
  webhook_secret: string;
  share_pickup_code: number;
  created_at: string;
}

interface KeyRow {
  id: string;
  partner_id: string;
  label: string;
  prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface BookingRow {
  id: string;
  partner_id: string;
  reference: string;
  tracking_no: string;
  status: "booked" | "handed_in" | "cancelled" | "expired";
  from_station_id: string;
  to_station_id: string;
  sender_phone: string;
  sender_name: string | null;
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
  parcel_id: string | null;
  created_at: string;
  expires_at: string;
  handed_in_at: string | null;
  closed_at: string | null;
}

/** A booking with the columns of its parcel, once there is one. */
interface BookingWithParcel extends BookingRow {
  p_status: string | null;
  p_size: ParcelSize | null;
  p_price_fcfa: number | null;
  p_length_cm: number | null;
  p_width_cm: number | null;
  p_height_cm: number | null;
  p_weight_kg: number | null;
  p_in_transit_at: string | null;
  p_arrived_at: string | null;
  p_picked_up_at: string | null;
  p_pickup_deadline: string | null;
  p_pickup_code: string | null;
}

interface EventRow {
  seq: number;
  id: string;
  partner_id: string;
  booking_id: string;
  type: string;
  payload: string;
  created_at: string;
  attempts: number;
  next_attempt_at: string | null;
  delivered_at: string | null;
  last_status: number | null;
  last_error: string | null;
}

const BOOKING_SELECT = `
  select b.*, p.status as p_status, p.size as p_size, p.price_fcfa as p_price_fcfa,
         p.length_cm as p_length_cm, p.width_cm as p_width_cm, p.height_cm as p_height_cm, p.weight_kg as p_weight_kg,
         p.in_transit_at as p_in_transit_at, p.arrived_at as p_arrived_at, p.picked_up_at as p_picked_up_at,
         p.pickup_deadline as p_pickup_deadline, p.pickup_code as p_pickup_code
  from partner_bookings b left join parcels p on p.id = b.parcel_id`;

function toBooking(r: BookingWithParcel, partner: Pick<PartnerRow, "share_pickup_code">): PartnerBooking {
  const parcel = !!r.parcel_id && r.p_status !== null;
  const status = parcel ? r.p_status! : r.status;
  return {
    id: r.id,
    reference: r.reference,
    trackingNo: r.tracking_no,
    status,
    fromStationId: r.from_station_id,
    toStationId: r.to_station_id,
    sender: { name: r.sender_name, phone: r.sender_phone },
    recipient: { name: r.recipient_name, phone: r.recipient_phone },
    // After drop-off the measures and price are the ones taken at the counter.
    parcel: {
      content: r.content,
      declaredValue: r.declared_value,
      lengthCm: (parcel && r.p_length_cm) || r.length_cm,
      widthCm: (parcel && r.p_width_cm) || r.width_cm,
      heightCm: (parcel && r.p_height_cm) || r.height_cm,
      weightKg: (parcel && r.p_weight_kg) || r.weight_kg,
      size: (parcel && r.p_size) || r.size,
    },
    priceFcfa: parcel && r.p_price_fcfa !== null ? r.p_price_fcfa : r.price_fcfa,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    handedInAt: r.handed_in_at,
    inTransitAt: r.p_in_transit_at,
    arrivedAt: r.p_arrived_at,
    pickedUpAt: r.p_picked_up_at,
    pickupDeadline: r.p_pickup_deadline,
    ...(partner.share_pickup_code && status === "arrived" && r.p_pickup_code ? { pickupCode: r.p_pickup_code } : {}),
  };
}

const toKey = (r: KeyRow): PartnerKey => ({
  id: r.id,
  label: r.label,
  prefix: r.prefix,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  revokedAt: r.revoked_at,
});

const toEventLog = (r: EventRow): PartnerEventLog => ({
  id: r.id,
  partnerId: r.partner_id,
  bookingId: r.booking_id,
  type: r.type,
  createdAt: r.created_at,
  attempts: r.attempts,
  deliveredAt: r.delivered_at,
  nextAttemptAt: r.next_attempt_at,
  lastStatus: r.last_status,
  lastError: r.last_error,
});

async function loadBooking(db: D1Database, where: string, ...params: unknown[]): Promise<BookingWithParcel | null> {
  return db.prepare(`${BOOKING_SELECT} where ${where}`).bind(...params).first<BookingWithParcel>();
}

// Events ---------------------------------------------------------------------

const eventId = () => `evt_${uuid().replace(/-/g, "")}`;

/**
 * Queues one message for the partner. `sourceKey` says what it was made from;
 * the same key is never queued twice. Returns false when it already was.
 */
async function queueEvent(
  db: D1Database,
  partner: Pick<PartnerRow, "id" | "webhook_url" | "share_pickup_code">,
  bookingId: string,
  type: string,
  sourceKey: string,
  at: string,
  stationId: string | null = null,
): Promise<boolean> {
  const row = await loadBooking(db, "b.id = ?", bookingId);
  if (!row) return false;
  const id = eventId();
  const payload = JSON.stringify({
    id,
    type,
    createdAt: at,
    data: { status: type.slice(type.indexOf(".") + 1), stationId, booking: toBooking(row, partner) },
  });
  const res = await db
    .prepare(
      `insert into partner_events (id, partner_id, booking_id, type, source_key, payload, created_at, next_attempt_at)
       values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (source_key) do nothing`,
    )
    .bind(id, partner.id, bookingId, type, sourceKey, payload, nowIso(), partner.webhook_url ? nowIso() : null)
    .run();
  return !!res.meta.changes;
}

/** Copies new parcel_events of partner parcels into partner_events. */
async function copyParcelEvents(env: Env) {
  const cursorRow = await env.DB.prepare("select value from partner_state where key = 'parcel_events_cursor'").first<{ value: string }>();
  const cursor = Number(cursorRow?.value ?? 0);
  const { results } = await env.DB.prepare(
    `select e.id, e.status, e.at, e.station_id, p.partner_booking_id, pa.id as partner_id, pa.webhook_url, pa.share_pickup_code
     from parcel_events e
     join parcels p on p.id = e.parcel_id
     join partners pa on pa.id = p.partner_id
     where e.id > ? and p.partner_booking_id is not null
     order by e.id limit 200`,
  )
    .bind(cursor)
    .all<{
      id: number;
      status: string;
      at: string;
      station_id: string | null;
      partner_booking_id: string;
      partner_id: string;
      webhook_url: string | null;
      share_pickup_code: number;
    }>();
  for (const e of results) {
    await queueEvent(
      env.DB,
      { id: e.partner_id, webhook_url: e.webhook_url, share_pickup_code: e.share_pickup_code },
      e.partner_booking_id,
      `parcel.${e.status}`,
      `parcel_event:${e.id}`,
      e.at,
      e.station_id,
    );
  }
  // With a full page, continue after its last row next time; otherwise everything up to now is seen.
  const next =
    results.length === 200
      ? results[results.length - 1].id
      : ((await env.DB.prepare("select coalesce(max(id), 0) as n from parcel_events").first<{ n: number }>())?.n ?? cursor);
  if (next > cursor) {
    await env.DB.prepare(
      "update partner_state set value = ?1 where key = 'parcel_events_cursor' and cast(value as integer) < ?1",
    )
      .bind(next)
      .run();
  }
}

/** Posts one message to the partner's webhook. */
async function post(url: string, secret: string, type: string, id: string, body: string): Promise<{ status: number | null; error: string | null }> {
  const timestamp = Math.floor(Date.now() / 1000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "poinderecharge-webhooks/1",
        "Poinderecharge-Event": type,
        "Poinderecharge-Event-Id": id,
        "Poinderecharge-Signature": await signWebhook(secret, timestamp, body),
      },
      body,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, error: res.ok ? null : `http_${res.status}` };
  } catch (err) {
    return { status: null, error: String((err as Error).name === "TimeoutError" ? "timeout" : (err as Error).message).slice(0, 200) };
  }
}

/** Sends due webhook messages; failed ones are retried later (WEBHOOK_RETRY_MINUTES). */
async function deliverDue(env: Env) {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `select e.rowid as seq, e.*, pa.webhook_url, pa.webhook_secret, pa.is_active from partner_events e
     join partners pa on pa.id = e.partner_id
     where e.next_attempt_at is not null and e.next_attempt_at <= ? order by e.rowid limit 50`,
  )
    .bind(now)
    .all<EventRow & { webhook_url: string | null; webhook_secret: string; is_active: number }>();
  for (const e of results) {
    if (!e.webhook_url || !e.is_active) {
      await env.DB.prepare("update partner_events set next_attempt_at = null where id = ?").bind(e.id).run();
      continue;
    }
    // Claim it for a minute, so a second run at the same time does not send it too.
    const lock = new Date(Date.now() + 60_000).toISOString();
    const claimed = await env.DB.prepare("update partner_events set next_attempt_at = ? where id = ? and next_attempt_at = ?")
      .bind(lock, e.id, e.next_attempt_at)
      .run();
    if (!claimed.meta.changes) continue;
    const result = await post(e.webhook_url, e.webhook_secret, e.type, e.id, e.payload);
    const attempts = e.attempts + 1;
    const next =
      result.error === null || attempts >= WEBHOOK_MAX_ATTEMPTS
        ? null
        : new Date(Date.now() + WEBHOOK_RETRY_MINUTES[attempts - 1] * 60_000).toISOString();
    await env.DB.prepare(
      "update partner_events set attempts = ?, next_attempt_at = ?, delivered_at = ?, last_status = ?, last_error = ? where id = ?",
    )
      .bind(attempts, next, result.error === null ? nowIso() : null, result.status, result.error, e.id)
      .run();
  }
}

/**
 * Copies new parcel statuses to the partners and sends due webhooks. Runs after
 * parcel changes (worker/index.ts) and every minute (cron), so retries happen
 * without new traffic. Never throws.
 */
export async function runPartnerEvents(env: Env) {
  try {
    await copyParcelEvents(env);
    await deliverDue(env);
  } catch (err) {
    console.error("Partner events failed", (err as Error).message);
  }
}

/** Daily: bookings not dropped off in time expire. */
export async function runPartnerDeadlines(env: Env) {
  const now = nowIso();
  const { results } = await env.DB.prepare(
    `select b.id, pa.id as partner_id, pa.webhook_url, pa.share_pickup_code from partner_bookings b
     join partners pa on pa.id = b.partner_id where b.status = 'booked' and b.expires_at <= ?`,
  )
    .bind(now)
    .all<{ id: string; partner_id: string; webhook_url: string | null; share_pickup_code: number }>();
  for (const b of results) {
    const res = await env.DB.prepare("update partner_bookings set status = 'expired', closed_at = ? where id = ? and status = 'booked'")
      .bind(now, b.id)
      .run();
    if (!res.meta.changes) continue;
    await queueEvent(env.DB, { id: b.partner_id, webhook_url: b.webhook_url, share_pickup_code: b.share_pickup_code }, b.id, "booking.expired", `booking:${b.id}:expired`, now);
  }
}

// The API for partners -----------------------------------------------------------

/** An error the partner sees as {"error": code, "message": …, "field": …}. */
class PartnerError extends Error {
  constructor(
    public code: string,
    public status = 400,
    public field?: string,
  ) {
    super(code);
  }
}

const MESSAGES: Record<string, string> = {
  missing_api_key: "Send your API key as 'Authorization: Bearer pdr_live_…'.",
  invalid_api_key: "This API key does not exist or was revoked.",
  partner_inactive: "This partner account is switched off. Contact poinderecharge.",
  invalid_request: "A field is missing or invalid, see 'field'.",
  invalid_json: "The body is not valid JSON.",
  phone_not_allowed: "Only Togolese phone numbers (+228) are accepted.",
  recipient_not_customer: "This phone number belongs to a staff, driver or fleet account and cannot receive parcels. Ask for another number.",
  station_not_found: "This station does not exist or takes no parcels.",
  same_station: "Drop-off and pickup station must differ.",
  parcel_too_large: "The parcel is too large or too heavy (50 kg at most).",
  booking_not_found: "No booking with this id or tracking number.",
  booking_not_cancellable: "Only bookings not yet dropped off can be cancelled.",
  not_found: "Unknown endpoint.",
  method_not_allowed: "This endpoint does not accept this method.",
  unknown: "Something went wrong on our side. Try again.",
};

function partnerJson(data: unknown, status = 200, extra: Record<string, string> = {}): Response {
  const res = json(data, status);
  for (const [k, v] of Object.entries(extra)) res.headers.set(k, v);
  return res;
}

function errorResponse(code: string, status: number, field?: string): Response {
  return partnerJson({ error: code, message: MESSAGES[code] ?? code, ...(field ? { field } : {}) }, status);
}

async function authenticate(request: Request, env: Env): Promise<PartnerRow> {
  const header = request.headers.get("Authorization") ?? "";
  const key = (/^Bearer\s+(\S+)$/i.exec(header)?.[1] ?? request.headers.get("X-Api-Key") ?? "").trim();
  if (!key) throw new PartnerError("missing_api_key", 401);
  const row = await env.DB.prepare(
    `select pa.*, k.id as key_id, k.last_used_at from partner_api_keys k join partners pa on pa.id = k.partner_id
     where k.key_hash = ? and k.revoked_at is null`,
  )
    .bind(await sha256(key))
    .first<PartnerRow & { key_id: string; last_used_at: string | null }>();
  if (!row) throw new PartnerError("invalid_api_key", 401);
  if (!row.is_active) throw new PartnerError("partner_inactive", 403);
  const minuteAgo = new Date(Date.now() - 60_000).toISOString();
  if (!row.last_used_at || row.last_used_at < minuteAgo) {
    await env.DB.prepare("update partner_api_keys set last_used_at = ? where id = ?").bind(nowIso(), row.key_id).run();
  }
  return row;
}

async function body<T>(request: Request): Promise<T> {
  try {
    const value = (await request.json()) as T;
    if (!value || typeof value !== "object") throw new Error();
    return value;
  } catch {
    throw new PartnerError("invalid_json");
  }
}

function text(value: unknown, field: string, max: number, required = true): string | null {
  if (value == null || value === "") {
    if (required) throw new PartnerError("invalid_request", 422, field);
    return null;
  }
  if (typeof value !== "string" && typeof value !== "number") throw new PartnerError("invalid_request", 422, field);
  const s = String(value).trim();
  if ((required && !s) || s.length > max) throw new PartnerError("invalid_request", 422, field);
  return s || null;
}

function phone(value: unknown, field: string): string {
  const p = normalizeTogoPhone(String(value ?? ""));
  if (!p) throw new PartnerError("phone_not_allowed", 422, field);
  return p;
}

function measuresFrom(input: Record<string, unknown>): ParcelMeasures {
  try {
    return cleanMeasures(input as Partial<ParcelMeasures>);
  } catch {
    const bad = (["lengthCm", "widthCm", "heightCm", "weightKg"] as const).find((k) => !(Number(input[k]) > 0));
    throw new PartnerError("invalid_request", 422, `parcel.${bad ?? "lengthCm"}`);
  }
}

async function depotOrError(db: D1Database, stationId: string, field: string) {
  try {
    await requireDepot(db, stationId);
  } catch {
    throw new PartnerError("station_not_found", 422, field);
  }
}

async function tierOrError(db: D1Database, m: ParcelMeasures) {
  try {
    return await tierFor(db, m);
  } catch {
    throw new PartnerError("parcel_too_large", 422, "parcel");
  }
}

interface BookingInput {
  reference?: unknown;
  fromStationId?: unknown;
  toStationId?: unknown;
  sender?: { name?: unknown; phone?: unknown } | null;
  recipient?: { name?: unknown; phone?: unknown } | null;
  parcel?: Record<string, unknown> | null;
}

async function createBooking(env: Env, partner: PartnerRow, input: BookingInput): Promise<Response> {
  const reference = text(input.reference, "reference", 64)!;
  const existing = await loadBooking(env.DB, "b.partner_id = ? and b.reference = ?", partner.id, reference);
  // Same reference again (e.g. a retry after a timeout): the booking made the first time.
  if (existing) return partnerJson(toBooking(existing, partner), 200, { "Idempotent-Replay": "true" });

  const fromStationId = text(input.fromStationId, "fromStationId", 64)!;
  const toStationId = text(input.toStationId, "toStationId", 64)!;
  if (fromStationId === toStationId) throw new PartnerError("same_station", 422, "toStationId");
  const recipient = input.recipient ?? {};
  const sender = input.sender ?? {};
  const recipientPhone = phone(recipient.phone, "recipient.phone");
  // R14: parcels are for customers; staff, owners, drivers and fleet managers are refused.
  const holder = await env.DB.prepare("select role from users where phone = ?").bind(recipientPhone).first<{ role: string }>();
  if (holder && holder.role !== DB_CUSTOMER) throw new PartnerError("recipient_not_customer", 422, "recipient.phone");
  const recipientName = cleanName(text(recipient.name, "recipient.name", 80, false));
  const senderPhone = sender.phone ? phone(sender.phone, "sender.phone") : partner.contact_phone;
  const senderName = cleanName(text(sender.name, "sender.name", 80, false)) ?? (sender.phone ? null : partner.name);
  const parcel = input.parcel ?? {};
  const content = text(parcel.content, "parcel.content", 300)!;
  const declared = parcel.declaredValue == null || parcel.declaredValue === "" ? null : Number(parcel.declaredValue);
  if (declared !== null && !(Number.isInteger(declared) && declared >= 0 && declared <= 100_000_000)) {
    throw new PartnerError("invalid_request", 422, "parcel.declaredValue");
  }
  const measures = measuresFrom(parcel);
  await depotOrError(env.DB, fromStationId, "fromStationId");
  await depotOrError(env.DB, toStationId, "toStationId");
  const tier = await tierOrError(env.DB, measures);

  const id = uuid();
  const now = nowIso();
  const expires = new Date(Date.now() + BOOKING_DAYS * 86_400_000).toISOString();
  let trackingNo = "";
  for (let attempt = 0; attempt < 5 && !trackingNo; attempt++) {
    const candidate = newTrackingNo();
    if (await env.DB.prepare("select 1 from parcels where tracking_no = ?").bind(candidate).first()) continue;
    try {
      await env.DB.prepare(
        `insert into partner_bookings (id, partner_id, reference, tracking_no, status, from_station_id, to_station_id,
         sender_phone, sender_name, recipient_phone, recipient_name, content, declared_value, length_cm, width_cm, height_cm,
         weight_kg, size, price_fcfa, created_at, expires_at)
         values (?, ?, ?, ?, 'booked', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
        .bind(
          id,
          partner.id,
          reference,
          candidate,
          fromStationId,
          toStationId,
          senderPhone,
          senderName,
          recipientPhone,
          recipientName,
          content,
          declared,
          measures.lengthCm,
          measures.widthCm,
          measures.heightCm,
          measures.weightKg,
          tier.size,
          tier.priceFcfa,
          now,
          expires,
        )
        .run();
      trackingNo = candidate;
    } catch (err) {
      if (!/UNIQUE/i.test(String(err))) throw err;
      // Two requests with the same reference at once: the other one won.
      const raced = await loadBooking(env.DB, "b.partner_id = ? and b.reference = ?", partner.id, reference);
      if (raced) return partnerJson(toBooking(raced, partner), 200, { "Idempotent-Replay": "true" });
    }
  }
  if (!trackingNo) throw new PartnerError("unknown", 500);
  await env.DB.prepare(
    "insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, null, 'partner_bookings', 'insert', ?, ?, ?)",
  )
    .bind(now, id, fromStationId, JSON.stringify({ partner_id: partner.id, reference, tracking_no: trackingNo, to_station_id: toStationId }))
    .run();
  await queueEvent(env.DB, partner, id, "booking.created", `booking:${id}:created`, now, fromStationId);
  const row = await loadBooking(env.DB, "b.id = ?", id);
  return partnerJson(toBooking(row!, partner), 201, { Location: `${PARTNER_API_BASE}/bookings/${id}` });
}

async function findBooking(db: D1Database, partner: PartnerRow, idOrTracking: string): Promise<BookingWithParcel> {
  const value = decodeURIComponent(idOrTracking);
  const row = await loadBooking(db, "b.partner_id = ?1 and (b.id = ?2 or b.tracking_no = upper(?2))", partner.id, value);
  if (!row) throw new PartnerError("booking_not_found", 404);
  return row;
}

async function bookingDetail(db: D1Database, partner: PartnerRow, row: BookingWithParcel) {
  const history: { status: string; at: string; stationId: string | null }[] = [
    { status: "booked", at: row.created_at, stationId: row.from_station_id },
  ];
  if (row.parcel_id) {
    const { results } = await db
      .prepare("select status, at, station_id from parcel_events where parcel_id = ? order by id")
      .bind(row.parcel_id)
      .all<{ status: string; at: string; station_id: string | null }>();
    history.push(...results.map((e) => ({ status: e.status, at: e.at, stationId: e.station_id })));
  } else if (row.closed_at) {
    history.push({ status: row.status, at: row.closed_at, stationId: null });
  }
  return { ...toBooking(row, partner), trackingUrl: TRACKING_URL, history };
}

async function listBookings(db: D1Database, partner: PartnerRow, url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const where = ["b.partner_id = ?1"];
  const params: unknown[] = [partner.id];
  const reference = url.searchParams.get("reference");
  if (reference) {
    params.push(reference);
    where.push(`b.reference = ?${params.length}`);
  }
  const status = url.searchParams.get("status");
  if (status) {
    params.push(status);
    where.push(`(case when b.parcel_id is not null then p.status else b.status end) = ?${params.length}`);
  }
  const before = url.searchParams.get("before");
  if (before) {
    const ref = await db.prepare("select created_at, id from partner_bookings where id = ? and partner_id = ?").bind(before, partner.id).first<{ created_at: string; id: string }>();
    if (!ref) throw new PartnerError("invalid_request", 422, "before");
    params.push(ref.created_at, ref.id);
    where.push(`(b.created_at, b.id) < (?${params.length - 1}, ?${params.length})`);
  }
  const { results } = await db
    .prepare(`${BOOKING_SELECT} where ${where.join(" and ")} order by b.created_at desc, b.id desc limit ${limit + 1}`)
    .bind(...params)
    .all<BookingWithParcel>();
  const page = results.slice(0, limit).map((r) => toBooking(r, partner));
  return {
    bookings: page,
    nextBefore: results.length > limit ? page[page.length - 1].id : null,
  };
}

async function cancelBooking(env: Env, partner: PartnerRow, row: BookingWithParcel) {
  const now = nowIso();
  const res = await env.DB.prepare("update partner_bookings set status = 'cancelled', closed_at = ? where id = ? and status = 'booked'")
    .bind(now, row.id)
    .run();
  if (!res.meta.changes) throw new PartnerError("booking_not_cancellable", 409);
  await env.DB.prepare(
    "insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, null, 'partner_bookings', 'update', ?, ?, ?)",
  )
    .bind(now, row.id, row.from_station_id, JSON.stringify({ status: ["booked", "cancelled"], by: "partner" }))
    .run();
  await queueEvent(env.DB, partner, row.id, "booking.cancelled", `booking:${row.id}:cancelled`, now);
  return bookingDetail(env.DB, partner, (await loadBooking(env.DB, "b.id = ?", row.id))!);
}

async function listEvents(db: D1Database, partner: PartnerRow, url: URL) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit")) || 50));
  const after = url.searchParams.get("after");
  let since = 0;
  if (after) {
    const ref = await db.prepare("select rowid as seq from partner_events where id = ? and partner_id = ?").bind(after, partner.id).first<{ seq: number }>();
    if (!ref) throw new PartnerError("invalid_request", 422, "after");
    since = ref.seq;
  }
  const { results } = await db
    .prepare(`select rowid as seq, payload from partner_events where partner_id = ? and rowid > ? order by rowid limit ${limit}`)
    .bind(partner.id, since)
    .all<{ seq: number; payload: string }>();
  return { events: results.map((r) => JSON.parse(r.payload)) };
}

async function setWebhook(env: Env, partner: PartnerRow, input: { url?: unknown }) {
  const url = input.url == null || input.url === "" ? null : String(input.url).trim();
  if (url !== null && !validWebhookUrl(url)) throw new PartnerError("invalid_request", 422, "url");
  await env.DB.prepare("update partners set webhook_url = ?, updated_at = ? where id = ?").bind(url, nowIso(), partner.id).run();
  return { url, secret: partner.webhook_secret };
}

async function rotateSecret(db: D1Database, partnerId: string): Promise<string> {
  const secret = newWebhookSecret();
  await db.prepare("update partners set webhook_secret = ?, updated_at = ? where id = ?").bind(secret, nowIso(), partnerId).run();
  return secret;
}

async function testWebhook(partner: PartnerRow) {
  if (!partner.webhook_url) throw new PartnerError("invalid_request", 422, "url");
  const id = eventId();
  const payload = JSON.stringify({ id, type: "ping", createdAt: nowIso(), data: { partner: partner.name } });
  const result = await post(partner.webhook_url, partner.webhook_secret, "ping", id, payload);
  return { delivered: result.error === null, status: result.status, error: result.error };
}

async function stationsForPartners(db: D1Database) {
  const { results } = await db
    .prepare(
      `select s.id, s.name, s.address, s.lat, s.lng, s.opening_hours, s.phone, d.note from parcel_depots d
       join stations s on s.id = d.station_id where d.is_active = 1 and s.is_active = 1 and ${unlockedSql("s.id", "parcels")} order by s.name`,
    )
    .all<{ id: string; name: string; address: string; lat: number; lng: number; opening_hours: string; phone: string | null; note: string }>();
  return {
    stations: results.map((s) => ({
      id: s.id,
      name: s.name,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      openingHours: s.opening_hours,
      phone: s.phone,
      note: s.note,
    })),
  };
}

async function quote(db: D1Database, input: BookingInput) {
  const fromStationId = text(input.fromStationId, "fromStationId", 64)!;
  const toStationId = text(input.toStationId, "toStationId", 64)!;
  if (fromStationId === toStationId) throw new PartnerError("same_station", 422, "toStationId");
  await depotOrError(db, fromStationId, "fromStationId");
  await depotOrError(db, toStationId, "toStationId");
  const tier = await tierOrError(db, measuresFrom(input.parcel ?? {}));
  return { size: tier.size, priceFcfa: tier.priceFcfa, currency: "XOF" };
}

/** Answers every request under /api/partner/v1/. */
export async function handlePartnerApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.slice(PARTNER_API_BASE.length).replace(/\/$/, "") || "/";
  const method = request.method;
  try {
    const partner = await authenticate(request, env);
    let m: RegExpExecArray | null;
    if (path === "/stations" && method === "GET") return partnerJson(await stationsForPartners(env.DB));
    if (path === "/prices" && method === "GET") {
      const tiers = await sizes(env.DB);
      return partnerJson({ currency: "XOF", sizes: tiers.sort((a, b) => PARCEL_SIZES.indexOf(a.size) - PARCEL_SIZES.indexOf(b.size)) });
    }
    if (path === "/quote" && method === "POST") return partnerJson(await quote(env.DB, await body<BookingInput>(request)));
    if (path === "/bookings" && method === "POST") return await createBooking(env, partner, await body<BookingInput>(request));
    if (path === "/bookings" && method === "GET") return partnerJson(await listBookings(env.DB, partner, url));
    if ((m = /^\/bookings\/([^/]+)$/.exec(path)) && method === "GET") {
      return partnerJson(await bookingDetail(env.DB, partner, await findBooking(env.DB, partner, m[1])));
    }
    if ((m = /^\/bookings\/([^/]+)\/cancel$/.exec(path)) && method === "POST") {
      return partnerJson(await cancelBooking(env, partner, await findBooking(env.DB, partner, m[1])));
    }
    if (path === "/events" && method === "GET") return partnerJson(await listEvents(env.DB, partner, url));
    if (path === "/webhook" && method === "GET") return partnerJson({ url: partner.webhook_url, secret: partner.webhook_secret });
    if (path === "/webhook" && method === "PUT") return partnerJson(await setWebhook(env, partner, await body(request)));
    if (path === "/webhook/test" && method === "POST") return partnerJson(await testWebhook(partner));
    if (path === "/webhook/secret" && method === "POST") return partnerJson({ secret: await rotateSecret(env.DB, partner.id) });
    const known = ["/stations", "/prices", "/quote", "/bookings", "/events", "/webhook", "/webhook/test", "/webhook/secret"];
    if (known.includes(path) || /^\/bookings\/[^/]+(\/cancel)?$/.test(path)) return errorResponse("method_not_allowed", 405);
    return errorResponse("not_found", 404);
  } catch (err) {
    if (err instanceof PartnerError) return errorResponse(err.code, err.status, err.field);
    console.error("Partner API", err);
    return errorResponse("unknown", 500);
  }
}

// Station staff ------------------------------------------------------------------

/** Bookings waiting for drop-off at this station, for its staff. */
export async function stationBookings(c: ParcelCtx, stationId: string): Promise<StationBooking[]> {
  await requireStaff(c, stationId);
  const { results } = await c.db
    .prepare(
      `select b.*, pa.name as partner_name from partner_bookings b join partners pa on pa.id = b.partner_id
       where b.from_station_id = ? and b.status = 'booked' and b.expires_at > ? order by b.created_at limit 300`,
    )
    .bind(stationId, nowIso())
    .all<BookingRow & { partner_name: string }>();
  return results.map((r) => ({
    id: r.id,
    trackingNo: r.tracking_no,
    partnerName: r.partner_name,
    reference: r.reference,
    toStationId: r.to_station_id,
    sender: { name: r.sender_name, phone: r.sender_phone },
    recipient: { name: r.recipient_name, phone: r.recipient_phone },
    content: r.content,
    declaredValue: r.declared_value,
    measures: { lengthCm: r.length_cm, widthCm: r.width_cm, heightCm: r.height_cm, weightKg: r.weight_kg },
    size: r.size,
    priceFcfa: r.price_fcfa,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
  }));
}

/**
 * Staff take in a booked parcel: they measured it and checked its content. It
 * becomes a parcel with the booking's tracking number; a larger parcel than
 * booked gets the larger size and price.
 */
export async function acceptBooking(c: ParcelCtx, stationId: string, bookingId: string, measuresInput: Partial<ParcelMeasures>): Promise<Parcel> {
  const staff = await requireStaff(c, stationId);
  const measures = cleanMeasures(measuresInput);
  const row = await c.db.prepare("select * from partner_bookings where id = ? or tracking_no = upper(?)").bind(bookingId, bookingId).first<BookingRow>();
  if (!row || row.from_station_id !== stationId) throw new ApiError("parcel_not_found", 404);
  if (row.status !== "booked" || row.expires_at <= nowIso()) throw new ApiError("parcel_wrong_status");
  await requireDepot(c.db, stationId);
  await requireDepot(c.db, row.to_station_id);
  await tierFor(c.db, measures);
  const now = nowIso();
  const claimed = await c.db
    .prepare("update partner_bookings set status = 'handed_in', handed_in_at = ? where id = ? and status = 'booked'")
    .bind(now, row.id)
    .run();
  if (!claimed.meta.changes) throw new ApiError("parcel_wrong_status");
  let parcel: Parcel;
  try {
    parcel = await storeParcel(c, staff.id, {
      fromStationId: stationId,
      toStationId: row.to_station_id,
      sender: { phone: row.sender_phone, name: row.sender_name },
      recipient: { phone: row.recipient_phone, name: row.recipient_name },
      content: row.content,
      declaredValue: row.declared_value,
      measures,
      partner: { id: row.partner_id, bookingId: row.id, trackingNo: row.tracking_no },
    });
  } catch (err) {
    await c.db.prepare("update partner_bookings set status = 'booked', handed_in_at = null where id = ?").bind(row.id).run();
    throw err;
  }
  await c.db.batch([
    c.db.prepare("update partner_bookings set parcel_id = ? where id = ?").bind(parcel.id, row.id),
    c.audit(staff.id, "partner_bookings", "update", row.id, { status: ["booked", "handed_in"], parcel_id: parcel.id }, { stationId }),
  ]);
  return parcel;
}

// Backoffice ---------------------------------------------------------------------

export async function adminPartners(c: ParcelCtx): Promise<AdminPartners> {
  await c.requireAdmin();
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [partners, keys, stats, open, events] = await Promise.all([
    c.db.prepare("select * from partners order by name").all<PartnerRow>(),
    c.db.prepare("select * from partner_api_keys order by created_at desc").all<KeyRow>(),
    c.db
      .prepare(
        "select partner_id, count(*) as n, coalesce(sum(price_fcfa), 0) as amount from parcels where partner_id is not null and created_at > ? and status <> 'cancelled' group by partner_id",
      )
      .bind(monthAgo)
      .all<{ partner_id: string; n: number; amount: number }>(),
    c.db
      .prepare("select partner_id, count(*) as n from partner_bookings where status = 'booked' group by partner_id")
      .all<{ partner_id: string; n: number }>(),
    c.db.prepare("select rowid as seq, * from partner_events order by rowid desc limit 100").all<EventRow>(),
  ]);
  return {
    partners: partners.results.map(
      (p): Partner => ({
        id: p.id,
        name: p.name,
        contactEmail: p.contact_email,
        contactPhone: p.contact_phone,
        isActive: !!p.is_active,
        webhookUrl: p.webhook_url,
        webhookSecret: p.webhook_secret,
        sharePickupCode: !!p.share_pickup_code,
        createdAt: p.created_at,
        keys: keys.results.filter((k) => k.partner_id === p.id).map(toKey),
        parcels30d: stats.results.find((s) => s.partner_id === p.id)?.n ?? 0,
        amount30d: stats.results.find((s) => s.partner_id === p.id)?.amount ?? 0,
        openBookings: open.results.find((s) => s.partner_id === p.id)?.n ?? 0,
      }),
    ),
    events: events.results.map(toEventLog),
  };
}

export async function savePartner(c: ParcelCtx, id: string | null, input: PartnerInput): Promise<{ id: string }> {
  const admin = await c.requireAdmin();
  const name = String(input?.name ?? "").trim().slice(0, 80);
  if (!name) throw new ApiError("bad_request");
  const contactPhone = normalizeTogoPhone(String(input?.contactPhone ?? ""));
  if (!contactPhone) throw new ApiError("phone_not_allowed");
  const contactEmail = String(input?.contactEmail ?? "").trim().slice(0, 120) || null;
  if (contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail)) throw new ApiError("invalid_contact");
  const webhookUrl = String(input?.webhookUrl ?? "").trim() || null;
  if (webhookUrl && !validWebhookUrl(webhookUrl)) throw new ApiError("invalid_webhook");
  const after = {
    name,
    contact_email: contactEmail,
    contact_phone: contactPhone,
    is_active: input?.isActive ? 1 : 0,
    webhook_url: webhookUrl,
    share_pickup_code: input?.sharePickupCode ? 1 : 0,
  };
  const now = nowIso();
  if (!id) {
    const newId = uuid();
    await c.db.batch([
      c.db
        .prepare(
          `insert into partners (id, name, contact_email, contact_phone, is_active, webhook_url, webhook_secret, share_pickup_code, created_by, created_at, updated_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(newId, name, contactEmail, contactPhone, after.is_active, webhookUrl, newWebhookSecret(), after.share_pickup_code, admin.id, now, now),
      c.audit(admin.id, "partners", "insert", newId, after),
    ]);
    return { id: newId };
  }
  const before = await c.db.prepare("select * from partners where id = ?").bind(id).first<PartnerRow>();
  if (!before) throw new ApiError("not_found", 404);
  const changes: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(after)) if ((before as unknown as Record<string, unknown>)[k] !== v) changes[k] = [(before as unknown as Record<string, unknown>)[k], v];
  await c.db.batch([
    c.db
      .prepare(
        "update partners set name = ?, contact_email = ?, contact_phone = ?, is_active = ?, webhook_url = ?, share_pickup_code = ?, updated_at = ? where id = ?",
      )
      .bind(name, contactEmail, contactPhone, after.is_active, webhookUrl, after.share_pickup_code, now, id),
    c.audit(admin.id, "partners", "update", id, changes),
  ]);
  return { id };
}

/** A new API key; the full key is returned only here. */
export async function createPartnerKey(c: ParcelCtx, partnerId: string, label: string): Promise<PartnerKey & { key: string }> {
  const admin = await c.requireAdmin();
  if (!(await c.db.prepare("select 1 from partners where id = ?").bind(partnerId).first())) throw new ApiError("not_found", 404);
  const key = newApiKey();
  const row: KeyRow = {
    id: uuid(),
    partner_id: partnerId,
    label: String(label ?? "").trim().slice(0, 60),
    prefix: keyPrefix(key),
    created_at: nowIso(),
    last_used_at: null,
    revoked_at: null,
  };
  await c.db.batch([
    c.db
      .prepare("insert into partner_api_keys (id, partner_id, label, prefix, key_hash, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?)")
      .bind(row.id, partnerId, row.label, row.prefix, await sha256(key), admin.id, row.created_at),
    c.audit(admin.id, "partner_api_keys", "insert", row.id, { partner_id: partnerId, label: row.label, prefix: row.prefix }),
  ]);
  return { ...toKey(row), key };
}

export async function revokePartnerKey(c: ParcelCtx, partnerId: string, keyId: string) {
  const admin = await c.requireAdmin();
  const res = await c.db
    .prepare("update partner_api_keys set revoked_at = ? where id = ? and partner_id = ? and revoked_at is null")
    .bind(nowIso(), keyId, partnerId)
    .run();
  if (!res.meta.changes) throw new ApiError("not_found", 404);
  await c.audit(admin.id, "partner_api_keys", "update", keyId, { revoked: [false, true], partner_id: partnerId }).run();
}

export async function rotatePartnerSecret(c: ParcelCtx, partnerId: string): Promise<{ secret: string }> {
  const admin = await c.requireAdmin();
  if (!(await c.db.prepare("select 1 from partners where id = ?").bind(partnerId).first())) throw new ApiError("not_found", 404);
  const secret = await rotateSecret(c.db, partnerId);
  await c.audit(admin.id, "partners", "update", partnerId, { webhook_secret: "rotated" }).run();
  return { secret };
}

/** Sends a webhook message again on the next run. */
export async function retryPartnerEvent(c: ParcelCtx, eventIdValue: string) {
  await c.requireAdmin();
  const res = await c.db
    .prepare("update partner_events set next_attempt_at = ?, attempts = 0 where id = ?")
    .bind(nowIso(), eventIdValue)
    .run();
  if (!res.meta.changes) throw new ApiError("not_found", 404);
}
