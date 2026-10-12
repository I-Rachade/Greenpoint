import type { Profile, Reservation, StationView } from "../types";

/** A station as the backoffice sees it, including deactivated ones. */
export interface AdminStation extends StationView {
  isActive: boolean;
}

export interface AdminUser extends Profile {
  createdAt: string;
  lastSignInAt: string | null;
}

export interface StaffAssignment {
  stationId: string;
  userId: string;
}

export type ChargingPointState = "free" | "reserved" | "charging" | "done" | "fault";

export interface ChargingPointInfo {
  id: string;
  stationId: string;
  label: string;
  status: ChargingPointState;
  /** Hardware id of a connected socket; null for a manual point. */
  deviceId: string | null;
  lastSeenAt: string | null;
}

/** Everything the dashboard needs, loaded in one go. */
export interface AdminSnapshot {
  stations: AdminStation[];
  users: AdminUser[];
  staff: StaffAssignment[];
  /** Reservations of the last `ADMIN_HISTORY_DAYS` days, newest first. */
  reservations: Reservation[];
  chargingPoints: ChargingPointInfo[];
}

export const ADMIN_HISTORY_DAYS = 30;

export type AuditTable =
  | "profiles"
  | "operators"
  | "stations"
  | "station_status"
  | "station_staff"
  | "reservations"
  | "charging_points"
  | "promotions"
  | "payments"
  | "parcels"
  | "parcel_depots"
  | "parcel_sizes"
  | "drivers"
  | "fleet_vehicles"
  | "delivery_jobs"
  | "driver_ledger"
  | "driver_settings";

export const AUDIT_TABLES: AuditTable[] = [
  "reservations",
  "station_status",
  "stations",
  "station_staff",
  "profiles",
  "charging_points",
  "operators",
  "promotions",
  "payments",
  "parcels",
  "parcel_depots",
  "parcel_sizes",
  "drivers",
  "fleet_vehicles",
  "delivery_jobs",
  "driver_ledger",
  "driver_settings",
];

export type AuditAction = "insert" | "update" | "delete";

/** One row of the activity log (written by the Worker, see worker/api.ts). */
export interface AuditEntry {
  id: number;
  at: string;
  /** Who made the change; null = system (device, SQL editor). */
  actorId: string | null;
  table: AuditTable;
  action: AuditAction;
  rowId: string;
  stationId: string | null;
  userId: string | null;
  /** Update: `{column: [old, new]}`. Insert/delete: the row. */
  changes: Record<string, unknown>;
}

export interface AuditFilter {
  table?: AuditTable;
  actorId?: string;
  stationId?: string;
  /** Only entries older than this id (for "load more"). */
  beforeId?: number;
  limit?: number;
}
