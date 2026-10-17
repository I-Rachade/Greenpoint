import type { DeliveryJob, DriverApplication, DriverPosition, DriverSettings, DriverStatus, FleetVehicle } from "./drivers";

/**
 * Fleet managers (plan phase 6): an account of its own that registers itself
 * (/flotte/inscription) and waits for an admin. Once approved, the manager invites
 * drivers by phone number; the person confirms in the app and the account becomes a
 * driver account in the fleet (each driver has at most one manager). The manager sees
 * the drivers on /flotte, hands open trips to them ahead of the queue and follows the
 * battery swaps billed to the fleet. Statistics need the unlocked tier.
 * A fleet manager is never a customer (W5, R11).
 */

/** pending: registered, waiting for an admin; fleet functions are blocked until approved. */
export type FleetStatus = "pending" | "approved" | "rejected";
/** standard: up to STANDARD_DRIVER_LIMIT drivers, no statistics. unlocked: paid outside the app, set by an admin. */
export type FleetTier = "standard" | "unlocked";
export const FLEET_TIERS: FleetTier[] = ["standard", "unlocked"];

/** R13: drivers in a standard fleet, counting the invites still open. */
export const STANDARD_DRIVER_LIMIT = 3;
/** An invite runs out after this many days. */
export const FLEET_INVITE_DAYS = 7;
export const FLEET_NAME_MIN = 2;
export const FLEET_NAME_MAX = 80;

/** How many drivers the tier allows; null = no limit. */
export function driverLimit(tier: FleetTier): number | null {
  return tier === "unlocked" ? null : STANDARD_DRIVER_LIMIT;
}

/** R13: whether one more invite fits, with `used` = drivers plus open invites. */
export function canInviteMore(tier: FleetTier, used: number): boolean {
  const limit = driverLimit(tier);
  return limit === null || used < limit;
}

/** The fleet name as stored, or null when it is too short or too long. */
export function cleanFleetName(input: unknown): string | null {
  const name = String(input ?? "").trim().replace(/\s+/g, " ");
  return name.length >= FLEET_NAME_MIN && name.length <= FLEET_NAME_MAX ? name : null;
}

/** The manager's fleet (a fleet is the manager's account, one per manager). */
export interface FleetInfo {
  managerId: string;
  name: string;
  status: FleetStatus;
  tier: FleetTier;
  /** From the tier; null = no limit. */
  driverLimit: number | null;
  /** Drivers in the fleet plus open invites (R13). */
  used: number;
  createdAt: string;
}

export type FleetInviteStatus = "pending" | "accepted" | "declined" | "revoked" | "expired";

/** An invite as the manager (and the admin) sees it. */
export interface FleetInvite {
  id: string;
  phone: string;
  status: FleetInviteStatus;
  /** The code to pass on; the link is /chauffeur?invitation=<token>. */
  token: string;
  createdAt: string;
  expiresAt: string;
  decidedAt: string | null;
}

/** An open invite as the invited person sees it. */
export interface MyFleetInvite {
  token: string;
  fleetName: string;
  expiresAt: string;
  /** No driver application yet (or a refused one): accepting needs one. */
  needsApplication: boolean;
}

/** Accepting an invite: the driver application when the account has none yet. */
export interface FleetInviteAnswer {
  application?: DriverApplication;
}

/** What removing a driver did: released = the account went back to customer (R15). */
export interface FleetRemoval {
  released: boolean;
}

/** One battery swap at a counter with a driver's pass, billed to the fleet (W7, swap_log). */
export interface FleetSwap {
  id: string;
  at: string;
  stationId: string;
  stationName: string;
  driverId: string | null;
  driverName: string | null;
  batteryTypeId: string;
  amountXof: number;
}

/** The fleet's statement for a period: the swaps billed to it, with their amounts. */
export interface FleetStatement {
  from: string;
  to: string;
  swaps: FleetSwap[];
  totalXof: number;
}

