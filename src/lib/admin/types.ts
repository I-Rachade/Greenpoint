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

/** Days of reservations the snapshot carries (dashboard figures and chart); the table pages through ADMIN_HISTORY_DAYS. */
export const SNAPSHOT_RESERVATION_DAYS = 14;

/** GET /api/admin/reservations: one page of the reservations table, filtered on the server. */
export interface AdminReservationQuery {
  /** As effectiveReservationStatus: an active reservation past its expiry counts as expired. */
  status?: Reservation["status"] | null;
  stationId?: string | null;
  /** Part of the customer's name, phone number or e-mail address. */
  search?: string | null;
  offset?: number;
  limit?: number;
}

export interface AdminReservationPage {
  rows: Reservation[];
  /** All matching rows, for "x–y of total". */
  total: number;
}

export const ADMIN_PAGE_SIZE = 50;

export type AuditTable =
  | "profiles"
  | "operators"
  | "stations"
  | "station_status"
  | "station_staff"
  | "operator_owners"
  | "reservations"
  | "charging_points"
  | "promotions"
  | "payments"
  | "parcels"
  | "parcel_depots"
  | "parcel_sizes"
  | "parcel_runs"
  | "drivers"
  | "fleet_vehicles"
  | "delivery_jobs"
  | "driver_ledger"
  | "driver_settings"
  | "partners"
  | "partner_api_keys"
  | "partner_bookings"
  | "wallets"
  | "fleet_manager_drivers"
  | "fleets"
  | "fleet_invites"
  | "battery_types"
  | "ev_chargers"
  | "charging_sessions"
  | "station_services"
  | "settings";

export const AUDIT_TABLES: AuditTable[] = [
  "reservations",
  "station_status",
  "stations",
  "station_services",
  "station_staff",
  "operator_owners",
  "profiles",
  "charging_points",
  "charging_sessions",
  "operators",
  "promotions",
  "payments",
  "parcels",
  "parcel_depots",
  "parcel_sizes",
  "parcel_runs",
  "battery_types",
  "ev_chargers",
  "drivers",
  "fleet_vehicles",
  "delivery_jobs",
  "driver_ledger",
  "driver_settings",
  "fleet_manager_drivers",
  "fleets",
  "fleet_invites",
  "partners",
  "partner_api_keys",
  "partner_bookings",
  "wallets",
  "settings",
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
