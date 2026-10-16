import type { DeliveryJob, DriverSettings, FleetVehicleType, JobStatus } from "./drivers";
import { distanceMeters, type LatLng } from "./geo";

/**
 * Merchants ("Marchand / Commerçant", plan planung/marchand.md): a shop account that only
 * books deliveries and rides. It registers itself (/marchand/inscription) and waits for an
 * admin, like a fleet. The merchant is the shop's first employee and invites employees by
 * phone number; each has their own login and books for the shop. Only the merchant (the
 * owner) has the backoffice on /marchand. A shop has favorite drivers (offered its trips
 * first) and assigned drivers, who work only for the shop while checked in there.
 * Merchant accounts are never customers (R11): no wallet, greenpoints or reservations.
 */

/** pending: registered, waiting for an admin. suspended: an approved shop an admin stopped. */
export type MerchantStatus = "pending" | "approved" | "rejected" | "suspended";
/** standard: up to STANDARD_EMPLOYEE_LIMIT employees, no statistics. unlocked: set by an admin. */
export type MerchantTier = "standard" | "unlocked";
export const MERCHANT_TIERS: MerchantTier[] = ["standard", "unlocked"];

/** Employees of a standard shop besides the merchant, counting open invites (decision B). */
export const STANDARD_EMPLOYEE_LIMIT = 3;
/** An invite runs out after this many days. */
export const MERCHANT_INVITE_DAYS = 7;
export const MERCHANT_NAME_MIN = 2;
export const MERCHANT_NAME_MAX = 80;
export const MERCHANT_ADDRESS_MAX = 200;
/** A driver checks in only this close to the shop (decision 12). */
export const CHECKIN_RADIUS_M = 500;
/** A new shop trip goes to the shop's favorites first, for at most this long in total. */
export const FAVORITE_ROUND_MINUTES = 5;
/** Highest hourly rate a shop can offer, in FCFA. */
export const MAX_HOURLY_RATE_FCFA = 100_000;

export function employeeLimit(tier: MerchantTier): number | null {
  return tier === "unlocked" ? null : STANDARD_EMPLOYEE_LIMIT;
}

/** Whether one more invite fits, with `used` = employees (owner not counted) plus open invites. */
export function canInviteMore(tier: MerchantTier, used: number): boolean {
  const limit = employeeLimit(tier);
  return limit === null || used < limit;
}

/** The shop name as stored, or null when it is too short or too long. */
export function cleanMerchantName(input: unknown): string | null {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  return name.length >= MERCHANT_NAME_MIN && name.length <= MERCHANT_NAME_MAX ? name : null;
}

/** What the shop registers with besides the login. */
export interface MerchantShopInput {
  name: string;
  /** The shop's phone number (Togo). */
  phone: string;
  address: string;
  lat: number;
  lng: number;
}

/** The shop, as its members and the admin see it. */
export interface MerchantInfo {
  id: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
  status: MerchantStatus;
  tier: MerchantTier;
  /** From the tier; null = no limit. */
  employeeLimit: number | null;
  /** Employees (not the merchant) plus open invites. */
  used: number;
  ownerId: string;
  createdAt: string;
}

export interface MerchantMember {
  userId: string;
  fullName: string | null;
  phone: string | null;
  email: string | null;
  isOwner: boolean;
  since: string;
}

export type MerchantInviteStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

