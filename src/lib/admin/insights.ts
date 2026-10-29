import { isHolding } from "@shared/availability";
import { RESERVATION_MINUTES, type Reservation, type ReservationStatus, type UserRole } from "@shared/types";
import type { AdminSnapshot, AdminStation, ChargingPointInfo } from "@shared/admin/types";

/** A status nobody has confirmed for this long is treated as uncertain. */
export const STALE_STATUS_HOURS = 2;
/** Same rule as the app and live_free_points(): a socket silent this long is offline. */
export const DEVICE_SILENT_MINUTES = 15;
/** Reservations by one customer within 24 hours before we flag it (cancel/re-reserve loops). */
export const REPEAT_RESERVATIONS_PER_DAY = 3;
/** Missed reservations (expired without showing up) within 7 days before we flag the customer. */
export const NO_SHOWS_PER_WEEK = 2;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** What a reservation really is now: an active one past its expiry counts as expired. */
export function effectiveReservationStatus(r: Reservation, now: Date): ReservationStatus {
  return r.status === "active" && !isHolding(r, now) ? "expired" : r.status;
}

export function statusAgeHours(station: AdminStation, now: Date): number {
  return (now.getTime() - new Date(station.status.updatedAt).getTime()) / HOUR;
}

export function isDeviceSilent(point: ChargingPointInfo, now: Date): boolean {
  if (!point.deviceId) return false;
  if (!point.lastSeenAt) return true;
  return now.getTime() - new Date(point.lastSeenAt).getTime() > DEVICE_SILENT_MINUTES * 60_000;
}

export interface Kpis {
  stationsActive: number;
  stationsInactive: number;
  stationsOpen: number;
  stationsStale: number;
  usersTotal: number;
  usersByRole: Record<UserRole, number>;
  usersNew7d: number;
  usersActive7d: number;
  holdingNow: number;
  reservations24h: number;
  reservations7d: number;
  /** Share of last-7-day reservations that ended without the customer showing up (0..1), null if none ended. */
  noShowRate7d: number | null;
  /** Share that were completed (0..1), null if none ended. */
  completionRate7d: number | null;
  connectedPoints: number;
  silentPoints: number;
}

export function computeKpis(snap: AdminSnapshot, now: Date): Kpis {
  const t = now.getTime();
  const active = snap.stations.filter((s) => s.isActive);
  const usersByRole: Record<UserRole, number> = { customer: 0, operator: 0, fleet_manager: 0, admin: 0, driver: 0, merchant: 0 };
  for (const u of snap.users) usersByRole[u.role]++;

  const week = snap.reservations.filter((r) => t - new Date(r.createdAt).getTime() < 7 * DAY);
  let ended = 0;
  let noShows = 0;
  let completed = 0;
  for (const r of week) {
    const status = effectiveReservationStatus(r, now);
    if (status === "active") continue;
    ended++;
    if (status === "expired") noShows++;
    if (status === "completed") completed++;
  }
  const connected = snap.chargingPoints.filter((p) => p.deviceId);

  return {
    stationsActive: active.length,
    stationsInactive: snap.stations.length - active.length,
    stationsOpen: active.filter((s) => s.status.isOpen).length,
    // A parcel point has no counters to confirm.
    stationsStale: active.filter((s) => s.kind !== "parcel" && s.status.isOpen && statusAgeHours(s, now) >= STALE_STATUS_HOURS).length,
    usersTotal: snap.users.length,
    usersByRole,
    usersNew7d: snap.users.filter((u) => t - new Date(u.createdAt).getTime() < 7 * DAY).length,
    usersActive7d: snap.users.filter((u) => u.lastSignInAt && t - new Date(u.lastSignInAt).getTime() < 7 * DAY).length,
    holdingNow: snap.reservations.filter((r) => isHolding(r, now)).length,
    reservations24h: snap.reservations.filter((r) => t - new Date(r.createdAt).getTime() < DAY).length,
    reservations7d: week.length,
    noShowRate7d: ended ? noShows / ended : null,
    completionRate7d: ended ? completed / ended : null,
    connectedPoints: connected.length,
    silentPoints: connected.filter((p) => isDeviceSilent(p, now)).length,
  };
}

export interface DayCount {
  /** Local date, YYYY-MM-DD. */
  day: string;
  total: number;
  completed: number;
  noShows: number;
}

