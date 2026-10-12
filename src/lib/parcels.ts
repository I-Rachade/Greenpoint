// Parcel depot: a customer brings a parcel to station A for a recipient who picks
// it up at station B. Staff carry collected parcels between stations; the
// recipient picks up with a 6-digit code or the QR code in the app.
// Shared by the app, the demo backend and the Worker. Plan: planung/paketdepot.md.

import type { DeliveryStatus, DriverSettings } from "./drivers";

export type ParcelSize = "S" | "M" | "L" | "XL";
export const PARCEL_SIZES: ParcelSize[] = ["S", "M", "L", "XL"];

export type ParcelStatus =
  | "deposited" // handed in at station A
  | "in_transit" // on the collection run
  | "arrived" // at station B, waiting for the recipient (pickup code exists)
  | "picked_up"
  | "cancelled" // only while deposited
  | "stored" // not picked up in time: put into storage, to be auctioned
  | "released" // handed out from storage after all
  | "auctioned";

/** Days a parcel waits at station B before it goes into storage (and is later auctioned). */
export const PARCEL_PICKUP_DAYS = 7;
/** Days after arrival on which the recipient gets a reminder. */
export const PARCEL_REMINDER_DAYS = [3, 6];
/** Liability for loss or damage while in our care: the declared value, at most this many times the price and at most PARCEL_LIABILITY_CAP_FCFA. */
export const PARCEL_LIABILITY_PRICE_FACTOR = 10;
export const PARCEL_LIABILITY_CAP_FCFA = 50_000;

/** What we pay at most if this parcel is lost or damaged in our care. */
export function liabilityLimit(priceFcfa: number, declaredValue: number | null): number {
  const limit = Math.min(priceFcfa * PARCEL_LIABILITY_PRICE_FACTOR, PARCEL_LIABILITY_CAP_FCFA);
  return declaredValue == null ? limit : Math.min(limit, declaredValue);
}

/** Heaviest parcel accepted, in kg. */
export const PARCEL_MAX_KG = 50;
/** Wrong pickup codes at one station before code entry is paused there. */
export const PARCEL_MAX_CODE_FAILURES = 5;
export const PARCEL_CODE_LOCK_MINUTES = 15;

/** One size tier: the parcel fits if its dimensions (in any orientation) and weight are within the limits. */
export interface ParcelSizeTier {
  size: ParcelSize;
  maxLengthCm: number;
  maxWidthCm: number;
  maxHeightCm: number;
  maxWeightKg: number;
  priceFcfa: number;
}

/** Starting prices (planung/paketdepot.md); admins change them in the backoffice. */
export const DEFAULT_PARCEL_SIZES: ParcelSizeTier[] = [
  { size: "S", maxLengthCm: 30, maxWidthCm: 20, maxHeightCm: 15, maxWeightKg: 2, priceFcfa: 200 },
  { size: "M", maxLengthCm: 45, maxWidthCm: 35, maxHeightCm: 25, maxWeightKg: 5, priceFcfa: 500 },
  { size: "L", maxLengthCm: 60, maxWidthCm: 40, maxHeightCm: 40, maxWeightKg: 20, priceFcfa: 1000 },
  { size: "XL", maxLengthCm: 100, maxWidthCm: 60, maxHeightCm: 60, maxWeightKg: 50, priceFcfa: 2000 },
];

export interface ParcelMeasures {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
}

const desc = (values: number[]) => [...values].sort((a, b) => b - a);

/** True when the parcel fits the tier; a parcel may be turned, so the sides are compared largest to largest. */
export function fitsTier(m: ParcelMeasures, tier: ParcelSizeTier): boolean {
  const parcel = desc([m.lengthCm, m.widthCm, m.heightCm]);
  const limit = desc([tier.maxLengthCm, tier.maxWidthCm, tier.maxHeightCm]);
  return parcel.every((side, i) => side <= limit[i]) && m.weightKg <= tier.maxWeightKg;
}

export function validMeasures(m: ParcelMeasures): boolean {
  const values = [m.lengthCm, m.widthCm, m.heightCm, m.weightKg];
  return values.every((v) => typeof v === "number" && Number.isFinite(v) && v > 0) && m.weightKg <= PARCEL_MAX_KG;
}

/** The smallest tier the parcel fits, or null when it is too big or too heavy. */
export function sizeFor(m: ParcelMeasures, tiers: ParcelSizeTier[]): ParcelSizeTier | null {
  if (!validMeasures(m)) return null;
  const order = (t: ParcelSizeTier) => PARCEL_SIZES.indexOf(t.size);
  return [...tiers].sort((a, b) => order(a) - order(b)).find((t) => fitsTier(m, t)) ?? null;
}

