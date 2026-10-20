import { distanceMeters, type LatLng } from "./geo";

// Share: renting an e-motorbike (later e-scooters and cars) from one station where it can charge
// to any other Share station (migration 0060_share.sql, worker/share.ts, docs/SHARE.md).
// The vehicle carries a Tutrack GPS tracker with an ignition lock: the server unlocks it when the
// ride starts and locks it when the ride ends, which it only allows within a Share station's
// radius. The destination picked at the start only plans the trip. Paid after the ride with
// Flooz/T-Money or in cash to the staff; Green Credit stays for energy only (0047).
// Shared by the app, the demo backend and the Worker.

export type ShareVehicleKind = "emoto" | "escooter" | "car";
export const SHARE_VEHICLE_KINDS: ShareVehicleKind[] = ["emoto", "escooter", "car"];

/**
 * available: parked at a station, can be rented · reserved: held for a customer · in_ride: on the
 * road · charging: staff put it on charge · maintenance: out of service · lost: an admin is looking for it.
 */
export type ShareVehicleStatus = "available" | "reserved" | "in_ride" | "charging" | "maintenance" | "lost";
export const SHARE_VEHICLE_STATUSES: ShareVehicleStatus[] = ["available", "reserved", "in_ride", "charging", "maintenance", "lost"];
/** What station staff may set on a vehicle parked at their station. */
export const STAFF_VEHICLE_STATUSES: ShareVehicleStatus[] = ["available", "charging", "maintenance"];

export type ShareRideStatus = "reserved" | "riding" | "paused" | "ended" | "cancelled";
/** none: nothing to pay (yet, or free) · unpaid: ended, the amount is owed · paid. */
export type SharePaymentStatus = "none" | "unpaid" | "paid";
export type SharePaidWith = "flooz" | "tmoney" | "wallet" | "cash" | "free";

export type ShareVerificationStatus = "none" | "pending" | "approved" | "rejected";
/** Photos a customer sends once; the licence only for cars (owner's decision of 2026-10-20). */
export type ShareDocument = "id" | "selfie" | "licence";
export const SHARE_DOCUMENTS: ShareDocument[] = ["id", "selfie", "licence"];

/** A reservation holds the vehicle this long, free of charge. */
export const SHARE_RESERVE_MINUTES = 10;
/** Default drop-off radius around a station, changed per station in the backoffice. */
export const SHARE_DEFAULT_RADIUS_M = 50;
export const SHARE_RADIUS_MIN_M = 10;
export const SHARE_RADIUS_MAX_M = 500;
/** A position older than this does not prove where the vehicle stands. */
export const SHARE_FIX_MAX_AGE_MS = 5 * 60_000;
/** Below this the app warns during a ride and shows the nearest station. */
export const SHARE_LOW_BATTERY_PERCENT = 15;
/** A ride longer than this raises an alarm in the backoffice. */
export const SHARE_LONG_RIDE_HOURS = 6;
export const SHARE_PRICE_MAX_XOF = 1_000_000;

/** Prices of one vehicle kind in FCFA. A kind with an inactive tariff cannot be rented. */
export interface ShareTariff {
  kind: ShareVehicleKind;
  unlockXof: number;
  minuteXof: number;
  pauseMinuteXof: number;
  /** Shown to the customer; collected at the counter if set (no wallet to block it in). */
  depositXof: number;
  /** Added when an admin has to fetch a vehicle left outside a station. */
  wrongDropXof: number;
  isActive: boolean;
}

export type ShareTariffInput = Omit<ShareTariff, "kind">;

/** A vehicle as the app shows it on the map and at a station. */
export interface ShareVehicle {
  id: string;
  kind: ShareVehicleKind;
  /** Brand and model, e.g. "Spiro Ekon". */
  name: string;
  plate: string;
  /** Battery of the vehicle in percent, as the tracker last reported it; null when unknown. */
  batteryPercent: number | null;
  stationId: string | null;
  status: ShareVehicleStatus;
  /** Last known position (parked vehicles stand at their station). */
  lat: number | null;
  lng: number | null;
}

/** A station offering Share, with the vehicles parked there. */
export interface ShareStation {
  stationId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  radiusM: number;
  /** Loan helmets kept at the station. */
  helmets: number;
  vehicles: ShareVehicle[];
}

