// Merchant rules the driver code needs too (bookings, dispatch, pay), kept apart from
// worker/merchants.ts so worker/drivers.ts can use them without an import cycle.
// Plan in planung/marchand.md, tables in 0035_merchants.sql.
import { inServiceArea, validPoint } from "../src/lib/drivers";
import {
  cleanMerchantName,
  endOfDay,
  hourlyAmount,
  MERCHANT_ADDRESS_MAX,
  type CheckoutBy,
  type MerchantPayMode,
  type MerchantShopInput,
  type MerchantStatus,
  type MerchantTier,
} from "../src/lib/merchants";
import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile } from "../src/lib/types";
import { ApiError, nowIso } from "./http";
import type { ParcelCtx } from "./parcels";
import { refuseNonCustomer } from "./roles";

export interface MerchantRow {
  id: string;
  owner_id: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  status: MerchantStatus;
  tier: MerchantTier;
  created_at: string;
  reviewed_at: string | null;
}

export interface CheckinRow {
  id: string;
  merchant_id: string;
  driver_id: string;
  assignment_id: string;
  pay_mode: MerchantPayMode;
  rate_per_hour_fcfa: number | null;
  in_at: string;
  out_at: string | null;
  out_by: string | null;
  out_actor: string | null;
  amount_fcfa: number | null;
  received_at: string | null;
}

export async function merchantRow(db: D1Database, id: string): Promise<MerchantRow | null> {
  return db.prepare("select * from merchants where id = ?").bind(id).first<MerchantRow>();
}

/** The shop the user belongs to, with whether they are its merchant. */
export async function membershipOf(db: D1Database, userId: string): Promise<{ shop: MerchantRow; isOwner: boolean } | null> {
  const row = await db
    .prepare("select m.*, mm.is_owner from merchant_members mm join merchants m on m.id = mm.merchant_id where mm.user_id = ?")
    .bind(userId)
    .first<MerchantRow & { is_owner: number }>();
  if (!row) return null;
  const { is_owner, ...shop } = row;
  return { shop, isOwner: !!is_owner };
}

/**
 * Who books a trip: a customer (null) or a member of an approved shop (the shop). Other
 * accounts answer 403 (R11); members of a shop not approved (yet) merchant_not_approved.
 */
export async function bookingShop(db: D1Database, user: Profile): Promise<MerchantRow | null> {
  if (user.role !== "merchant") {
    refuseNonCustomer(user);
    return null;
  }
  const member = await membershipOf(db, user.id);
  if (!member || member.shop.status !== "approved") throw new ApiError("merchant_not_approved", 403);
  return member.shop;
}

/** The driver's open check-in, if any. */
export async function openCheckin(db: D1Database, driverId: string): Promise<CheckinRow | null> {
  return db.prepare("select * from merchant_checkins where driver_id = ? and out_at is null").bind(driverId).first<CheckinRow>();
}

/**
 * Decision A: a shop trip driven while checked in there at an hourly rate earns the driver
 * no share of the fare (the shop pays the hours); the whole fare goes to us.
 */
export async function hourlyTrip(db: D1Database, job: { driver_id: string | null; merchant_id?: string | null; assigned_at: string | null }): Promise<boolean> {
  if (!job.merchant_id || !job.driver_id || !job.assigned_at) return false;
  const row = await db
    .prepare(
      `select 1 from merchant_checkins where driver_id = ?1 and merchant_id = ?2 and pay_mode = 'hourly'
       and in_at <= ?3 and (out_at is null or out_at >= ?3) limit 1`,
    )
    .bind(job.driver_id, job.merchant_id, job.assigned_at)
    .first();
  return !!row;
}

/** The shop's details as stored, checked (400 otherwise; phone_not_allowed, outside_area). */
export function cleanShop(input: Partial<MerchantShopInput> | null | undefined): MerchantShopInput {
  const name = cleanMerchantName(input?.name);
  if (!name) throw new ApiError("bad_request");
  const phone = normalizeTogoPhone(String(input?.phone ?? ""));
  if (!phone) throw new ApiError("phone_not_allowed");
  const address = String(input?.address ?? "").trim().replace(/\s+/g, " ");
  if (address.length < 2 || address.length > MERCHANT_ADDRESS_MAX) throw new ApiError("bad_request");
  const point = { lat: Number(input?.lat), lng: Number(input?.lng) };
  if (!validPoint(point)) throw new ApiError("bad_request");
  if (!inServiceArea(point)) throw new ApiError("outside_area");
  return { name, phone, address, lat: point.lat, lng: point.lng };
}

type AuditCtx = Pick<ParcelCtx, "db" | "audit">;

/**
 * Ends a check-in at `at` (an hourly one gets its amount: hours x rate). Guarded by
 * out_at is null, so two check-outs at once end it once.
 */
export function closeCheckin(c: AuditCtx, row: CheckinRow, by: CheckoutBy, actor: string | null, at = nowIso()): D1PreparedStatement[] {
  const amount = row.pay_mode === "hourly" && row.rate_per_hour_fcfa ? hourlyAmount(row.in_at, at, row.rate_per_hour_fcfa) : null;
  return [
    c.db
      .prepare("update merchant_checkins set out_at = ?, out_by = ?, out_actor = ?, amount_fcfa = ? where id = ? and out_at is null")
      .bind(at, by, actor, amount, row.id),
    c.audit(actor, "merchant_checkins", "update", row.id, { merchant_id: row.merchant_id, out_by: by, out_at: at, amount_fcfa: amount }, { userId: row.driver_id }),
  ];
}

/**
 * A driver still checked in after the end of the day is checked out at 23:59:59 (the
 * hours stop there), unless they are on a trip right now: then at the next run after it.
 */
export async function autoCheckouts(c: AuditCtx) {
  const today = `${nowIso().slice(0, 10)}T00:00:00.000Z`;
  const { results } = await c.db
    .prepare(
      `select * from merchant_checkins k where k.out_at is null and k.in_at < ?
       and not exists (select 1 from delivery_jobs j where j.driver_id = k.driver_id and j.status in ('assigned', 'accepted', 'picked_up', 'at_door', 'returning'))
       limit 50`,
    )
    .bind(today)
    .all<CheckinRow>();
  for (const row of results) await c.db.batch(closeCheckin(c, row, "auto", null, endOfDay(row.in_at)));
}
