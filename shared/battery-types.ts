import type { StationView } from "./types";

// Battery types: each motorbike brand (battery operator) has its own swap
// batteries. A station's swap point swaps some of them; a swap point with no type
// listed says nothing. Charging needs no type: the sockets take any battery.
// Migration 0017_battery_types.sql.

export interface BatteryType {
  id: string;
  /** Motorbike brand or battery operator, e.g. "Spiro". */
  brand: string;
  /** Model, e.g. "72V 40Ah". */
  name: string;
  isActive: boolean;
}

/** A type a station swaps, with how many of its batteries are full there. */
export interface StationBatteryType extends BatteryType {
  fullBatteries: number;
  /** Places for this type's batteries at the station (backoffice, migration 0064); 0 = not set. */
  capacity: number;
  /** Station list only: full batteries of this type held by active reservations (shared/reservations.ts). */
  reserved?: number;
}

export interface BatteryTypeInput {
  brand: string;
  name: string;
  isActive: boolean;
}

/** Most places one battery type can have at a station. */
export const TYPE_CAPACITY_MAX = 10_000;

/** A battery type's places as typed in the backoffice: a whole number 0…TYPE_CAPACITY_MAX, else 0. */
export function cleanTypeCapacity(raw: unknown): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > 0 ? Math.min(n, TYPE_CAPACITY_MAX) : 0;
}

/** The station's places: the sum of its types' places when it lists types, else its one number. */
export function totalCapacity(types: { capacity: number }[], stationCapacity: number): number {
  return types.length ? types.reduce((n, t) => n + t.capacity, 0) : stationCapacity;
}

/**
 * The limit a "full" tap on one counter must stay within (applyBatteryEvent in station-work.ts):
 * the type's own places when set, else the station's places for all its batteries together.
 */
export function counterLimits(
  rows: { batteryTypeId: string; full: number; capacity: number }[],
  key: string,
  stationCapacity: number,
): { total: number; capacity: number } {
  const row = rows.find((r) => r.batteryTypeId === key);
  if (key !== "" && row && row.capacity > 0) return { total: row.full, capacity: row.capacity };
  return { total: rows.reduce((n, r) => n + r.full, 0), capacity: stationCapacity };
}

export function batteryTypeLabel(t: Pick<BatteryType, "brand" | "name">): string {
  return `${t.brand} ${t.name}`;
}

export function validBatteryType(input: BatteryTypeInput): boolean {
  const brand = String(input?.brand ?? "").trim();
  const name = String(input?.name ?? "").trim();
  return brand.length >= 1 && brand.length <= 60 && name.length >= 1 && name.length <= 80;
}

/** Brands whose batteries the station swaps. */
export function stationBrands(station: Pick<StationView, "batteryTypes">): string[] {
  return [...new Set((station.batteryTypes ?? []).map((t) => t.brand))];
}

/** Full batteries of one brand at the station. */
export function brandFullBatteries(station: Pick<StationView, "batteryTypes">, brand: string): number {
  return (station.batteryTypes ?? []).filter((t) => t.brand === brand).reduce((n, t) => n + t.fullBatteries, 0);
}

/** Every brand swapped at any of the stations, sorted, for the app's filter. */
export function allBrands(stations: Pick<StationView, "batteryTypes">[]): string[] {
  return [...new Set(stations.flatMap((s) => stationBrands(s)))].sort((a, b) => a.localeCompare(b));
}

/** Types grouped by brand, brands and models sorted. */
export function groupByBrand<T extends Pick<BatteryType, "brand" | "name">>(types: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const t of [...types].sort((a, b) => a.brand.localeCompare(b.brand) || a.name.localeCompare(b.name))) {
    groups.set(t.brand, [...(groups.get(t.brand) ?? []), t]);
  }
  return [...groups];
}
