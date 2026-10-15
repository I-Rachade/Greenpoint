// Drivers: people who drive one of our vehicles and carry parcels express between
// stations, pick them up at a customer's home or deliver them there, and take
// customers themselves (rides) or a parcel (couriers) from one place to another.
// Shared by the app, the demo backend and the Worker. Plan: planung/fahrer.md.

import { distanceMeters, LOME_CENTER, type LatLng } from "./geo";
import { PARCEL_SIZES, type ParcelMeasures, type ParcelSize } from "./parcels";

/**
 * Our own vehicles; drivers never use their own. Moto: people or parcels, fast.
 * Tricycle: people (up to three) or parcels. Cargo tricycle: goods only.
 * Car: people (up to four) or parcels.
 */
export type FleetVehicleType = "moto" | "tricycle" | "cargo_tricycle" | "car";
export const FLEET_VEHICLE_TYPES: FleetVehicleType[] = ["moto", "tricycle", "cargo_tricycle", "car"];
/** What a customer can pick on the "Courses" tab to have a parcel carried. */
export type BookableVehicleType = "moto" | "cargo_tricycle";
export const BOOKABLE_VEHICLE_TYPES: BookableVehicleType[] = ["moto", "cargo_tricycle"];
/** The "Courses" pages, one per vehicle a customer can pick: /courses/moto, /courses/tricycle-bagage. */
export const VEHICLE_SLUGS: Record<string, BookableVehicleType> = { moto: "moto", "tricycle-bagage": "cargo_tricycle" };

export type DriverStatus =
  | "pending" // applied in the app, waiting for the admin
  | "active"
  | "rejected"
  | "suspended";

export type JobKind =
  | "express" // station A to station B, paid at the counter in A
  | "pickup" // a customer's home to station B, paid to the driver
  | "delivery" // station A to the recipient's home, paid to the driver at the door
  | "ride" // the customer themselves from point A to point B, paid to the driver on arrival
  | "courier"; // a parcel from the sender's door (A) straight to the recipient's door (B), paid to the driver at A

export type JobStatus =
  | "open" // no driver yet
  | "assigned" // offered to the first driver in line, waiting for "J'y vais"
  | "accepted" // the driver is on the way to the start
  | "picked_up" // the driver has the parcel (ride: the customer is on board)
  | "at_door" // delivery: the driver is at the recipient's
  | "returning" // delivery: nobody there, back to the station
  | "done"
  | "failed" // delivery: brought back to the station
  | "cancelled";

/** Where a home delivery stands, on the parcel (its status stays "arrived" until delivered). */
export type DeliveryStatus = "booked" | "out_for_delivery" | "delivered" | "failed";

/** What a vehicle type may carry on one trip. */
export interface VehicleLimit {
  type: FleetVehicleType;
  maxSize: ParcelSize;
  maxWeightKg: number;
}

/** Prices and rules, set in the backoffice. */
export interface DriverSettings {
  baseFcfa: number;
  /** Per started kilometre, straight line. */
  perKmFcfa: number;
  /** Added for express trips between stations. */
  expressFcfa: number;
  /** Share of the fare the driver earns, in percent. */
  driverSharePct: number;
  /** A driver who owes this much or more cannot queue until settled. */
  cashLimitFcfa: number;
  /** Minutes at the door before "nobody there" is allowed. */
  waitMinutes: number;
  /** Minutes a driver has to confirm an offered job. */
  acceptMinutes: number;
  /** How close to a station a driver must be to queue there, in metres; 0 = no check. */
  queueRadiusM: number;
  vehicles: VehicleLimit[];
}

/** Starting values (decided on 12/10/2026, planung/fahrer.md). */
export const DEFAULT_DRIVER_SETTINGS: DriverSettings = {
  baseFcfa: 500,
  perKmFcfa: 100,
  expressFcfa: 1000,
  driverSharePct: 55,
  cashLimitFcfa: 20_000,
  waitMinutes: 10,
  acceptMinutes: 5,
  queueRadiusM: 500,
  vehicles: [
    { type: "moto", maxSize: "M", maxWeightKg: 20 },
    { type: "tricycle", maxSize: "L", maxWeightKg: 50 },
    { type: "cargo_tricycle", maxSize: "XL", maxWeightKg: 300 },
    { type: "car", maxSize: "L", maxWeightKg: 100 },
  ],
};

