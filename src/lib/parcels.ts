// Parcel depot: a customer brings a parcel to station A for a recipient who picks
// it up at station B. Staff carry collected parcels between stations; the
// recipient picks up with a 6-digit code or the QR code in the app.
// Shared by the app, the demo backend and the Worker. Plan: planung/paketdepot.md.

import type { DeliveryStatus, DriverSettings, BookableVehicleType } from "./drivers";

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

/**
 * The measures sent when staff only choose a size: the tier's limits. The server
 * then finds that same tier (sizeFor), so price and vehicle limits follow the size.
 */
export function measuresOf(tier: ParcelSizeTier): ParcelMeasures {
  return { lengthCm: tier.maxLengthCm, widthCm: tier.maxWidthCm, heightCm: tier.maxHeightCm, weightKg: tier.maxWeightKg };
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

/**
 * What staff scan when a parcel changes hands (plan phase 7): the QR code of the shipping
 * label (the parcel number alone), the QR code of the drop-off slip (parcels labelled before
 * the shipping label existed), the recipient's pickup QR code, or the parcel number typed in. Never a bare
 * 6-digit pickup code: a scan names the parcel, not the recipient.
 */
export function parseParcelScan(input: string): string | null {
  const text = input.trim();
  const slip = /^poinderecharge colis (GP-[A-Z0-9]{6})/i.exec(text);
  if (slip) return normalizeTrackingNo(slip[1]);
  const pickup = parsePickupInput(text);
  if (pickup) return pickup.trackingNo;
  return /[a-z]/i.test(text) ? normalizeTrackingNo(text) : null;
}

/** Reads a scanned pickup QR code, or a typed 6-digit code. */
export function parsePickupInput(input: string): { trackingNo: string | null; code: string } | null {
  const text = input.trim();
  const qr = new RegExp(`^${PICKUP_QR_PREFIX}:(GP-[A-Z0-9]{6}):(\\d{6})$`).exec(text);
  if (qr) return { trackingNo: qr[1], code: qr[2] };
  const digits = text.replace(/\s/g, "");
  return /^\d{6}$/.test(digits) ? { trackingNo: null, code: digits } : null;
}

/**
 * What staff type or scan at the handover counter: the recipient's pickup code (or QR),
 * or just the parcel number "GP-…", which then needs an ID check. A bare 6-digit
 * number is always a code, so the parcel number has to carry a letter or "GP".
 */
export function parseHandoverInput(input: string): { trackingNo: string | null; code: string | null } | null {
  const pickup = parsePickupInput(input);
  if (pickup) return pickup;
  const text = input.trim();
  if (!/[a-z]/i.test(text)) return null;
  const trackingNo = normalizeTrackingNo(text);
  return trackingNo ? { trackingNo, code: null } : null;
}

/** A station that accepts and hands out parcels. */
export interface ParcelDepot {
  stationId: string;
  isActive: boolean;
  /** Where at the station, e.g. "au comptoir". */
  note: string;
  /** Staff take and hand out parcels at a counter. */
  counter: boolean;
  /** Compartments of a locker; 0 = counter only. */
  lockers: number;
}

export interface ParcelDepotInput {
  isActive: boolean;
  note: string;
  lockers: number;
  /** Left out: unchanged (a new depot gets a counter). */
  counter?: boolean;
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
  /** The collection run the parcel is on or went on (plan phase 7). */
  runId?: string | null;
  /**
   * When staff first confirmed the shipping label was printed and stuck on the parcel
   * (migration 0040). null: not yet, so the parcel cannot go on a collection run.
   */
  labelPrintedAt?: string | null;
  /** For staff: the sender has signed in to the app, so the drop-off slip reaches them there. */
  senderHasApp?: boolean;
  /** For the customer: what happened to the parcel, oldest first (status changes and scans). */
  history?: ParcelHistoryEntry[];
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
  /** Ride vehicles we have at least one active vehicle of; the others show as "soon". */
  bookableVehicles: BookableVehicleType[];
}

/** Everything the backoffice parcel page needs. */
export interface AdminParcels {
  /** Newest first, at most 1000. */
  parcels: Parcel[];
  /** Every depot, also switched-off ones. */
  depots: ParcelDepot[];
  sizes: ParcelSizeTier[];
}

// Scans and collection runs (plan phase 7, migration 0034) -----------------------------

/** Someone scanned the parcel as it changed hands: staff to driver, driver to staff, driver to recipient. */
export type ParcelScanKind = "handover_to_driver" | "received_at_station" | "delivered";

/** One line of a parcel's history as the customer sees it: never who scanned, only where and when. */
export interface ParcelHistoryEntry {
  at: string;
  kind: ParcelStatus | ParcelScanKind;
  stationId: string | null;
}

/** The order steps happen in, for entries with the same time. */
const HISTORY_ORDER: ParcelHistoryEntry["kind"][] = ["deposited", "handover_to_driver", "in_transit", "received_at_station", "arrived", "delivered", "picked_up"];

/** Oldest first; entries of the same moment in the order the steps happen. */
export function sortHistory(entries: ParcelHistoryEntry[]): ParcelHistoryEntry[] {
  const rank = (kind: ParcelHistoryEntry["kind"]) => {
    const i = HISTORY_ORDER.indexOf(kind);
    return i < 0 ? HISTORY_ORDER.length : i;
  };
  return [...entries].sort((a, b) => a.at.localeCompare(b.at) || rank(a.kind) - rank(b.kind));
}

export type ParcelRunStatus = "loading" | "under_way" | "done" | "cancelled";

/** One parcel on a collection run, and whether it was scanned into the driver's hands and in at its station. */
export interface ParcelRunItem {
  id: string;
  trackingNo: string;
  toStationId: string;
  size: ParcelSize;
  scanned: boolean;
  received: boolean;
}

/**
 * A collection run: staff choose the parcels a driver takes, scan each one into the
 * driver's hands, and the run leaves only when every parcel was scanned. Staff at each
 * destination scan the parcels in.
 */
export interface ParcelRun {
  id: string;
  stationId: string;
  driver: { userId: string; name: string; phone: string | null; plate: string | null };
  status: ParcelRunStatus;
  createdAt: string;
  departedAt: string | null;
  parcels: ParcelRunItem[];
}

/** The statuses in which a parcel is still on its way to the recipient. */
export const OPEN_PARCEL_STATUSES: ParcelStatus[] = ["deposited", "in_transit", "arrived"];

/** A parcel without a shipping label stuck on it cannot go on a collection run. */
export function needsLabel(p: Pick<Parcel, "labelPrintedAt">): boolean {
  return p.labelPrintedAt === null;
}

/**
 * What the shipping label's QR code holds: the parcel number alone, short so it scans
 * even on a creased label (parseParcelScan reads it). Never the pickup code.
 */
export function labelQrPayload(trackingNo: string): string {
  return trackingNo;
}

/** "+228 90 •• •• 12": enough for the driver and staff to match, not a number to call. */
export function maskPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 6) return "••";
  const local = digits.startsWith("228") ? digits.slice(3) : digits;
  const prefix = digits.startsWith("228") ? "+228 " : "";
  return `${prefix}${local.slice(0, 2)} •• •• ${local.slice(-2)}`;
}

/** The first word of a name, for the label; null when there is none. */
export function firstName(name: string | null): string | null {
  const first = name?.trim().split(/\s+/)[0];
  return first ? first : null;
}

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
