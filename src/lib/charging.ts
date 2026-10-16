// Charging at a connected socket, run by station staff (plan: planung/laden-vor-ort-plan.md).
// Staff start an outlet for a cash customer or an app customer, both sides see power,
// energy and price every CHARGE_POLL_MS, staff stop it (or the socket ends it when full),
// and the charge is paid in cash at the counter or in the app. Shared by the app, the
// demo backend and the Worker (worker/charging.ts).

export type ChargeStatus = "charging" | "stopped" | "paid" | "cancelled";
export type ChargePaymentMethod = "cash" | "wallet" | "flooz" | "tmoney";

/** How often both screens ask for fresh values while a charge runs or waits for payment. */
export const CHARGE_POLL_MS = 20_000;

/** Price per kWh and minimum per charge, in FCFA. */
export interface ChargeTariff {
  kwhXof: number;
  minXof: number;
}

/** Network default until the backoffice changes it (also seeded by 0025_charging_sessions.sql). */
export const DEFAULT_CHARGE_TARIFF: ChargeTariff = { kwhXof: 150, minXof: 100 };

/** FCFA amounts are whole francs in steps of 5 (as the payment providers require). */
export function roundUpTo5(xof: number): number {
  return Math.ceil(xof / 5) * 5;
}

/** What a charge costs: kWh × price, rounded up to 5 FCFA, at least the minimum; nothing without energy. */
export function chargePrice(energyWh: number, tariff: ChargeTariff): number {
  if (!(energyWh > 0)) return 0;
  return Math.max(tariff.minXof, roundUpTo5((energyWh / 1000) * tariff.kwhXof));
}

export function validTariff(t: ChargeTariff): boolean {
  const ok = (n: number) => Number.isInteger(n) && n % 5 === 0 && n <= 100_000;
  return ok(t.kwhXof) && t.kwhXof > 0 && ok(t.minXof) && t.minXof >= 0;
}

/** What the backoffice saves: the network default (`stationId` null) or a station's own price (null = default). */
export interface ChargeTariffInput {
  stationId: string | null;
  kwhXof: number | null;
  minXof: number | null;
}

/** One charge as staff and the customer see it. */
export interface ChargeSession {
  id: string;
  stationId: string;
  stationName: string;
  pointLabel: string;
  status: ChargeStatus;
  /** Name or masked contact of the app customer; null for a cash customer. */
  customer: string | null;
  /** Current power draw in watts while charging, else 0. */
  powerWatts: number;
  energyWh: number;
  tariff: ChargeTariff;
  /** The price so far (charging), the price to pay (stopped) or the amount paid. */
  amountXof: number;
  startedAt: string;
  stoppedAt: string | null;
  /** True when the socket ended the charge (battery full or unplugged), not staff. */
  endedByDevice: boolean;
  paymentMethod: ChargePaymentMethod | null;
  paidAt: string | null;
  /** The ledger points earned when paid (solar stations, app customers); 0 otherwise. */
  greenpoints: number;
  /** For the customer: which ways to pay in the app are open for this charge. */
  payOptions?: { wallet: boolean; mobile: boolean };
  /** For the customer: a Flooz/T-Money payment waiting for confirmation on the phone. */
  pendingPaymentId?: string | null;
  /** The customer started it by scanning the outlet's QR code, and may stop it in the app. */
  selfStarted?: boolean;
}

// Charging by QR code: a sticker on each outlet links to /recharge?p=<charging point id>; the
// customer starts the charge in the app where an admin allowed it (charging_points.qr_start).

/** What the outlet's page shows: "free" can be started now, the rest say why not. */
export type ChargePointState = "free" | "busy" | "reserved" | "offline" | "fault" | "disabled";

export interface ChargePointInfo {
  pointId: string;
  label: string;
  stationId: string;
  stationName: string;
  state: ChargePointState;
  tariff: ChargeTariff;
}

const POINT_PATH = "/recharge";

/** The link printed as the outlet's QR code. */
export function pointQrUrl(origin: string, pointId: string): string {
  return `${origin.replace(/\/$/, "")}${POINT_PATH}?p=${encodeURIComponent(pointId)}`;
}

/** The charging point id in a scanned outlet code (our link), or null for any other text. */
export function pointIdFromCode(text: string): string | null {
  try {
    const url = new URL(text.trim());
    const id = url.pathname.replace(/\/$/, "") === POINT_PATH ? url.searchParams.get("p") : null;
    return id && /^[\w:.-]{1,80}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Staff view of a station: the charges running or waiting for payment, and today's takings. */
export interface StationCharging {
  tariff: ChargeTariff;
  open: ChargeSession[];
  today: ChargeSession[];
  takings: { cashXof: number; appXof: number; count: number };
}

/** Backoffice: tariffs and the latest charges. */
export interface AdminCharging {
  defaultTariff: ChargeTariff;
  stations: { id: string; name: string; kwhXof: number | null; minXof: number | null; outlets: number }[];
  sessions: ChargeSession[];
  totals: { paidXof: number; energyWh: number; count: number };
}

/** Seconds since the start (or until the stop). */
export function chargeSeconds(s: Pick<ChargeSession, "startedAt" | "stoppedAt">, now: Date = new Date()): number {
  const end = s.stoppedAt ? new Date(s.stoppedAt).getTime() : now.getTime();
  return Math.max(0, Math.round((end - new Date(s.startedAt).getTime()) / 1000));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

export function formatKwh(energyWh: number, locale: string): string {
  return `${(energyWh / 1000).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} kWh`;
}

// The customer's own QR code ("Mon code"): identifies the account at the counter, carries no money.
const ID_PREFIX = "poinderecharge:id:";
const PAY_PREFIX = "poinderecharge:pay:"; // the wallet's "receive" code, accepted too

export function customerCode(contact: string): string {
  return `${ID_PREFIX}${contact}`;
}

/** Whether a scanned text is a customer's own code ("Mon code" or the wallet's receive code). */
export function isCustomerCode(text: string): boolean {
  const t = text.trim();
  return [ID_PREFIX, PAY_PREFIX].some((prefix) => t.startsWith(prefix) && t.length > prefix.length);
}

/** The phone number or e-mail in a scanned code, or the text itself when typed. */
export function contactFromCode(text: string): string {
  const t = text.trim();
  for (const prefix of [ID_PREFIX, PAY_PREFIX]) if (t.startsWith(prefix)) return t.slice(prefix.length);
  return t;
}