/** Seats for customers on each vehicle type (the driver not counted). */
export const RIDE_SEATS: Record<FleetVehicleType, number> = { moto: 1, tricycle: 3, cargo_tricycle: 0, car: 4 };
/** Most passengers one ride can book. */
export const MAX_PASSENGERS = Math.max(...Object.values(RIDE_SEATS));

/** True when a vehicle of this type has a seat for every passenger. */
export function vehicleSeats(type: FleetVehicleType, passengers: number): boolean {
  return passengers >= 1 && RIDE_SEATS[type] >= passengers;
}

/** Pickups, deliveries and rides only within this distance of the centre of Lomé. */
export const SERVICE_RADIUS_KM = 25;

export function inServiceArea(p: LatLng): boolean {
  return distanceMeters(p, LOME_CENTER) <= SERVICE_RADIUS_KM * 1000;
}

export function validPoint(p: unknown): p is LatLng {
  const q = p as LatLng | null;
  return (
    !!q &&
    typeof q.lat === "number" &&
    typeof q.lng === "number" &&
    Number.isFinite(q.lat) &&
    Number.isFinite(q.lng) &&
    Math.abs(q.lat) <= 90 &&
    Math.abs(q.lng) <= 180
  );
}

/** The fare: base price plus every started kilometre, plus the express surcharge between stations. */
export function fareFor(meters: number, express: boolean, s: DriverSettings): number {
  const km = Math.max(1, Math.ceil(meters / 1000));
  return s.baseFcfa + km * s.perKmFcfa + (express ? s.expressFcfa : 0);
}

/** What the driver earns for a trip, in whole francs. */
export function driverEarning(fareFcfa: number, s: Pick<DriverSettings, "driverSharePct">): number {
  return Math.floor((fareFcfa * s.driverSharePct) / 100);
}

/** True when a vehicle of this type may carry a parcel of this size and weight. */
export function vehicleFits(type: FleetVehicleType, size: ParcelSize, weightKg: number, s: DriverSettings): boolean {
  const limit = s.vehicles.find((v) => v.type === type);
  if (!limit) return false;
  return PARCEL_SIZES.indexOf(size) <= PARCEL_SIZES.indexOf(limit.maxSize) && weightKg <= limit.maxWeightKg;
}

/**
 * True when a vehicle of this type can take the trip: the type the customer
 * picked, if any, and seats for rides, size and weight otherwise.
 */
export function jobFits(
  job: { kind: JobKind; vehicleType: FleetVehicleType | null; passengers: number | null; size: ParcelSize },
  type: FleetVehicleType,
  weightKg: number,
  s: DriverSettings,
): boolean {
  if (job.vehicleType && type !== job.vehicleType) return false;
  if (job.kind === "ride") return vehicleSeats(type, job.passengers ?? 1);
  return vehicleFits(type, job.size, weightKg, s);
}

/**
 * Settings saved before a vehicle type existed lack its limits: they get the
 * default ones, so saved prices are kept.
 */
export function withAllVehicles(s: DriverSettings): DriverSettings {
  if (!s || !Array.isArray(s.vehicles)) return s;
  const missing = DEFAULT_DRIVER_SETTINGS.vehicles.filter((d) => !s.vehicles.some((v) => v?.type === d.type));
  return missing.length ? { ...s, vehicles: [...s.vehicles, ...missing] } : s;
}

export function validSettings(s: DriverSettings): boolean {
  const int = (v: unknown, min: number, max: number) => Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
  return (
    !!s &&
    int(s.baseFcfa, 0, 1_000_000) &&
    int(s.perKmFcfa, 0, 100_000) &&
    int(s.expressFcfa, 0, 1_000_000) &&
    int(s.driverSharePct, 0, 100) &&
    int(s.cashLimitFcfa, 0, 10_000_000) &&
    int(s.waitMinutes, 0, 120) &&
    int(s.acceptMinutes, 1, 120) &&
    int(s.queueRadiusM, 0, 50_000) &&
    Array.isArray(s.vehicles) &&
    FLEET_VEHICLE_TYPES.every((type) => {
      const v = s.vehicles.find((x) => x.type === type);
      return !!v && PARCEL_SIZES.includes(v.maxSize) && typeof v.maxWeightKg === "number" && v.maxWeightKg > 0 && v.maxWeightKg <= 1000;
    })
  );
}

/** One driver waiting at a station. */
export interface QueueEntry {
  driverId: string;
  stationId: string;
  vehicleType: FleetVehicleType;
  /** ISO time the driver joined; earlier is first in line. */
  since: string;
}

