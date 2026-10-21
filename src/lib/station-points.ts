import type { ParcelDepot, ParcelDepotInput } from "./parcels";
import type { StationKind, StationView } from "./types";

// What a station offers. Each part is optional and they combine freely:
// - battery swap point: swap batteries, counted by staff (battery capacity)
// - battery charging point: the station's connected sockets, one place per outlet
// - parcel counter: staff take in and hand out parcels
// - parcel lockers: compartments a recipient opens with a code
// A station needs at least one of them. Migration 0013_station_points.sql.

export interface StationPoints {
  swap: boolean;
  charging: boolean;
  parcelCounter: boolean;
  parcelLockers: boolean;
}

export type StationPoint = keyof StationPoints;
export const STATION_POINTS: StationPoint[] = ["swap", "charging", "parcelCounter", "parcelLockers"];

/** The kind stored for a station that swaps and/or charges batteries; "parcel" when it does neither. */
export function kindFor(swap: boolean, charging: boolean): StationKind {
  if (swap && charging) return "both";
  if (swap) return "swap";
  if (charging) return "charging";
  return "parcel";
}

/** Parcel parts of an active depot; none for an inactive or missing one. */
export function depotPoints(depot: Pick<ParcelDepot, "isActive" | "counter" | "lockers"> | ParcelDepotInput | null | undefined) {
  const active = !!depot?.isActive;
  return {
    parcelCounter: active && (depot?.counter ?? true),
    parcelLockers: active && (depot?.lockers ?? 0) > 0,
  };
}

export function pointsOf(station: Pick<StationView, "kind" | "parcelPoint">): StationPoints {
  return {
    swap: station.kind === "swap" || station.kind === "both",
    charging: station.kind === "charging" || station.kind === "both",
    parcelCounter: !!station.parcelPoint?.counter,
    parcelLockers: (station.parcelPoint?.lockers ?? 0) > 0,
  };
}

export function hasAnyPoint(points: StationPoints): boolean {
  return STATION_POINTS.some((p) => points[p]);
}

/** Whether the station takes or hands out parcels. */
export function offersParcels(station: Pick<StationView, "parcelPoint">): boolean {
  const p = station.parcelPoint;
  return !!p && (p.counter || p.lockers > 0);
}
