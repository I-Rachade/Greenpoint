import type { StationService } from "./station-services";

/**
 * Station work (plan phase 3): the battery counter, the swap log and the active station.
 * Worker: worker/station-work.ts, migrations 0027_battery_counter.sql and 0028_swap_log.sql.
 * The demo backend (src/lib/backend/demo.ts) follows the same rules with applyBatteryEvent().
 *
 * Counter rules (W9, R3, R4, R5):
 *   issue       −1 full; never below 0
 *   full        +1 full, only when someone marks a battery full; the battery came out of
 *               the "empty / charging" stock, so that stock goes down by one (not below 0)
 *   correction  ±n full, only the station's owner or an admin, always with a reason
 *   empty_in    +1 empty: the empty battery a customer brings back; never the counter
 * Counter = start + full − issued ± corrections. Each change carries a request id: the
 * same id twice is one change (fast taps, retries).
 *
 * Active station (W3, W4, R7): staff work at their one station; an owner (Betreiber)
 * and an admin choose the station they work at, and every station action carries it
 * (header ACTIVE_STATION_HEADER). The server answers 409 when it is missing or another
 * station, 403 to someone without rights at the station. Every change logs station,
 * person and role (an admin as "admin").
 */

/** Header with the station the person works at now (per device, src/lib/active-station.ts). */
export const ACTIVE_STATION_HEADER = "X-Active-Station";

/** Who did a station action. */
export type StationRole = "staff" | "owner" | "admin";

export type BatteryEventType = "issue" | "full" | "correction" | "empty_in";

/** Key of a counter: a battery type id, or "" at a station that lists no battery types. */
export type CounterKey = string;

export interface CounterState {
  full: number;
  empty: number;
}

/** One counter of a station's page: full batteries on the shelf and empty ones charging. */
export interface CounterRow extends CounterState {
  batteryTypeId: CounterKey;
  /** Brand and model; null at a station without battery types. */
  label: string | null;
}

export interface BatteryEventView {
  id: string;
  type: BatteryEventType;
  batteryTypeId: CounterKey;
  delta: number;
  fullAfter: number;
  emptyAfter: number;
  reason: string | null;
  swapId: string | null;
  person: string;
  role: StationRole;
  createdAt: string;
}

/** GET /api/stations/:id/counter */
export interface StationCounter {
  stationId: string;
  /** Places for batteries, full and charging together. */
  capacity: number;
  rows: CounterRow[];
  /** Today's changes, newest first (staff: only their own). */
  events: BatteryEventView[];
  /** The viewer may correct the counter (owner of the station or admin). */
  canCorrect: boolean;
  /** Swap price of the station in FCFA; null = none set. */
  priceXof: number | null;
}

export interface BatteryEventInput {
  type: "issue" | "full" | "correction";
  batteryTypeId?: CounterKey | null;
  /** Corrections only: the change, −CORRECTION_MAX…CORRECTION_MAX, not 0. */
  delta?: number;
  /** Corrections only: why. */
  reason?: string;
  /** Unique per tap (crypto.randomUUID()); the same id twice is one change. */
  requestId: string;
}

export const CORRECTION_MAX = 100;
export const REASON_MAX = 200;
export const BATTERY_LABEL_MAX = 60;

export function validRequestId(id: unknown): id is string {
  return typeof id === "string" && /^[\w:-]{8,80}$/.test(id);
}

export function cleanReason(reason: unknown): string | null {
  const text = typeof reason === "string" ? reason.trim() : "";
  return text.length >= 1 && text.length <= REASON_MAX ? text : null;
}

export function validCorrection(delta: unknown): delta is number {
  return typeof delta === "number" && Number.isInteger(delta) && delta !== 0 && Math.abs(delta) <= CORRECTION_MAX;
}

/** A scanned or typed battery number; empty = none. Undefined when too long. */
export function cleanBatteryLabel(label: unknown): string | null | undefined {
  if (label === undefined || label === null) return null;
  const text = String(label).trim().toUpperCase();
  if (!text) return null;
  return text.length <= BATTERY_LABEL_MAX ? text : undefined;
}

/** Change of full batteries an event makes. */
export function fullDelta(type: BatteryEventType, delta: number): number {
  return type === "empty_in" ? 0 : delta;
}

/**
 * The counter after one event, or null when the event is refused: an issue at 0 or a
 * correction below 0 (R4), a "full" beyond the station's capacity (`total` = full
 * batteries of all its types, `capacity` ≤ 0 = no limit).
 */