/**
 * The driver who gets a job: stations are tried from the one nearest the start
 * of the job, and at each the first in line whose vehicle fits wins.
 */
export function pickDriver(
  start: LatLng,
  queue: QueueEntry[],
  stations: { id: string; lat: number; lng: number }[],
  fits: (type: FleetVehicleType) => boolean,
): QueueEntry | null {
  const byDistance = stations
    .map((s) => ({ id: s.id, d: distanceMeters(start, s) }))
    .sort((a, b) => a.d - b.d);
  for (const station of byDistance) {
    const first = queue
      .filter((q) => q.stationId === station.id && fits(q.vehicleType))
      .sort((a, b) => a.since.localeCompare(b.since))[0];
    if (first) return first;
  }
  return null;
}

/** The station nearest a point, or null when there is none. */
export function nearestStation<T extends LatLng>(p: LatLng, stations: T[]): T | null {
  let best: T | null = null;
  let bestD = Infinity;
  for (const s of stations) {
    const d = distanceMeters(p, s);
    if (d < bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/** Letters and digits without look-alikes, for the code under the driver's QR code. */
const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const BADGE_PREFIX = "POINDERECHARGE-CHAUFFEUR";

export function newDriverCode(random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  return [...random(8)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

/** What the driver's QR code holds. Staff scan it to hand over or receive parcels and to settle. */
export function driverBadgePayload(code: string): string {
  return `${BADGE_PREFIX}:${code}`;
}

/** Reads a scanned driver QR code (also the signed pass below) or a typed driver code. */
export function parseDriverBadge(input: string): string | null {
  const text = input.trim().toUpperCase();
  const body = text.startsWith(`${BADGE_PREFIX}:`) ? text.slice(BADGE_PREFIX.length + 1).split(":")[0] : text.replace(/[\s-]/g, "");
  return new RegExp(`^[${CODE_ALPHABET}]{8}$`).test(body) ? body : null;
}

// Driver pass ------------------------------------------------------------------------
//
// The QR code the driver shows at a station is signed by the server and runs out after
// DRIVER_PASS_MINUTES (plan phase 5, F10, R10): staff can still hand over parcels with
// it or with the typed code, but a battery swap billed to a fleet needs a pass that is
// genuine, not expired, of an active driver and of the fleet the driver belongs to now.
// Format: POINDERECHARGE-CHAUFFEUR:<code>:<fleet>:<expires>:<signature>
//   fleet      the first 8 characters of the fleet manager's id (0 without a fleet)
//   expires    Unix seconds in base 36
//   signature  HMAC-SHA256 over "<code>:<fleet>:<expires>", first 16 hex digits

/** How long a driver pass is valid; the app fetches a new one before it runs out. */
export const DRIVER_PASS_MINUTES = 10;

export interface DriverPass {
  /** What the QR code holds. */
  payload: string;
  expiresAt: string;
}

/** The fleet part of a pass: who the swap would be billed to. */
export function fleetTag(managerId: string | null): string {
  return managerId ? managerId.replace(/-/g, "").slice(0, 8).toUpperCase() : "0";
}

async function passSignature(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)));
  return [...mac.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export async function signDriverPass(secret: string, code: string, managerId: string | null, now = Date.now()): Promise<DriverPass> {
  const expires = Math.floor(now / 1000) + DRIVER_PASS_MINUTES * 60;
  const body = `${code}:${fleetTag(managerId)}:${expires.toString(36).toUpperCase()}`;
  return { payload: `${BADGE_PREFIX}:${body}:${await passSignature(secret, body)}`, expiresAt: new Date(expires * 1000).toISOString() };
}

export type DriverPassCheck =
  | { ok: true; code: string; fleet: string }
  | { ok: false; error: "driver_pass_invalid" | "driver_pass_expired" };

/** Checks a scanned pass: signature first, then the time. The caller checks driver and fleet. */
export async function checkDriverPass(secret: string, input: string, now = Date.now()): Promise<DriverPassCheck> {
  const text = input.trim().toUpperCase();
  const parts = text.startsWith(`${BADGE_PREFIX}:`) ? text.slice(BADGE_PREFIX.length + 1).split(":") : [];
  if (parts.length !== 4) return { ok: false, error: "driver_pass_invalid" };
  const [code, fleet, expires, signature] = parts;
  if (!new RegExp(`^[${CODE_ALPHABET}]{8}$`).test(code) || !/^[0-9A-Z]{1,8}$/.test(fleet) || !/^[0-9A-Z]{1,10}$/.test(expires)) {
    return { ok: false, error: "driver_pass_invalid" };
  }
  if ((await passSignature(secret, `${code}:${fleet}:${expires}`)) !== signature) return { ok: false, error: "driver_pass_invalid" };
  if (parseInt(expires, 36) * 1000 <= now) return { ok: false, error: "driver_pass_expired" };
  return { ok: true, code, fleet };
}

/** Driver accounts (role 'driver', plan phase 5): never customers, their home is /chauffeur. */
export function isDriverAccount(profile: { role: string } | null | undefined): boolean {
  return profile?.role === "driver";
}

/** Open trips nobody took: home trips booked by customers are called off after this long. */
export const OPEN_JOB_EXPIRY_MINUTES = 30;

export interface FleetVehicle {
  id: string;
  type: FleetVehicleType;
  plate: string;
  isActive: boolean;
}

export interface FleetVehicleInput {
  type: FleetVehicleType;
  plate: string;
  isActive: boolean;
}

export type DriverDocument = "id" | "license" | "portrait";
export const DRIVER_DOCUMENTS: DriverDocument[] = ["id", "license", "portrait"];

export interface Driver {
  userId: string;
  status: DriverStatus;
  fullName: string;
  phone: string | null;
  idNumber: string;
  licenseNumber: string;
  /** The kind of vehicle the driver asked to drive. */
  wantedType: FleetVehicleType;
  vehicle: FleetVehicle | null;
  /** Storage keys of the uploaded documents; read them with `driverFileUrl`. */
  documents: Partial<Record<DriverDocument, string>>;
  /** The code under the QR code; only for the driver and admins. */
  code?: string;
  createdAt: string;
  reviewedAt: string | null;
  /** Owed to us (positive) or to the driver (negative), in FCFA. */
  balanceFcfa: number;
  lastSettledAt: string | null;
  /** Where the driver waits, if anywhere. */
  queue: { stationId: string; since: string; position: number } | null;
  /** Backoffice: the fleet manager the driver belongs to (src/lib/fleet.ts). */
  manager?: { userId: string; label: string } | null;
}

export interface DriverApplication {
  fullName: string;
  idNumber: string;
  licenseNumber: string;
  wantedType: FleetVehicleType;
}

/** A home address: a pin on the map, a description and a phone number. */
export interface HomePoint extends LatLng {
  note: string;
  phone: string;
}

/** Where a ride or courier ends: a pin on the map and a description. */
export interface DropoffPoint extends LatLng {
  note: string;
}

/** The driver, as the customer and staff see them. */
export interface JobDriver {
  name: string;
  phone: string | null;
  plate: string | null;
  vehicleType: FleetVehicleType | null;
}

export interface DeliveryJob {
  id: string;
  kind: JobKind;
  status: JobStatus;
  /** Null for a pickup until the driver has collected the parcel. */
  parcelId: string | null;
  trackingNo: string | null;
  /** Start station (express, delivery). */
  fromStationId: string | null;
  /** Destination station (express, pickup). */
  toStationId: string | null;
  /** The customer's home: start of a pickup, end of a delivery. Rides: where the customer gets on. Couriers: the sender's door. */
  home: HomePoint | null;
  /** Rides: where the customer gets off. Couriers: the recipient's door. */
  dropoff: DropoffPoint | null;
  /** Rides: how many people travel. */
  passengers: number | null;
  /** Rides: the kind of vehicle the customer asked for (null: any). */
  vehicleType: FleetVehicleType | null;
  /** Booked size (pickup) or the parcel's size. */
  size: ParcelSize;
  weightKg: number | null;
  content: string;
  distanceM: number;
  fareFcfa: number;
  /** Cash the driver collects from the customer (0 for express). */
  collectFcfa: number;
  /** Pickup bookings: who gets the parcel at station B. Couriers: who gets it at the door. */
  recipient: { phone: string; name: string | null } | null;
  declaredValue: number | null;
  driver: JobDriver | null;
  /** The customer's name, for the driver. */
  customerName: string | null;
  createdAt: string;
  assignedAt: string | null;
  acceptedAt: string | null;
  pickedUpAt: string | null;
  atDoorAt: string | null;
  doneAt: string | null;
  /** Storage key of the photo taken at the door. */
  proofKey: string | null;
  /** Called off because no driver took it in time (OPEN_JOB_EXPIRY_MINUTES). */
  noDriver?: boolean;
}

export interface PickupBooking {
  home: HomePoint;
  toStationId: string;
  recipientPhone: string;
  recipientName?: string;
  content: string;
  size: ParcelSize;
  declaredValue?: number | null;
}

/** A customer books a driver to take them from A to B. */
export interface RideBooking {
  pickup: HomePoint;
  dropoff: DropoffPoint;
  passengers: number;
}

/**
 * A parcel picked up at one place (A) and brought straight to its destination (B).
 * Booked as "Envoi express" (any vehicle) or on the "Courses" tab (the vehicle picked there).
 */
export interface CourierBooking {
  pickup: HomePoint;
  dropoff: DropoffPoint;
  recipientPhone: string;
  recipientName?: string;
  content: string;
  size: ParcelSize;
  vehicleType?: BookableVehicleType;
}

export type LedgerKind = "collected" | "earning" | "settlement";

export interface LedgerEntry {
  id: string;
  at: string;
  kind: LedgerKind;
  amountFcfa: number;
  jobId: string | null;
  stationId: string | null;
}

/** Cash collected minus earnings minus settlements: positive means the driver owes us. */
export function balanceOf(entries: Pick<LedgerEntry, "kind" | "amountFcfa">[]): number {
  return entries.reduce((sum, e) => sum + (e.kind === "collected" ? e.amountFcfa : -e.amountFcfa), 0);
}

/** Everything the driver page needs. */
export interface DriverHome {
  /** Null when the user never applied. */
  driver: Driver | null;
  job: DeliveryJob | null;
  history: DeliveryJob[];
  ledger: LedgerEntry[];
  settings: DriverSettings;
  /**
   * When the driver's last offer ran out unconfirmed (they went back to the end
   * of the line); the app tells them once. Null when it never happened.
   */
  lastExpiredAt: string | null;
  /** Converted drivers: the customer account that took over their wallet and greenpoints (0031). */
  formerAccount?: FormerAccount | null;
}

/**
 * What a converted driver left as a customer (migration 0031): a customer account with
 * their wallet and greenpoints, waiting for a phone number or e-mail address of theirs.
 */
export interface FormerAccount {
  balanceXof: number;
  points: number;
  /** Active reservations that were cancelled when the account became a driver account. */
  cancelledReservations: number;
  /** False while nobody can sign in to it. */
  claimed: boolean;
  /** Whether there is an account to claim (not when only reservations were cancelled). */
  claimable: boolean;
}

/** A driver who showed their QR code at a station, and what staff can do for them. */
export interface DriverAtStation {
  driver: JobDriver & { userId: string };
  balanceFcfa: number;
  /** A job whose parcel the driver comes to take here. */
  handOver: DeliveryJob | null;
  /** A job whose parcel the driver brings here (express, pickup, or a failed delivery coming back). */
  receive: DeliveryJob | null;
}

/** For station staff: who waits here and which parcels drivers take or bring. */
export interface StationDrivers {
  queue: { driver: JobDriver; since: string }[];
  /** Jobs whose parcel a driver will take here. */
  outgoing: DeliveryJob[];
  /** Jobs whose parcel a driver is bringing here. */
  incoming: DeliveryJob[];
}

/** Backoffice: everything about drivers. */
export interface AdminDrivers {
  drivers: Driver[];
  vehicles: FleetVehicle[];
  /** Newest first, at most 500. */
  jobs: DeliveryJob[];
  settings: DriverSettings;
}

export type DriverDecision =
  | { action: "approve"; vehicleId: string }
  | { action: "reject" }
  | { action: "suspend" }
  | { action: "reactivate" }
  | { action: "vehicle"; vehicleId: string | null }
  // Driver back to customer (R15): no trip under way, no cash open, no longer in a fleet.
  | { action: "release" };

/** Jobs that still tie up a driver. */
/** Why a driver gives back a trip they accepted, before they have the parcel or the customer. */
export type AbandonReason = "customer_absent" | "too_big" | "other";
export const ABANDON_REASONS: AbandonReason[] = ["customer_absent", "too_big", "other"];

export const BUSY_JOB_STATUSES: JobStatus[] = ["assigned", "accepted", "picked_up", "at_door", "returning"];
/** Jobs not finished yet. */
export const OPEN_JOB_STATUSES: JobStatus[] = ["open", ...BUSY_JOB_STATUSES];

/** Pickup jobs before the parcel exists: what the driver measured at the door. */
export interface PickupCollect {
  measures: ParcelMeasures;
}

/** Biggest image the driver documents and door photos may have after shrinking. */
export const MAX_DRIVER_IMAGE_BYTES = 2 * 1024 * 1024;
