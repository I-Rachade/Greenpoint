// Charging at a connected socket, run by station staff (plan: planung/laden-vor-ort-plan.md).
// Staff start an outlet for a cash customer or an app customer, both sides see power,
// energy and price every CHARGE_POLL_MS, staff stop it (or the socket ends it when full),
// and the charge is paid in cash at the counter or in the app. Shared by the app, the
// demo backend and the Worker (worker/charging.ts).

export type ChargeStatus = "charging" | "stopped" | "paid" | "cancelled";
export type ChargePaymentMethod = "cash" | "wallet" | "flooz" | "tmoney" | "card";

/** How often both screens ask for fresh values while a charge runs or waits for payment. */
export const CHARGE_POLL_MS = 20_000;

/** Price per kWh and minimum per charge, in FCFA. */
export interface ChargeTariff {
  kwhXof: number;
  minXof: number;
}

/** Network default until the backoffice changes it (also seeded by 0025_charging_sessions.sql). */
export const DEFAULT_CHARGE_TARIFF: ChargeTariff = { kwhXof: 150, minXof: 100 };
/** Network price of a car charge until the backoffice sets one (app_settings.ev_tariff, 0048). */
export const DEFAULT_EV_TARIFF: ChargeTariff = { kwhXof: 200, minXof: 500 };

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
  /** The price of car chargers (0048) instead of motorbike outlets. */
  ev?: boolean;
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
  /** The charging card that started it and pays it from its credit. */
  card?: string;
  /** Paid from Green Credit: the most it may cost (the balance when it started); it stops there and pays itself. */
  creditLimitXof?: number;
}

// Charging by QR code: one sticker per socket box links to /q/<code> (the short link, 0061) or,
// on stickers printed before it, /recharge?o=<token>; the customer picks a free outlet of the box
// and starts the charge in the app where an admin allowed it (charging_points.qr_start). The
// older per-outlet codes (/recharge?p=…) no longer work.

/** What an outlet shows on the box's page: "free" can be started now, the rest say why not. */
export type ChargePointState = "free" | "busy" | "reserved" | "offline" | "fault" | "disabled";

/** One outlet of the box behind a scanned QR code, as the picker shows it. */
export interface ChargeOutletSocket {
  pointId: string;
  label: string;
  outlet: number;
  state: ChargePointState;
  /** The signed-in customer's own reservation holds this outlet: it is free for them. */
  yours?: boolean;
  /** A car charger connected through this outlet (ev_chargers.point_id, 0048). */
  ev?: { name: string; connector: string; powerKw: number };
}

/** The socket box behind a scanned QR code: one sticker, the customer picks an outlet. */
export interface ChargeOutletInfo {
  label: string;
  stationId: string;
  stationName: string;
  tariff: ChargeTariff;
  outlets: ChargeOutletSocket[];
  /** Green Credit pays here: a socket of ours at a Green Credit station (0047). */
  creditAccepted: boolean;
  /** The signed-in customer's Green Credit; absent when signed out. */
  balanceXof?: number;
}

const POINT_PATH = "/recharge";
const SHORT_PATH = "/q/";
const BOX_TOKEN = /^[0-9a-f]{32}$/;
// The short code: 8 characters of 0-9a-z (41 random bits), lower case so no scanner or keyboard
// changes it. A link with one more character opens one outlet: 1-9, then a-g for 10 to 16.
const CODE_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
const BOX_CODE = /^[0-9a-z]{8}$/;
const SHORT_LINK = /^([0-9a-z]{8})([1-9a-g])?$/;
const OUTLET_CHARS = "123456789abcdefg";

