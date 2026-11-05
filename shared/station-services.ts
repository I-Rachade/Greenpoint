import { offersCharging, offersSwap } from "./availability";
import type { Features } from "./features";
import type { StationView } from "./types";

/**
 * Services a station can be unlocked for, one by one (worker/services.ts, migration
 * 0026_station_services.sql). A service is active at a station only while its global
 * switch is on AND the station is unlocked for it (W11): a global switch off always
 * wins, and the Lite version switches parcels and drivers off everywhere (W8).
 *
 *   swap      battery swap point (the station's battery types)
 *   charging  motorbike outlets
 *   ev        electric car chargers
 *   parcels   parcel counter and lockers
 *   drivers   drivers queue at the station and hand parcels over there
 *
 * The station owner (Betreiber) asks for a service, an admin decides; an admin can
 * also switch a service on or off directly. Switching off keeps the old data.
 */
export const STATION_SERVICES = ["swap", "charging", "ev", "parcels", "drivers"] as const;
export type StationService = (typeof STATION_SERVICES)[number];

export function isStationService(value: unknown): value is StationService {
  return typeof value === "string" && (STATION_SERVICES as readonly string[]).includes(value);
}

/** The latest request for a service; null = nobody asked (set up by an admin directly). */
export type ServiceRequestStatus = "pending" | "approved" | "rejected";

/** One service of one station, as the owner panel and the backoffice show it. */
export interface StationServiceInfo {
  stationId: string;
  stationName: string;
  service: StationService;
  /** The station is unlocked for the service. */
  unlocked: boolean;
  status: ServiceRequestStatus | null;
  /** Name, phone or e-mail of who asked last. */
  requestedBy: string | null;
  requestedAt: string | null;
  decidedAt: string | null;
  /** The global switch (parcel module, driver module, Lite version) lets the service run. */
  globalOn: boolean;
  /** globalOn and unlocked: what customers and staff get. */
  active: boolean;
}

/** Global switches per service: swap and motorbike outlets have none; Lite turns off car chargers, parcels and drivers. */
export function globalServices(features: Features): Record<StationService, boolean> {
  return { swap: true, charging: true, ev: features.evChargers, parcels: features.parcels, drivers: features.drivers };
}

/**
 * What a customer sees of a station: only its active services. Returns null when
 * nothing is left to show (the station then stays off the map).
 */
export function customerStation<T extends StationView>(station: T, active: ReadonlySet<StationService>): T | null {
  const swap = offersSwap(station.kind) && active.has("swap");
  const charging = offersCharging(station.kind) && active.has("charging");
  const parcelPoint = active.has("parcels") ? (station.parcelPoint ?? null) : null;
  const evChargers = active.has("ev") ? (station.evChargers ?? []) : [];
  const hadSome = offersSwap(station.kind) || offersCharging(station.kind) || !!station.parcelPoint || !!station.evChargers?.length;
  if (hadSome && !swap && !charging && !parcelPoint && !evChargers.length) return null;
  const kind = swap && charging ? "both" : swap ? "swap" : charging ? "charging" : "parcel";
  return {
    ...station,
    kind,
    batteryTypes: swap ? station.batteryTypes : [],
    parcelPoint,
    evChargers,
  };
}

/** The one state shown for a service of a station (owner panel and backoffice). */
export type ServiceDisplay = "active" | "globalOff" | "pending" | "rejected" | "locked";

export function serviceDisplay(info: Pick<StationServiceInfo, "unlocked" | "globalOn" | "status">): ServiceDisplay {
  if (info.unlocked) return info.globalOn ? "active" : "globalOff";
  if (info.status === "pending") return "pending";
  if (info.status === "rejected") return "rejected";
  return "locked";
}

/** The owner may ask for a service that is neither unlocked nor already waiting for a decision. */
export function canRequest(info: Pick<StationServiceInfo, "unlocked" | "status">): boolean {
  return !info.unlocked && info.status !== "pending";
}