export interface ShareRide {
  id: string;
  vehicle: Pick<ShareVehicle, "id" | "kind" | "name" | "plate" | "batteryPercent" | "lat" | "lng">;
  fromStationId: string;
  fromStationName: string;
  /** Planned destination, only for planning: any Share station takes the vehicle back. */
  toStationId: string | null;
  toStationName: string | null;
  /** Where it was handed back. */
  endStationId: string | null;
  endStationName: string | null;
  status: ShareRideStatus;
  /** The customer takes a loan helmet at the station (or brings their own). */
  helmet: boolean;
  reservedAt: string;
  reserveExpiresAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  /** Paused time before the current pause, in seconds. */
  pausedSeconds: number;
  endedAt: string | null;
  distanceM: number;
  /** Final amount once ended; the running estimate while on the road. */
  amountXof: number;
  paymentStatus: SharePaymentStatus;
  paidWith: SharePaidWith | null;
  tariff: ShareTariff;
}

/** GET /api/share/me: what the Share tab needs about the signed-in customer. */
export interface ShareMe {
  verification: ShareVerificationStatus;
  /** Photos already sent (the keys stay on the server). */
  documents: ShareDocument[];
  rejectReason: string | null;
  ride: ShareRide | null;
  /** Ended rides still to pay; a new ride waits until they are paid. */
  unpaid: ShareRide[];
  /** Simulated trackers (no Tutrack account yet): the app sends the phone's position during a ride. */
  simulated: boolean;
  /** How an ended ride can be paid in the app; cash to the staff always works. */
  payOptions: { mobile: boolean; wallet: boolean };
  /** Green Credit balance, null without access to Green Credit. */
  walletBalanceXof: number | null;
  /** Flooz/T-Money payments waiting for the customer's confirmation, per ride. */
  pendingPayments: Record<string, string>;
}

/** GET /api/share: public overview for the map and the Share tab. */
export interface ShareOverview {
  stations: ShareStation[];
  tariffs: ShareTariff[];
}

// Station staff ----------------------------------------------------------------------

export interface StationShare {
  /** The station takes Share vehicles (backoffice). */
  enabled: boolean;
  helmets: number;
  vehicles: ShareVehicle[];
  /** Rides on the road that were planned to end here, and reservations of vehicles parked here. */
  incoming: ShareRide[];
  /** Rides that ended here and are not paid: staff take the cash. */
  unpaid: (ShareRide & { customer: string })[];
}

// Backoffice ------------------------------------------------------------------------

export interface AdminShareVehicle extends ShareVehicle {
  stationName: string | null;
  homeStationId: string | null;
  /** Tutrack device id; null while no tracker is fitted. */
  trackerId: string | null;
  imei: string;
  sim: string;
  /** Tutrack cmdCategoryCode of the commands that release and cut the ignition. */
  unlockCommand: string;
  lockCommand: string;
  online: boolean;
  /** Ignition on (ACC), as the tracker last said. */
  ignition: boolean | null;
  lastSeenAt: string | null;
  note: string;
}

export interface ShareVehicleInput {
  kind: ShareVehicleKind;
  name: string;
  plate: string;
  homeStationId: string | null;
  trackerId: string | null;
  imei: string;
  sim: string;
  unlockCommand: string;
  lockCommand: string;
  note: string;
}

export interface AdminShareStation {
  stationId: string;
  name: string;
  enabled: boolean;
  radiusM: number;
  helmets: number;
  vehicles: number;
}

export interface ShareStationInput {
  enabled: boolean;
  radiusM: number;
  helmets: number;
}

export interface AdminShareRide extends ShareRide {
  customer: string;
  customerId: string | null;
}

export interface AdminShareVerification {
  userId: string;
  customer: string;
  status: ShareVerificationStatus;
  documents: Partial<Record<ShareDocument, string>>;
  submittedAt: string | null;
  rejectReason: string | null;
}

export type ShareIncidentKind = "breakdown" | "damage" | "alarm" | "wrong_drop" | "long_ride" | "offline";

export interface ShareIncident {
  id: string;
  kind: ShareIncidentKind;
  vehicleId: string | null;
  vehicleName: string | null;
  rideId: string | null;
  note: string;
  createdAt: string;
  resolvedAt: string | null;
  resolution: string | null;
}

export interface AdminShare {
  enabled: boolean;
  /** No Tutrack credentials yet: commands succeed on their own and positions come from the phone. */
  simulated: boolean;
  vehicles: AdminShareVehicle[];
  stations: AdminShareStation[];
  tariffs: ShareTariff[];
  rides: AdminShareRide[];
  verifications: AdminShareVerification[];
  incidents: ShareIncident[];
}

export interface ShareTrackPoint {
  at: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
}

// Rules shared by the server and the demo -----------------------------------------------

/** Whole minutes, rounded up: a started minute counts. */
export function billedMinutes(ms: number): number {
  return ms <= 0 ? 0 : Math.ceil(ms / 60_000);
}

