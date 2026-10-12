// Partner API: other apps book parcel transports with an API key and get every
// status change by webhook. Shared by the backoffice, the station page, the demo
// backend and the Worker (worker/partners.ts). Docs: docs/PARTNER-API.md and /developpeurs.

import type { ParcelMeasures, ParcelSize, ParcelStatus } from "./parcels";

/** Base path of the partner API on app.poinderecharge.com. */
export const PARTNER_API_BASE = "/api/partner/v1";

/** Days a booked parcel may take to reach the drop-off station before the booking expires. */
export const BOOKING_DAYS = 7;

/** Webhook attempts before giving up; the wait before each retry, in minutes. */
export const WEBHOOK_RETRY_MINUTES = [1, 5, 30, 120, 360, 720, 1440];
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RETRY_MINUTES.length + 1;

/**
 * A booking's status: before drop-off it is the booking's own, afterwards the
 * parcel's. New parcel statuses (driver delivery) may be added later.
 */
export type BookingStatus = "booked" | "expired" | ParcelStatus | (string & {});

/** Booking statuses before the parcel exists. */
export type BookingOwnStatus = "booked" | "handed_in" | "cancelled" | "expired";

export interface PartnerParty {
  name: string | null;
  phone: string;
}

export interface PartnerBooking {
  id: string;
  /** The partner's own order number, unique per partner. */
  reference: string;
  trackingNo: string;
  status: BookingStatus;
  fromStationId: string;
  toStationId: string;
  sender: PartnerParty;
  recipient: PartnerParty;
  parcel: { content: string; declaredValue: number | null } & ParcelMeasures & { size: ParcelSize };
  priceFcfa: number;
  createdAt: string;
  /** A booked parcel not dropped off by then is cancelled. */
  expiresAt: string;
  handedInAt: string | null;
  inTransitAt: string | null;
  arrivedAt: string | null;
  pickedUpAt: string | null;
  pickupDeadline: string | null;
  /** Only if the backoffice allows it for this partner, while the parcel waits at station B. */
  pickupCode?: string;
}

export interface PartnerKey {
  id: string;
  label: string;
  /** First characters of the key, to tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
}

export interface Partner {
  id: string;
  name: string;
  contactEmail: string | null;
  /** Default sender phone of bookings that name none. */
  contactPhone: string;
  isActive: boolean;
  webhookUrl: string | null;
  webhookSecret: string;
  /** Send the recipient's pickup code to the partner (so it can pass it on). */
  sharePickupCode: boolean;
  createdAt: string;
  keys: PartnerKey[];
  /** Parcels dropped off in the last 30 days and their price total (billed to the partner). */
  parcels30d: number;
  amount30d: number;
  /** Bookings still waiting for drop-off. */
  openBookings: number;
}

export interface PartnerInput {
  name: string;
  contactEmail: string;
  contactPhone: string;
  isActive: boolean;
  webhookUrl: string;
  sharePickupCode: boolean;
}

/** One webhook message and how its delivery went. */
export interface PartnerEventLog {
  id: string;
  partnerId: string;
  bookingId: string;
  type: string;
  createdAt: string;
  attempts: number;
  deliveredAt: string | null;
  nextAttemptAt: string | null;
  lastStatus: number | null;
  lastError: string | null;
}

export interface AdminPartners {
  partners: Partner[];
  /** Latest webhook messages, newest first. */
  events: PartnerEventLog[];
}

/** A booking as the drop-off station sees it. */
export interface StationBooking {
  id: string;
  trackingNo: string;
  partnerName: string;
  reference: string;
  toStationId: string;
  sender: PartnerParty;
  recipient: PartnerParty;
  content: string;
  declaredValue: number | null;
  measures: ParcelMeasures;
  size: ParcelSize;
  priceFcfa: number;
  createdAt: string;
  expiresAt: string;
}

/** An API key: "pdr_live_" and 32 letters/digits. */
export function newApiKey(random: (n: number) => Uint32Array = (n) => crypto.getRandomValues(new Uint32Array(n))): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  return `pdr_live_${[...random(32)].map((b) => alphabet[b % alphabet.length]).join("")}`;
}

/** Shown in lists: "pdr_live_ab3…". */
export const keyPrefix = (key: string) => key.slice(0, 13);

/** A webhook secret: "whsec_" and 32 hex characters. */
export function newWebhookSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return `whsec_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** Only https addresses, no credentials in the URL. */
export function validWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && value.length <= 500;
  } catch {
    return false;
  }
}

/** Signature header value: "t=<unix seconds>,v1=<hex HMAC-SHA256 of `${t}.${body}`>". */
export async function signWebhook(secret: string, timestamp: number, body: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`));
  const hex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `t=${timestamp},v1=${hex}`;
}
