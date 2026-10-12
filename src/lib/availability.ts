import { distanceMeters, type LatLng } from "./geo";
import { STALE_STATUS_HOURS, type Reservation, type StationView, type VehicleType, type StationKind } from "./types";

export function offersCharging(kind: StationKind): boolean {
  return kind === "charging" || kind === "both";
}

export function offersSwap(kind: StationKind): boolean {
  return kind === "swap" || kind === "both";
}

/**
 * Whether `now` falls inside opening hours written as "07:00-21:00" (Lomé time, which is UTC).
 * Ranges past midnight work; any other text counts as open. Mirrors within_opening_hours() in SQL.
 */
export function withinOpeningHours(hours: string, now: Date = new Date()): boolean {
  const m = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/.exec(hours ?? "");
  if (!m) return true;
  const open = Number(m[1]) * 60 + Number(m[2]);
  const close = Number(m[3]) * 60 + Number(m[4]);
  const t = now.getUTCHours() * 60 + now.getUTCMinutes();
  if (open === close) return true;
  if (open < close) return t >= open && t < close;
  return t >= open || t < close;
}

/** Open according to staff and to the opening hours. */
export function isOpenNow(station: StationView, now: Date = new Date()): boolean {
  return station.status.isOpen && withinOpeningHours(station.openingHours, now);
}

/** True when nobody has reported the station's status for a while, so the numbers may be wrong. */
export function isStale(station: StationView, now: Date = new Date()): boolean {
  return now.getTime() - new Date(station.status.updatedAt).getTime() > STALE_STATUS_HOURS * 3_600_000;
}

/** Charging slots a new rider can still get: free slots minus slots already held by reservations. */
export function availableSlots(station: StationView): number {
  if (!isOpenNow(station) || !offersCharging(station.kind)) return 0;
  return Math.max(0, station.status.freeSlots - station.reservedSlots);
}

/** Full swap batteries a new rider can still get. */
export function availableBatteries(station: StationView): number {
  if (!isOpenNow(station) || !offersSwap(station.kind)) return 0;
  return Math.max(0, station.status.fullBatteries - station.reservedBatteries);
}

export type Availability = "available" | "limited" | "full" | "closed" | "unknown";

export function stationAvailability(station: StationView): Availability {
  if (!isOpenNow(station)) return "closed";
  if (isStale(station)) return "unknown";
  const total = availableSlots(station) + availableBatteries(station);
  if (total === 0) return "full";
  if (total <= 2) return "limited";
  return "available";
}

/** A reservation only holds capacity while it is active and not past its expiry. */
export function isHolding(reservation: Reservation, now: Date = new Date()): boolean {
  return reservation.status === "active" && new Date(reservation.expiresAt) > now;
}

export function countHolding(
  reservations: Reservation[],
  stationId: string,
  now: Date = new Date(),
): { slots: number; batteries: number } {
  let slots = 0;
  let batteries = 0;
  for (const r of reservations) {
    if (r.stationId !== stationId || !isHolding(r, now)) continue;
    if (r.type === "slot") slots++;
    else batteries++;
  }
  return { slots, batteries };
}

export interface StationFilter {
  vehicle: VehicleType | "all";
  service: "all" | "charging" | "swap";
  onlyAvailable: boolean;
}

export const DEFAULT_FILTER: StationFilter = { vehicle: "all", service: "all", onlyAvailable: false };

export function matchesFilter(station: StationView, filter: StationFilter): boolean {
  if (filter.vehicle !== "all" && !station.vehicleTypes.includes(filter.vehicle)) return false;
  if (filter.service === "charging" && !offersCharging(station.kind)) return false;
  if (filter.service === "swap" && !offersSwap(station.kind)) return false;
  if (filter.onlyAvailable) {
    if (filter.service === "charging") return availableSlots(station) > 0;
    if (filter.service === "swap") return availableBatteries(station) > 0;
    return availableSlots(station) + availableBatteries(station) > 0;
  }
  return true;
}

export interface RankedStation {
  station: StationView;
  distance: number | null;
}

/** Filters stations and sorts them nearest-first (alphabetically when the position is unknown). */
export function rankStations(
  stations: StationView[],
  position: LatLng | null,
  filter: StationFilter,
): RankedStation[] {
  const ranked = stations
    .filter((s) => matchesFilter(s, filter))
    .map((station) => ({
      station,
      distance: position ? distanceMeters(position, station) : null,
    }));
  ranked.sort((a, b) =>
    Number(isStale(a.station)) - Number(isStale(b.station)) ||
    (a.distance !== null && b.distance !== null
      ? a.distance - b.distance
      : a.station.name.localeCompare(b.station.name)),
  );
  return ranked;
}