/** Riding and paused time of a ride at `now` (or its end). */
export function rideTimes(ride: Pick<ShareRide, "startedAt" | "pausedAt" | "pausedSeconds" | "endedAt">, now: number): { ridingMs: number; pausedMs: number } {
  if (!ride.startedAt) return { ridingMs: 0, pausedMs: 0 };
  const end = ride.endedAt ? Date.parse(ride.endedAt) : now;
  const currentPause = ride.pausedAt ? Math.max(0, end - Date.parse(ride.pausedAt)) : 0;
  const pausedMs = ride.pausedSeconds * 1000 + currentPause;
  return { ridingMs: Math.max(0, end - Date.parse(ride.startedAt) - pausedMs), pausedMs };
}

/** What a ride costs: unlock + riding minutes + paused minutes (+ the fee for a wrong drop-off). */
export function rideCost(tariff: Pick<ShareTariff, "unlockXof" | "minuteXof" | "pauseMinuteXof" | "wrongDropXof">, times: { ridingMs: number; pausedMs: number }, wrongDrop = false): number {
  return (
    tariff.unlockXof +
    billedMinutes(times.ridingMs) * tariff.minuteXof +
    billedMinutes(times.pausedMs) * tariff.pauseMinuteXof +
    (wrongDrop ? tariff.wrongDropXof : 0)
  );
}

/** The documents a vehicle kind needs: no licence for two-wheelers, a licence for cars. */
export function documentsFor(kind: ShareVehicleKind): ShareDocument[] {
  return kind === "car" ? ["id", "selfie", "licence"] : ["id", "selfie"];
}

/** The Share station whose radius holds the position, nearest first; null outside all of them. */
export function stationAt<T extends LatLng & { radiusM: number }>(stations: T[], at: LatLng): T | null {
  let best: { s: T; d: number } | null = null;
  for (const s of stations) {
    const d = distanceMeters(s, at);
    if (d <= s.radiusM && (!best || d < best.d)) best = { s, d };
  }
  return best?.s ?? null;
}

/** The nearest Share station and how far it is. */
export function nearestStation<T extends LatLng>(stations: T[], at: LatLng): { station: T; distance: number } | null {
  let best: { station: T; distance: number } | null = null;
  for (const s of stations) {
    const d = distanceMeters(s, at);
    if (!best || d < best.distance) best = { station: s, distance: d };
  }
  return best;
}

export function validLatLng(p: unknown): p is LatLng {
  const q = p as Partial<LatLng> | null;
  return !!q && typeof q.lat === "number" && typeof q.lng === "number" && Math.abs(q.lat) <= 90 && Math.abs(q.lng) <= 180;
}

const whole = (v: unknown) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= SHARE_PRICE_MAX_XOF ? Number(v) : null);

/** A tariff from the backoffice, or null when a price is not a whole number of francs. */
export function cleanTariff(input: ShareTariffInput): ShareTariffInput | null {
  const unlockXof = whole(input?.unlockXof);
  const minuteXof = whole(input?.minuteXof);
  const pauseMinuteXof = whole(input?.pauseMinuteXof);
  const depositXof = whole(input?.depositXof);
  const wrongDropXof = whole(input?.wrongDropXof);
  if (unlockXof === null || minuteXof === null || pauseMinuteXof === null || depositXof === null || wrongDropXof === null) return null;
  return { unlockXof, minuteXof, pauseMinuteXof, depositXof, wrongDropXof, isActive: input.isActive === true };
}

const text = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

/** A vehicle from the backoffice, or null when it cannot be saved. */
export function cleanVehicle(input: ShareVehicleInput): ShareVehicleInput | null {
  if (!SHARE_VEHICLE_KINDS.includes(input?.kind)) return null;
  const name = text(input.name, 60);
  const plate = text(input.plate, 20).toUpperCase();
  if (!name) return null;
  const trackerId = text(input.trackerId, 40) || null;
  if (trackerId && !/^[\w-]{3,40}$/.test(trackerId)) return null;
  const command = (v: unknown) => text(v, 60);
  return {
    kind: input.kind,
    name,
    plate,
    homeStationId: input.homeStationId ? String(input.homeStationId) : null,
    trackerId,
    imei: text(input.imei, 20),
    sim: text(input.sim, 30),
    unlockCommand: command(input.unlockCommand),
    lockCommand: command(input.lockCommand),
    note: text(input.note, 300),
  };
}

export function cleanShareStation(input: ShareStationInput): ShareStationInput | null {
  const radiusM = Number(input?.radiusM);
  const helmets = Number(input?.helmets);
  if (!Number.isInteger(radiusM) || radiusM < SHARE_RADIUS_MIN_M || radiusM > SHARE_RADIUS_MAX_M) return null;
  if (!Number.isInteger(helmets) || helmets < 0 || helmets > 500) return null;
  return { enabled: input.enabled === true, radiusM, helmets };
}