export function applyBatteryEvent(
  state: CounterState,
  type: BatteryEventType,
  delta: number,
  limits: { total: number; capacity: number } = { total: 0, capacity: 0 },
): CounterState | null {
  switch (type) {
    case "issue":
      return state.full > 0 ? { full: state.full - 1, empty: state.empty } : null;
    case "full":
      if (limits.capacity > 0 && limits.total >= limits.capacity) return null;
      return { full: state.full + 1, empty: Math.max(state.empty - 1, 0) };
    case "correction":
      return state.full + delta >= 0 ? { full: state.full + delta, empty: state.empty } : null;
    case "empty_in":
      return { full: state.full, empty: state.empty + 1 };
  }
}

// Swaps --------------------------------------------------------------------------

/** app = customer with an account (QR or phone), cash = no account, fleet = driver QR, billed to the fleet. */
export const SWAP_CUSTOMER_TYPES = ["app", "cash", "fleet", "first_purchase"] as const;
export type SwapCustomerType = (typeof SWAP_CUSTOMER_TYPES)[number];

/** How a swap was paid; none = paid outside the app (a reservation completed with its code). */
export type SwapPayment = "cash" | "wallet" | "fleet" | "none";

export interface SwapInput {
  requestId: string;
  batteryTypeId?: CounterKey | null;
  customerType: SwapCustomerType;
  /** Battery numbers (scan or type); required at a station with battery types (battery register, src/lib/batteries.ts). */
  batteryIn?: string | null;
  batteryOut?: string | null;
  /** app paid in cash (and optionally first purchase): the customer's phone, e-mail or app QR. */
  contact?: string | null;
  /** app: "cash" or "wallet" (Green Credit, default). In Lite only cash. */
  payment?: "cash" | "wallet";
  /**
   * Green Credit payment: the one-time code the customer's app shows after they typed their PIN
   * on their phone (src/lib/wallet.ts). Without a reservation, `contact` may carry it instead.
   */
  creditCode?: string | null;
  /** fleet: the driver's QR code or code. */
  driverCode?: string | null;
  /** cash and first purchase: what was taken; default the station's swap price. */
  amountXof?: number | null;
  /** A battery reservation completed by this swap. */
  reservationId?: string | null;
  pickupCode?: string | null;
}

export interface SwapEntry {
  id: string;
  stationId: string;
  batteryTypeId: CounterKey;
  batteryTypeLabel: string | null;
  batteryIn: string | null;
  batteryOut: string | null;
  customerType: SwapCustomerType;
  customer: string | null;
  driver: string | null;
  payment: SwapPayment;
  amountXof: number;
  reservationId: string | null;
  person: string;
  role: StationRole;
  createdAt: string;
}

export interface SwapFilter {
  customerType?: SwapCustomerType | null;
  /** Days back from today (owner backoffice: 1, 7, 30 or 365); staff always see today. */
  days?: number | null;
}

export function isSwapCustomerType(value: unknown): value is SwapCustomerType {
  return typeof value === "string" && (SWAP_CUSTOMER_TYPES as readonly string[]).includes(value);
}

/** R6: every swap takes one battery in and gives one out, except a first purchase (only out). */
export function takesBatteryIn(type: SwapCustomerType): boolean {
  return type !== "first_purchase";
}

export const SWAP_AMOUNT_MAX = 1_000_000;

export function validAmount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= SWAP_AMOUNT_MAX;
}

// Station home -----------------------------------------------------------------------

/** Tiles of the station home, each its own page; shown only while its service is active. */
export type StationTile = "swap" | "counter" | "charging" | "parcels" | "reservations" | "credit";

/** The station's tiles; Green Credit only at a station an admin designated (0047). */
export function stationTiles(active: readonly StationService[], greenCredit = false): StationTile[] {
  const has = (s: StationService) => active.includes(s);
  const tiles: StationTile[] = [];
  if (has("swap")) tiles.push("swap", "counter");
  if (has("charging") || has("ev")) tiles.push("charging");
  if (has("parcels")) tiles.push("parcels");
  if (has("swap") || has("charging")) tiles.push("reservations");
  if (greenCredit) tiles.push("credit");
  return tiles;
}

/** The role a profile has at a station, as the server decides it (worker/station-work.ts). */
export function roleAt(
  profile: { role: string; ownerOf?: string[] } | null | undefined,
  station: { operatorId: string },
): StationRole | null {
  if (!profile) return null;
  if (profile.role === "admin") return "admin";
  if (profile.role !== "operator") return null;
  return profile.ownerOf?.includes(station.operatorId) ? "owner" : "staff";
}

/** Midnight in Lomé (UTC, no daylight saving): "today" of the swap log and the counter page. */
export function dayStartLome(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** A fresh request id for one tap or one swap (the server counts each id once). */
export function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

/** The reason of the correction that brings a counter down to a lower capacity. */
export const CAPACITY_REASON = "Capacité réduite";