/** Backoffice: one fleet with its drivers and invites. */
export interface AdminFleet extends FleetInfo {
  /** The manager's phone number or e-mail address. */
  contact: string | null;
  reviewedAt: string | null;
  drivers: { userId: string; fullName: string; status: DriverStatus }[];
  invites: FleetInvite[];
}

export type FleetDecision = "approve" | "reject";

/** Statistics: admins, and managers of an approved, unlocked fleet. */
export function statsUnlocked(role: string | undefined, fleet: Pick<FleetInfo, "status" | "tier"> | null): boolean {
  if (role === "admin") return true;
  return !!fleet && fleet.status === "approved" && fleet.tier === "unlocked";
}

/** Menu and rights follow the role, like the station pages (operators.ts). */
export function managesFleet(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "fleet_manager" || profile?.role === "admin";
}

/** One of the manager's drivers, without documents or QR code. */
export interface FleetDriver {
  userId: string;
  fullName: string;
  phone: string | null;
  status: DriverStatus;
  vehicle: FleetVehicle | null;
  /** Owed to us (positive) or to the driver (negative), in FCFA. */
  balanceFcfa: number;
  queue: { stationId: string; since: string; position: number } | null;
  /** The trip the driver is on or was offered. */
  job: DeliveryJob | null;
  /** Checked in at a shop (planung/marchand.md): which and since when. */
  shop?: { name: string; since: string } | null;
  /** Where the driver is while on duty, when reported recently (driver phase 2). */
  position?: DriverPosition | null;
}

export interface FleetView {
  /** The manager's fleet; null for an admin (who sees every driver). */
  fleet: FleetInfo | null;
  drivers: FleetDriver[];
  /** The fleet's invites, newest first (open ones and the last answered). */
  invites: FleetInvite[];
  /** Trips nobody has yet, oldest first; customers' contacts left out. */
  openJobs: DeliveryJob[];
  settings: DriverSettings;
}

/** What one driver did in a period. */
export interface FleetDriverStats {
  userId: string;
  tripsDone: number;
  /** Deliveries nobody took (parcel brought back). */
  tripsFailed: number;
  /** Fares of the finished trips: what the driver brought in. */
  fareFcfa: number;
  /** The driver's share of those fares. */
  earningFcfa: number;
  /** Cash taken from customers. */
  collectedFcfa: number;
  /** Cash handed in at stations (positive) or paid to the driver (negative). */
  settledFcfa: number;
  /** Charging at stations: battery swaps and charging slots used. */
  batterySwaps: number;
  chargingSlots: number;
  /** Paid through the app for those (Flooz, T-Money). */
  chargingPaidFcfa: number;
  /** Of the battery swaps: those at the counter with the driver's pass, billed to the fleet, and their amount. */
  fleetSwaps: number;
  fleetSwapsXof: number;
  /** Distance of the finished trips and the CO2 they saved (greenpoint ledger, W10). */
  distanceKm: number;
  co2Grams: number;
}

export interface FleetStats {
  /** Inclusive days, YYYY-MM-DD (Lomé is on UTC). */
  from: string;
  to: string;
  drivers: FleetDriverStats[];
}

/** Longest period the overview covers in one go. */
export const FLEET_MAX_DAYS = 366;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The period as ISO bounds [start, end), or null when it is not a valid range. */
export function fleetRange(from: string, to: string): { start: string; end: string } | null {
  if (!DAY.test(from) || !DAY.test(to)) return null;
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return null;
  end.setUTCDate(end.getUTCDate() + 1);
  if ((end.getTime() - start.getTime()) / 86_400_000 > FLEET_MAX_DAYS) return null;
  return { start: start.toISOString(), end: end.toISOString() };
}

/** What a manager may see of a trip: the route and the money, not the customer's contacts. */
export function jobForManager(job: DeliveryJob): DeliveryJob {
  return {
    ...job,
    home: job.home ? { ...job.home, phone: "" } : null,
    recipient: null,
    customerName: null,
    declaredValue: null,
    proofKey: null,
  };
}