/** A new short code for a box (devices.qr_code, worker/migrations/0061_device_qr_code.sql). */
export function newBoxCode(): string {
  return [...crypto.getRandomValues(new Uint8Array(8))].map((b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
}

/**
 * Short codes printed before the box was registered (stickers made in advance): the box gets
 * this code instead of a new one when it is added, so its stickers work from the start.
 */
export const RESERVED_BOX_CODES: Readonly<Record<string, string>> = {
  "101104": "tmwb69x6",
  "101105": "utf4dpcg",
  "101106": "shp980eo",
  "101107": "13lrs2ho",
  "101108": "gcc22nz7",
};

/**
 * The link printed as the box's QR code. With its short code (devices.qr_code) it is
 * https://app.poinderecharge.com/q/<code>, 41 characters: a version 3 QR code (29×29) instead of
 * version 5 (37×37) for the long /recharge?o=<token>, so cheap phones read it from further away.
 * The Worker answers /q/… with a redirect, so where it leads can change without new stickers.
 */
export function boxQrUrl(origin: string, code: string): string {
  const base = origin.replace(/\/$/, "");
  return BOX_CODE.test(code) ? `${base}${SHORT_PATH}${code}` : `${base}${POINT_PATH}?o=${encodeURIComponent(code)}`;
}

/** The link printed on one outlet of the box: the box's code plus the outlet, which the picker selects. */
export function socketQrUrl(origin: string, code: string, outlet: number): string {
  const short = outlet >= 1 && outlet <= OUTLET_CHARS.length ? OUTLET_CHARS[outlet - 1] : null;
  return BOX_CODE.test(code) && short ? `${boxQrUrl(origin, code)}${short}` : `${boxQrUrl(origin, code)}&s=${outlet}`;
}

/** The box and outlet in the part of a short link after /q/; null when it is not one. */
export function shortLinkTarget(path: string): { token: string; outlet: number | null } | null {
  const m = SHORT_LINK.exec(path.toLowerCase());
  return m ? { token: m[1], outlet: m[2] ? OUTLET_CHARS.indexOf(m[2]) + 1 : null } : null;
}

/** Where the Worker sends a scanned short link: the box's page with its outlet selected. */
export function shortLinkRedirect(path: string): string | null {
  const target = shortLinkTarget(path);
  return target && `${POINT_PATH}?o=${target.token}${target.outlet ? `&s=${target.outlet}` : ""}`;
}

/**
 * The box in a scanned code (our link, short or long), with the outlet when it is one outlet's
 * code; null for any other text, older per-outlet codes (?p=) included. The outlet only
 * preselects: the server checks it like any pick.
 */
export function boxFromCode(text: string): { token: string; outlet: number | null } | null {
  try {
    const url = new URL(text.trim());
    const path = url.pathname.toLowerCase();
    if (path.startsWith(SHORT_PATH)) return shortLinkTarget(path.slice(SHORT_PATH.length).replace(/\/$/, ""));
    if (url.pathname.replace(/\/$/, "") !== POINT_PATH) return null;
    const token = url.searchParams.get("o")?.toLowerCase();
    if (!token || !validBoxToken(token)) return null;
    return { token, outlet: outletParam(url.searchParams.get("s")) };
  } catch {
    return null;
  }
}

/** The outlet number of a socket code (1 to 16), or null. */
export function outletParam(raw: string | null): number | null {
  return raw && /^([1-9]|1[0-6])$/.test(raw) ? Number(raw) : null;
}

/** A box's short code or long token as typed in a link; anything else is not ours. */
export function validBoxToken(token: string): boolean {
  return BOX_TOKEN.test(token) || BOX_CODE.test(token);
}

/** Staff view of a station: the charges running or waiting for payment, and today's takings. */
export interface StationCharging {
  tariff: ChargeTariff;
  /** The price of the station's connected car chargers (0048). */
  evTariff: ChargeTariff;
  open: ChargeSession[];
  today: ChargeSession[];
  takings: { cashXof: number; appXof: number; count: number };
}

/** Backoffice: tariffs and the latest charges. */
export interface AdminCharging {
  defaultTariff: ChargeTariff;
  /** Network price of car chargers (0048). */
  evTariff: ChargeTariff;
  stations: {
    id: string;
    name: string;
    kwhXof: number | null;
    minXof: number | null;
    outlets: number;
    /** The station's own car price (null = network default) and its connected car chargers. */
    evKwhXof: number | null;
    evMinXof: number | null;
    evChargers: number;
  }[];
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
