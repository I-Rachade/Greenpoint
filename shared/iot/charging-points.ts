import type { ChargingPoint } from "../types";

/** A connected point that has not reported for this long is shown as offline. */
export const DEVICE_OFFLINE_MINUTES = 15;

export type ChargingPointDisplay = ChargingPoint["status"] | "offline";

export function isConnected(point: ChargingPoint): boolean {
  return point.deviceId !== null;
}

export function isOffline(point: ChargingPoint, now: Date = new Date()): boolean {
  if (!isConnected(point)) return false;
  if (!point.lastSeenAt) return true;
  return now.getTime() - new Date(point.lastSeenAt).getTime() > DEVICE_OFFLINE_MINUTES * 60_000;
}

export function displayStatus(point: ChargingPoint, now: Date = new Date()): ChargingPointDisplay {
  return isOffline(point, now) ? "offline" : point.status;
}

/** Free connected points that are currently reporting. */
export function freeConnectedPoints(points: ChargingPoint[], now: Date = new Date()): number {
  return points.filter((p) => isConnected(p) && p.status === "free" && !isOffline(p, now)).length;
}