function localDay(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Reservations per day for the last `days` days (oldest first), for the dashboard chart. */
export function reservationsPerDay(reservations: Reservation[], now: Date, days = 14): DayCount[] {
  const buckets = new Map<string, DayCount>();
  for (let i = days - 1; i >= 0; i--) {
    const day = localDay(new Date(now.getTime() - i * DAY));
    buckets.set(day, { day, total: 0, completed: 0, noShows: 0 });
  }
  for (const r of reservations) {
    const bucket = buckets.get(localDay(new Date(r.createdAt)));
    if (!bucket) continue;
    bucket.total++;
    const status = effectiveReservationStatus(r, now);
    if (status === "completed") bucket.completed++;
    if (status === "expired") bucket.noShows++;
  }
  return [...buckets.values()];
}

export type FindingKind =
  | "closed_with_reservations"
  | "long_hold"
  | "silent_device"
  | "point_fault"
  | "stale_status"
  | "over_capacity"
  | "repeat_reserver"
  | "no_show"
  | "station_without_staff"
  | "operator_without_station"
  | "staff_without_role"
  | "lapsed_still_active";

export type Severity = "high" | "medium" | "low";

export interface Finding {
  kind: FindingKind;
  severity: Severity;
  stationId?: string;
  userId?: string;
  /** Number shown in the message (reservations, hours, points…). */
  count?: number;
}

const SEVERITY: Record<FindingKind, Severity> = {
  closed_with_reservations: "high",
  long_hold: "high",
  silent_device: "high",
  point_fault: "high",
  stale_status: "medium",
  over_capacity: "medium",
  repeat_reserver: "medium",
  no_show: "medium",
  station_without_staff: "low",
  operator_without_station: "low",
  staff_without_role: "low",
  lapsed_still_active: "low",
};

const ORDER: Severity[] = ["high", "medium", "low"];

/** Things an admin should look at, most urgent first. */
export function findAnomalies(snap: AdminSnapshot, now: Date): Finding[] {
  const t = now.getTime();
  const out: Finding[] = [];
  const add = (f: Omit<Finding, "severity">) => out.push({ ...f, severity: SEVERITY[f.kind] });
  const activeStations = snap.stations.filter((s) => s.isActive);

  for (const s of activeStations) {
    const holding = snap.reservations.filter((r) => r.stationId === s.id && isHolding(r, now)).length;
    if (!s.status.isOpen && holding > 0) add({ kind: "closed_with_reservations", stationId: s.id, count: holding });
    const age = statusAgeHours(s, now);
    if (s.kind !== "parcel" && s.status.isOpen && age >= STALE_STATUS_HOURS) add({ kind: "stale_status", stationId: s.id, count: Math.floor(age) });
    const typeOver = (s.batteryTypes ?? []).some((bt) => (bt.capacity ?? 0) > 0 && bt.fullBatteries > bt.capacity);
    if (s.status.freeSlots > s.chargingSlots || s.status.fullBatteries > s.batteryCapacity || typeOver) {
      add({ kind: "over_capacity", stationId: s.id });
    }
    if (s.isOwn && !snap.staff.some((a) => a.stationId === s.id)) add({ kind: "station_without_staff", stationId: s.id });
  }

  // Holding far longer than the normal reservation time means someone extended it by hand.
  for (const r of snap.reservations) {
    const minutes = (new Date(r.expiresAt).getTime() - new Date(r.createdAt).getTime()) / 60_000;
    if (isHolding(r, now) && minutes > RESERVATION_MINUTES + 1) {
      add({ kind: "long_hold", stationId: r.stationId, userId: r.userId, count: Math.round(minutes) });
    }
  }

  const silentByStation = new Map<string, number>();
  for (const p of snap.chargingPoints) {
    if (isDeviceSilent(p, now)) silentByStation.set(p.stationId, (silentByStation.get(p.stationId) ?? 0) + 1);
    if (p.status === "fault") add({ kind: "point_fault", stationId: p.stationId, count: 1 });
  }
  for (const [stationId, count] of silentByStation) add({ kind: "silent_device", stationId, count });

  const perUserDay = new Map<string, number>();
  const noShows = new Map<string, number>();
  let lapsed = 0;
  for (const r of snap.reservations) {
    const age = t - new Date(r.createdAt).getTime();
    if (age < DAY) perUserDay.set(r.userId, (perUserDay.get(r.userId) ?? 0) + 1);
    if (age < 7 * DAY && effectiveReservationStatus(r, now) === "expired") {
      noShows.set(r.userId, (noShows.get(r.userId) ?? 0) + 1);
    }
    if (r.status === "active" && !isHolding(r, now)) lapsed++;
  }
  for (const [userId, count] of perUserDay) {
    if (count >= REPEAT_RESERVATIONS_PER_DAY) add({ kind: "repeat_reserver", userId, count });
  }
  for (const [userId, count] of noShows) {
    if (count >= NO_SHOWS_PER_WEEK) add({ kind: "no_show", userId, count });
  }
  if (lapsed > 0) add({ kind: "lapsed_still_active", count: lapsed });

  const assigned = new Set(snap.staff.map((a) => a.userId));
  for (const u of snap.users) {
    if (u.role === "operator" && !assigned.has(u.id)) add({ kind: "operator_without_station", userId: u.id });
    if (u.role === "customer" && assigned.has(u.id)) add({ kind: "staff_without_role", userId: u.id });
  }

  return out.sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity));
}