export interface MerchantInvite {
  id: string;
  phone: string;
  status: MerchantInviteStatus;
  /** The code to pass on; the link is /marchand?invitation=<token>. */
  token: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

/** An open invite as the invited person sees it. */
export interface MyMerchantInvite {
  token: string;
  merchantName: string;
  expiresAt: string;
}

export type MerchantDriverKind = "favorite" | "assigned";
/** pending: waits for the driver, their fleet manager or an admin (decision 9). */
export type MerchantDriverStatus = "pending" | "active" | "declined" | "ended";
/** per_trip: the usual share of each fare. hourly: the shop pays the checked-in hours, the fares go to us (decision A). */
export type MerchantPayMode = "per_trip" | "hourly";
export const MERCHANT_PAY_MODES: MerchantPayMode[] = ["per_trip", "hourly"];
/** Who approved an assignment. */
export type MerchantApprover = "driver" | "fleet_manager" | "admin";
/** Who ended a check-in; auto = the end of the day. */
export type CheckoutBy = "driver" | "merchant" | "admin" | "auto";

/** A favorite or assigned driver of a shop. */
export interface MerchantDriver {
  id: string;
  merchantId: string;
  driverId: string;
  driverName: string;
  driverPhone: string | null;
  vehicle: { type: FleetVehicleType; plate: string } | null;
  kind: MerchantDriverKind;
  status: MerchantDriverStatus;
  payMode: MerchantPayMode | null;
  ratePerHourFcfa: number | null;
  createdAt: string;
  approvedAt: string | null;
  approvedAs: MerchantApprover | null;
  endedAt: string | null;
  /** Assigned drivers: checked in at this shop now (since when). */
  checkedInSince: string | null;
}

/** One check-in of a driver at a shop. */
export interface MerchantCheckin {
  id: string;
  merchantId: string;
  merchantName: string;
  driverId: string;
  driverName: string;
  payMode: MerchantPayMode;
  ratePerHourFcfa: number | null;
  inAt: string;
  outAt: string | null;
  outBy: CheckoutBy | null;
  /** Hourly: what the shop owes for this check-in, once it ended. */
  amountFcfa: number | null;
  /** Hourly: when the driver confirmed they got the money. */
  receivedAt: string | null;
}

/** Inputs of the shop's backoffice for a driver. */
export interface MerchantDriverInput {
  kind: MerchantDriverKind;
  /** The driver's code (under their QR code) or phone number. */
  driver: string;
  payMode?: MerchantPayMode;
  ratePerHourFcfa?: number | null;
}

/** A trip of the shop, with who booked it. */
export interface MerchantJob extends DeliveryJob {
  bookedBy: { userId: string; name: string | null } | null;
}

/** Counts of today's trips (Lomé is on UTC). */
export interface MerchantToday {
  booked: number;
  running: number;
  done: number;
  failed: number;
  cancelled: number;
}

export interface MerchantView {
  merchant: MerchantInfo;
  /** The signed-in member is the merchant (backoffice) or an employee. */
  isOwner: boolean;
  /** The shop's trips under way or waiting for a driver, newest first. */
  live: MerchantJob[];
  today: MerchantToday;
  /** Owner (and admin) only; empty for employees. */
  members: MerchantMember[];
  invites: MerchantInvite[];
  drivers: MerchantDriver[];
  /** Drivers checked in at the shop now. */
  checkins: MerchantCheckin[];
  /** Hourly check-ins the driver has not confirmed as paid yet. */
  unpaid: MerchantCheckin[];
  settings: DriverSettings;
}

/** Filters of the bookings log. */
export interface MerchantBookingsQuery {
  from: string;
  to: string;
  status?: JobStatus | "";
  bookedBy?: string;
}

/** One line of the shop's activity log. */
export interface MerchantActivity {
  id: number;
  at: string;
  actorName: string | null;
  table: string;
  action: string;
  changes: Record<string, unknown>;
}

/** Backoffice: one shop with its people and drivers. */
export interface AdminMerchant extends MerchantInfo {
  /** The merchant's phone number or e-mail address. */
  contact: string | null;
  reviewedAt: string | null;
  members: MerchantMember[];
  invites: MerchantInvite[];
  drivers: MerchantDriver[];
}

export type MerchantDecision = "approve" | "reject" | "suspend" | "reactivate";

/** An assignment waiting for the signed-in driver, their fleet manager or an admin. */
export interface MerchantAssignmentRequest {
  id: string;
  merchantId: string;
  merchantName: string;
  merchantAddress: string;
  driverId: string;
  driverName: string;
  payMode: MerchantPayMode;
  ratePerHourFcfa: number | null;
  createdAt: string;
}

/** The driver's shops: assignments, favorites, the check-in and hourly money to confirm. */
export interface DriverShops {
  assignments: (MerchantDriver & { merchantName: string; merchantAddress: string; merchantLat: number; merchantLng: number })[];
  favoriteOf: { merchantId: string; merchantName: string }[];
  checkin: MerchantCheckin | null;
  /** Hourly check-ins the shop still has to pay (the driver confirms on receipt). */
  unpaid: MerchantCheckin[];
}

/** Menu and rights follow the role. */
export function isMerchantAccount(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "merchant";
}

/** A rate in whole FCFA, or null when it is not valid for the mode. */
export function cleanRate(mode: MerchantPayMode, rate: unknown): number | null | undefined {
  if (mode === "per_trip") return null;
  const n = Number(rate);
  return Number.isInteger(n) && n > 0 && n <= MAX_HOURLY_RATE_FCFA ? n : undefined;
}

/** What the shop owes for an hourly check-in: the hours times the rate, rounded to 5 FCFA. */
export function hourlyAmount(inAt: string, outAt: string, ratePerHourFcfa: number): number {
  const ms = Math.max(0, new Date(outAt).getTime() - new Date(inAt).getTime());
  return Math.round(((ms / 3_600_000) * ratePerHourFcfa) / 5) * 5;
}

/** The last moment of the day of `at` (UTC, which is Lomé's time): forgotten check-outs end there. */
export function endOfDay(at: string): string {
  const d = new Date(at);
  d.setUTCHours(23, 59, 59, 999);
  return d.toISOString();
}

/** Whether a driver at `position` is close enough to the shop to check in. */
export function nearShop(position: LatLng, shop: LatLng, radius = CHECKIN_RADIUS_M): boolean {
  return distanceMeters(position, shop) <= radius;
}
