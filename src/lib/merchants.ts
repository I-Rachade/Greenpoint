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
  /** Saved pickup addresses (every member, to book). */
  addresses: MerchantAddress[];
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

// Phase 2 ---------------------------------------------------------------------------

/** Saved pickup addresses of a shop, besides its own address (0036_merchant_addresses.sql). */
export const MAX_MERCHANT_ADDRESSES = 10;
export const ADDRESS_LABEL_MIN = 2;
export const ADDRESS_LABEL_MAX = 40;

export interface MerchantAddressInput {
  /** A short name, such as "Entrepôt" or "Marché de Bè". */
  label: string;
  address: string;
  /** The number the driver calls there (Togo). */
  phone: string;
  lat: number;
  lng: number;
}

export interface MerchantAddress extends MerchantAddressInput {
  id: string;
  createdAt: string;
}

/** The label as stored, or null when it is too short or too long. */
export function cleanAddressLabel(input: unknown): string | null {
  const label = String(input ?? "").trim().replace(/\s+/g, " ");
  return label.length >= ADDRESS_LABEL_MIN && label.length <= ADDRESS_LABEL_MAX ? label : null;
}

/** Statistics are for unlocked shops only (decision 5). */
export function hasStatistics(tier: MerchantTier): boolean {
  return tier === "unlocked";
}

export type StatsGroup = "day" | "week" | "month";
export const STATS_GROUPS: StatsGroup[] = ["day", "week", "month"];
/** The longest period the statistics cover, in days. */
export const STATS_MAX_DAYS = 366;

export interface MerchantStatsQuery {
  /** YYYY-MM-DD, both included. */
  from: string;
  to: string;
  group: StatsGroup;
}

/** What the statistics need of one trip of the shop. */
export interface StatsTrip {
  status: JobStatus;
  fareFcfa: number;
  createdAt: string;
  pickedUpAt: string | null;
  doneAt: string | null;
  bookedBy: { userId: string; name: string | null } | null;
  driverId: string | null;
}

/** What the statistics need of one ended check-in at the shop. */
export interface StatsCheckin {
  driverId: string;
  driverName: string;
  payMode: MerchantPayMode;
  inAt: string;
  outAt: string;
  amountFcfa: number | null;
}

export interface StatsCounts {
  booked: number;
  done: number;
  failed: number;
  cancelled: number;
  /** Fares of the trips the shop paid: done, or failed after the driver took the parcel. */
  spendFcfa: number;
}

export interface MerchantStats {
  from: string;
  to: string;
  group: StatsGroup;
  totals: StatsCounts & {
    /** Done out of done and failed, 0 to 1; null without either. */
    successRate: number | null;
    /** Average minutes from booking to done; null without a done trip. */
    avgMinutes: number | null;
    /** Hourly pay of the assigned drivers, for the check-ins that ended in the period. */
    hourlyFcfa: number;
  };
  /** One entry per day, week (from Monday) or month of the period, oldest first. */
  periods: (StatsCounts & { key: string })[];
  /** Per member who booked, most bookings first. */
  employees: (StatsCounts & { userId: string; name: string | null })[];
  /** Per assigned driver who checked in during the period. */
  drivers: { driverId: string; name: string; checkins: number; hours: number; hourlyFcfa: number; trips: number }[];
}

/** The day, week (its Monday) or month an ISO time falls in. */
export function periodKey(at: string, group: StatsGroup): string {
  const day = at.slice(0, 10);
  if (group === "day") return day;
  if (group === "month") return day.slice(0, 7);
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Whether a query is valid: dates in order and at most STATS_MAX_DAYS days. */
export function validStatsQuery(q: Partial<MerchantStatsQuery> | null | undefined): q is MerchantStatsQuery {
  const date = /^\d{4}-\d{2}-\d{2}$/;
  if (!q || !date.test(String(q.from)) || !date.test(String(q.to)) || !STATS_GROUPS.includes(q.group as StatsGroup)) return false;
  const days = (Date.parse(`${q.to}T00:00:00Z`) - Date.parse(`${q.from}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days >= 0 && days < STATS_MAX_DAYS;
}

function emptyCounts(): StatsCounts {
  return { booked: 0, done: 0, failed: 0, cancelled: 0, spendFcfa: 0 };
}

function count(c: StatsCounts, t: StatsTrip) {
  c.booked += 1;
  if (t.status === "done") c.done += 1;
  else if (t.status === "failed") c.failed += 1;
  else if (t.status === "cancelled") c.cancelled += 1;
  if (t.status === "done" || (t.status === "failed" && t.pickedUpAt)) c.spendFcfa += t.fareFcfa;
}

/** The shop's statistics for trips booked in the period and check-ins that ended in it. */
export function merchantStats(q: MerchantStatsQuery, trips: StatsTrip[], checkins: StatsCheckin[]): MerchantStats {
  const totals = emptyCounts();
  const periods = new Map<string, StatsCounts>();
  // Every period of the range, also those without a trip.
  for (let d = new Date(`${q.from}T00:00:00.000Z`); d.toISOString().slice(0, 10) <= q.to; d.setUTCDate(d.getUTCDate() + 1)) {
    const key = periodKey(d.toISOString(), q.group);
    if (!periods.has(key)) periods.set(key, emptyCounts());
  }
  const employees = new Map<string, StatsCounts & { userId: string; name: string | null }>();
  const tripsByDriver = new Map<string, number>();
  let minutes = 0;
  for (const t of trips) {
    count(totals, t);
    const key = periodKey(t.createdAt, q.group);
    if (!periods.has(key)) periods.set(key, emptyCounts());
    count(periods.get(key)!, t);
    if (t.bookedBy) {
      const e = employees.get(t.bookedBy.userId) ?? { userId: t.bookedBy.userId, name: t.bookedBy.name, ...emptyCounts() };
      count(e, t);
      employees.set(t.bookedBy.userId, e);
    }
    if (t.status === "done" && t.doneAt) {
      minutes += Math.max(0, Date.parse(t.doneAt) - Date.parse(t.createdAt)) / 60_000;
      if (t.driverId) tripsByDriver.set(t.driverId, (tripsByDriver.get(t.driverId) ?? 0) + 1);
    }
  }
  const drivers = new Map<string, MerchantStats["drivers"][number]>();
  let hourlyFcfa = 0;
  for (const k of checkins) {
    const d = drivers.get(k.driverId) ?? { driverId: k.driverId, name: k.driverName, checkins: 0, hours: 0, hourlyFcfa: 0, trips: tripsByDriver.get(k.driverId) ?? 0 };
    d.checkins += 1;
    d.hours += Math.max(0, Date.parse(k.outAt) - Date.parse(k.inAt)) / 3_600_000;
    if (k.payMode === "hourly") d.hourlyFcfa += k.amountFcfa ?? 0;
    hourlyFcfa += k.payMode === "hourly" ? (k.amountFcfa ?? 0) : 0;
    drivers.set(k.driverId, d);
  }
  const ended = totals.done + totals.failed;
  return {
    from: q.from,
    to: q.to,
    group: q.group,
    totals: {
      ...totals,
      successRate: ended ? totals.done / ended : null,
      avgMinutes: totals.done ? Math.round(minutes / totals.done) : null,
      hourlyFcfa,
    },
    periods: [...periods.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, c]) => ({ key, ...c })),
    employees: [...employees.values()].sort((a, b) => b.booked - a.booked),
    drivers: [...drivers.values()].map((d) => ({ ...d, hours: Math.round(d.hours * 10) / 10 })).sort((a, b) => b.hours - a.hours),
  };
}
