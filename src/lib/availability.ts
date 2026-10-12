import { distanceMeters, type LatLng } from "./geo";
import type { Reservation, StationView, VehicleType, StationKind } from "./types";

export function offersCharging(kind: StationKind): boolean {
  return kind === "charging" || kind === "both";
}

export function offersSwap(kind: StationKind): boolean {
  return kind === "swap" || kind === "both";
}

/** Charging slots a new rider can still get: free slots minus slots already held by reservations. */
export function availableSlots(station: StationView): number {
  if (!station.status.isOpen || !offersCharging(station.kind)) return 0;
  return Math.max(0, station.status.freeSlots - station.reservedSlots);
}

/** Full swap batteries a new rider can still get. */
export function availableBatteries(station: StationView): number {
  if (!station.status.isOpen || !offersSwap(station.kind)) return 0;
  return Math.max(0, station.status.fullBatteries - station.reservedBatteries);
}

export type Availability = "available" | "limited" | "full" | "closed";

export function stationAvailability(station: StationView): Availability {
  if (!station.status.isOpen) return "closed";
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
    a.distance !== null && b.distance !== null
      ? a.distance - b.distance
      : a.station.name.localeCompare(b.station.name),
  );
  return ranked;
}