/** Letters and digits without look-alikes (0/O, 1/I/L), for numbers read out loud or typed. */
const TRACKING_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** A new tracking number, e.g. "GP-7K3M9Q". */
export function newTrackingNo(random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const chars = [...random(6)].map((b) => TRACKING_ALPHABET[b % TRACKING_ALPHABET.length]);
  return `GP-${chars.join("")}`;
}

export function normalizeTrackingNo(input: string): string | null {
  const raw = input.trim().toUpperCase().replace(/[\s-]/g, "");
  const body = raw.startsWith("GP") ? raw.slice(2) : raw;
  return new RegExp(`^[${TRACKING_ALPHABET}]{6}$`).test(body) ? `GP-${body}` : null;
}

/** Prefix of the QR code a recipient shows at station B. */
const PICKUP_QR_PREFIX = "POINDERECHARGE-COLIS";

/** What the recipient's QR code holds: tracking number and pickup code. */
export function pickupQrPayload(trackingNo: string, code: string): string {
  return `${PICKUP_QR_PREFIX}:${trackingNo}:${code}`;
}

/** Reads a scanned pickup QR code, or a typed 6-digit code. */
export function parsePickupInput(input: string): { trackingNo: string | null; code: string } | null {
  const text = input.trim();
  const qr = new RegExp(`^${PICKUP_QR_PREFIX}:(GP-[A-Z0-9]{6}):(\\d{6})$`).exec(text);
  if (qr) return { trackingNo: qr[1], code: qr[2] };
  const digits = text.replace(/\s/g, "");
  return /^\d{6}$/.test(digits) ? { trackingNo: null, code: digits } : null;
}

/** A station that accepts and hands out parcels. */
export interface ParcelDepot {
  stationId: string;
  isActive: boolean;
  /** Where at the station, e.g. "au comptoir". */
  note: string;
  /** Compartments of a future locker; 0 = counter only. */
  lockers: number;
}

export interface ParcelDepotInput {
  isActive: boolean;
  note: string;
  lockers: number;
}

/** Someone the parcel is from or for, identified by phone number. */
export interface ParcelParty {
  userId: string | null;
  phone: string;
  name: string | null;
}

export interface Parcel {
  id: string;
  trackingNo: string;
  fromStationId: string;
  toStationId: string;
  sender: ParcelParty;
  recipient: ParcelParty;
  content: string;
  /** Declared value in FCFA, if given. */
  declaredValue: number | null;
  measures: ParcelMeasures;
  size: ParcelSize;
  priceFcfa: number;
  /** "cash" at the counter for now; Flooz/T-Money later. */
  paymentMethod: string;
  paidAt: string | null;
  status: ParcelStatus;
  createdAt: string;
  inTransitAt: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  /** When the parcel goes into storage if nobody picks it up. */
  pickupDeadline: string | null;
  lockerNo: number | null;
  /** Carried straight to station B by a driver instead of the collection run. */
  express: boolean;
  /** Home delivery booked by the recipient (see src/lib/drivers.ts). */
  deliveryStatus: DeliveryStatus | null;
  /** The driver trip for this parcel (express, pickup or home delivery). */
  jobId: string | null;
  /** Only for the recipient, and only once the parcel has arrived. */
  pickupCode?: string;
  /** For the signed-in customer: did they send it, or is it for them? */
  direction?: "sent" | "received";
}

export interface ParcelInput {
  senderPhone: string;
  senderName?: string;
  recipientPhone: string;
  recipientName?: string;
  toStationId: string;
  content: string;
  declaredValue?: number | null;
  measures: ParcelMeasures;
  /** A driver carries it straight to station B; the fare is paid at the counter too. */
  express?: boolean;
}

/** Public: the depots and prices, so customers know where and for how much. */
export interface ParcelInfo {
  depots: ParcelDepot[];
  sizes: ParcelSizeTier[];
  /** Trip prices, so the app can show what a pickup or delivery costs. */
  driverSettings: DriverSettings;
}

/** Everything the backoffice parcel page needs. */
export interface AdminParcels {
  /** Newest first, at most 1000. */
  parcels: Parcel[];
  /** Every depot, also switched-off ones. */
  depots: ParcelDepot[];
  sizes: ParcelSizeTier[];
}

/** The statuses in which a parcel is still on its way to the recipient. */
export const OPEN_PARCEL_STATUSES: ParcelStatus[] = ["deposited", "in_transit", "arrived"];

/** Text on the drop-off slip's QR code: everything printed on the slip, never the pickup code. */
export function slipQrText(p: Parcel, stationName: (id: string) => string): string {
  return [
    `poinderecharge colis ${p.trackingNo}`,
    `De: ${stationName(p.fromStationId)}`,
    `A: ${stationName(p.toStationId)}`,
    `Taille ${p.size}, ${p.measures.weightKg} kg, ${p.priceFcfa} FCFA`,
    `Contenu: ${p.content}`,
    `Depose le ${p.createdAt.slice(0, 10)}`,
  ].join("\n");
}
