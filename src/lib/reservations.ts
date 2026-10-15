import { isHolding } from "./availability";
import { displayStatus, isConnected } from "./iot/charging-points";
import type { Reservation, ReservationType, StationView } from "./types";
import type { StationBatteryType } from "./battery-types";

// Reservation by type (plan phase 4, migration 0029_reservation_kind.sql).
//
// A reservation names what it holds:
//   kind "swap"            target = the battery type (null at a station without types)
//   kind "charging_point"  target = a connected motorbike outlet (charging_points.id) or a
//                          car charger (ev_chargers.id); null = a free place counted by the
//                          staff, at a station without connected outlets.
// Holding never changes the battery counter (station-work.ts): what can be reserved is the
// full batteries of the type minus the active swap reservations of that type, and the swap
// that hands the battery out (counter −1) completes the reservation in the same step.
// The server (worker/api.ts reserve(), worker/reservations.ts) and the demo backend check the same.

export type ReservationKind = "swap" | "charging_point";

/** What the target of a reservation is, for labels and the staff's jump into the right flow. */
export type ReservationTargetKind = "battery_type" | "outlet" | "ev" | "place";

export function isReservationKind(value: unknown): value is ReservationKind {
  return value === "swap" || value === "charging_point";
}

/** The kind a request means: the new kind, or the older type ("battery", "slot") the app sent before. */
export function kindFrom(value: unknown): ReservationKind | null {
  if (isReservationKind(value)) return value;
  if (value === "battery") return "swap";
  if (value === "slot") return "charging_point";
  return null;
}

/** The older type column, kept in step with the kind. */
export function typeOfKind(kind: ReservationKind): ReservationType {
  return kind === "swap" ? "battery" : "slot";
}

/** The kind of a reservation, also for rows saved before kinds existed. */
export function reservationKind(r: Pick<Reservation, "type"> & { kind?: ReservationKind }): ReservationKind {
  return r.kind ?? (r.type === "battery" ? "swap" : "charging_point");
}

/** Wrong pickup codes a reservation takes before it is locked, and for how long (as parcels). */
export const RESERVATION_MAX_CODE_FAILURES = 5;
export const RESERVATION_CODE_LOCK_MINUTES = 15;

/** Full batteries of the type that no reservation holds. */
export function freeOfType(t: Pick<StationBatteryType, "fullBatteries"> & { reserved?: number }): number {
  return Math.max(0, t.fullBatteries - (t.reserved ?? 0));
}

/**
 * Battery types a customer can reserve now: active, with a full battery nobody holds.
 * With a brand chosen in the station filter, only that brand's types (when the station
 * swaps that brand; otherwise every type, so the list is never empty by mistake).
 */
export function reservableTypes(station: Pick<StationView, "batteryTypes">, brand?: string | null): StationBatteryType[] {
  const types = (station.batteryTypes ?? []).filter((t) => t.isActive && freeOfType(t) > 0);
  if (!brand || brand === "all" || !types.some((t) => t.brand === brand)) return types;
  return types.filter((t) => t.brand === brand);
}

/** Connected motorbike outlets a customer can reserve now: online, free and not held by a reservation. */
export function reservableOutlets(station: Pick<StationView, "chargingPoints">, now: Date = new Date()) {
  return (station.chargingPoints ?? []).filter((p) => isConnected(p) && displayStatus(p, now) === "free" && !p.reserved);
}

/** Car chargers a customer can reserve now (no reservation holds them). */
export function reservableEvChargers(station: Pick<StationView, "evChargers">) {
  return (station.evChargers ?? []).filter((c) => !c.reserved);
}

/** Active reservations holding each target of a station, for the station list (`reserved` counts). */
export function heldTargets(reservations: Reservation[], stationId: string, now: Date = new Date()): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of reservations) {
    if (r.stationId !== stationId || !isHolding(r, now) || !r.target) continue;
    const key = `${reservationKind(r)}:${r.target}`;
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return out;
}

/** Where staff continue with a reservation: the swap form, or the charging page with its outlets. */
export function staffFlowHref(r: Pick<Reservation, "id" | "type"> & { kind?: ReservationKind }): string {
  return `${reservationKind(r) === "swap" ? "/operator/echange" : "/operator/recharge"}?reservation=${encodeURIComponent(r.id)}`;
}
