import { distanceMeters, type LatLng } from "./geo";
import { freeConnectedPoints, isConnected } from "./iot/charging-points";
import { brandFullBatteries, stationBrands } from "./battery-types";
import { chargesEvs } from "./ev-chargers";
import { offersParcels } from "./station-points";
import { STALE_STATUS_HOURS, type Reservation, type StationView, type VehicleType, type StationKind } from "./types";
import { openAt, parseOpeningHours } from "./opening-hours";

export function offersCharging(kind: StationKind): boolean {
  return kind === "charging" || kind === "both";
}

export function offersSwap(kind: StationKind): boolean {
  return kind === "swap" || kind === "both";
}

/**
 * Whether `now` falls inside the opening hours (src/lib/opening-hours.ts: "07:00-21:00",
 * "Mo-Sa 07:00-21:00", Lomé time = UTC). Ranges past midnight work; any other text counts as open.
 */
export function withinOpeningHours(hours: string, now: Date = new Date()): boolean {
  const h = parseOpeningHours(hours);
  return h ? openAt(h, now) : true;
}

/** Open according to staff and to the opening hours. */
export function isOpenNow(station: StationView, now: Date = new Date()): boolean {
  return station.status.isOpen && withinOpeningHours(station.openingHours, now);
}

/** True when nobody has reported the station's status for a while, so the numbers may be wrong. */
export function isStale(station: StationView, now: Date = new Date()): boolean {
  return now.getTime() - new Date(station.status.updatedAt).getTime() > STALE_STATUS_HOURS * 3_600_000;
}

/**
 * Charging slots a new customer can still get: free slots minus slots already held by reservations.
 * Stations with connected sockets count their reporting free outlets instead, so a socket
 * that went silent is not offered.
 */
export function availableSlots(station: StationView, now: Date = new Date()): number {
  if (!isOpenNow(station, now) || !offersCharging(station.kind)) return 0;
  const points = station.chargingPoints ?? [];
  const free = points.some(isConnected) ? freeConnectedPoints(points, now) : station.status.freeSlots;
  return Math.max(0, free - station.reservedSlots);
}

/**
 * Full swap batteries in stock and not held by reservations, open or not, for display:
 * it matches the counts per battery type. Opening hours are shown by the availability badge.
 */
export function stockBatteries(station: StationView): number {
  if (!offersSwap(station.kind)) return 0;
  return Math.max(0, station.status.fullBatteries - station.reservedBatteries);
}

/** Full swap batteries a new customer can still get (none while the station is closed). */
export function availableBatteries(station: StationView): number {
  return isOpenNow(station) ? stockBatteries(station) : 0;
}

export type Availability = "available" | "limited" | "full" | "closed" | "unknown";

export function stationAvailability(station: StationView): Availability {
  if (!isOpenNow(station)) return "closed";
  // A parcel point has no counts to go stale or run out.
  if (station.kind === "parcel") return "available";
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
    // A car charger's hold is not a motorbike place (src/lib/reservations.ts).
    const kind = r.kind ?? (r.type === "battery" ? "swap" : "charging_point");
    if (kind === "swap") batteries++;
    else if (r.targetKind !== "ev") slots++;
  }
  return { slots, batteries };
}

export interface StationFilter {
  vehicle: VehicleType | "all";
  /** "ev": stations that charge electric cars. */
  service: "all" | "charging" | "swap" | "parcel" | "ev";
  /** Brand of swap battery the rider needs; "all" = any. */
  brand?: string;
  onlyAvailable: boolean;
}

export const DEFAULT_FILTER: StationFilter = { vehicle: "all", service: "all", onlyAvailable: false };

export function matchesFilter(station: StationView, filter: StationFilter): boolean {
  // Electric cars: the station needs a charger; the two-wheeler vehicle types and battery brands do not apply.
  if (filter.service === "ev") return chargesEvs(station) && (!filter.onlyAvailable || isOpenNow(station));
  if (filter.vehicle !== "all" && !station.vehicleTypes.includes(filter.vehicle)) return false;
  if (filter.service === "charging" && !offersCharging(station.kind)) return false;
  if (filter.service === "swap" && !offersSwap(station.kind)) return false;
  if (filter.service === "parcel") return offersParcels(station) && (!filter.onlyAvailable || isOpenNow(station));
  // A brand only concerns battery swap: the station must also swap that brand's batteries.
  if (filter.brand && filter.brand !== "all") {
    if (!stationBrands(station).includes(filter.brand)) return false;
    // Counted per type by the staff: a station out of this brand's batteries is not available for it.
    if (filter.onlyAvailable) return availableBatteries(station) > 0 && brandFullBatteries(station, filter.brand) > 0;
    return true;
  }
  if (filter.onlyAvailable) {
    if (filter.service === "charging") return availableSlots(station) > 0;
    if (filter.service === "swap") return availableBatteries(station) > 0;
    if (station.kind === "parcel") return isOpenNow(station);
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
