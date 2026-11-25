// The Activity tab of My stations (operator accounts, migration 0070): everything that happened at
// the operator's stations, newest first. Two sources, merged by time:
// - station_actions (0033): each action the staff, an owner or an admin did at the station
//   (swap, counter, status, charging, parcels, …), as "METHOD /api/stations/:station/…";
// - audit_log: each change with its details (a swap corrected or deleted, opening hours and
//   prices, staff, cash handovers, reservations), only for the station tables below.
// Worker: worker/owner-activity.ts. Demo: src/lib/backend/demo.ts. UI: src/components/owner/activity.tsx.

import type { StationRole } from "./station-work";

/** Rows per page. */
export const ACTIVITY_PAGE = 50;

export const ACTIVITY_KINDS = ["swaps", "stock", "status", "staff", "cash", "other"] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];

/** Audit tables an operator account sees, with the kind they belong to. */
export const ACTIVITY_TABLES: Record<string, ActivityKind> = {
  swap_log: "swaps",
  station_status: "status",
  stations: "status",
  station_services: "status",
  station_staff: "staff",
  staff_invites: "staff",
  cash_handovers: "cash",
  reservations: "other",
  charging_sessions: "other",
};

/** The kind of a station action, from its route ("POST /api/stations/:station/swaps"). */
export function actionKind(action: string): ActivityKind {
  const path = action.split(" ")[1] ?? "";
  if (/\/swaps(\/|$)/.test(path)) return "swaps";
  if (/\/battery-events(\/|$)/.test(path)) return "stock";
  if (/\/status$/.test(path)) return "status";
  if (/\/(green-credit|cash)(\/|$)/.test(path)) return "cash";
  return "other";
}

/** The route of a station action without method and station: "swaps", "charging/:id/stop", … */
export function actionPath(action: string): string {
  const path = action.split(" ")[1] ?? "";
  return path
    .replace(/^\/api\/stations\/:station\/?/, "")
    .replace(/^\/api\//, "")
    .split("/")
    .map((part) => (/^[0-9a-f-]{8,}$/i.test(part) || /^GP-/i.test(part) ? ":id" : part))
    .join("/");
}

/** Keys of a change an operator account never sees (contact data, codes). */
export const HIDDEN_CHANGE_KEYS = /phone|email|contact|pin|code|token|hash|secret/i;

export interface ActivityEntry {
  /** "a<id>" for a station action, "c<id>" for a change. */
  id: string;
  at: string;
  stationId: string;
  stationName: string;
  /** Who did it: a name, a phone number, or "" for an admin (shown as poinderecharge) or the system. */
  person: string;
  role: StationRole | null;
  kind: ActivityKind;
  /** Station action: its path, see actionPath(). */
  action?: string;
  /** Change: the table and what was done, with the changed values (update: [old, new]). */
  table?: string;
  change?: "insert" | "update" | "delete";
  changes?: Record<string, unknown>;
}

export interface ActivityFilter {
  stationId?: string | null;
  kind?: ActivityKind | null;
  /** Only entries before this time (next page). */
  before?: string | null;
}

export interface ActivityPage {
  entries: ActivityEntry[];
  /** Pass as `before` for the next page; null = no more. */
  next: string | null;
}

/** Changed values without contact data, for an operator account. */
export function visibleChanges(changes: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(changes).filter(([k]) => !HIDDEN_CHANGE_KEYS.test(k)));
}

/** A battery number seen at a station over a period: how often it went out and came back. */
export interface UsedSerial {
  serial: string;
  brand: string;
  out: number;
  in: number;
  lastAt: string;
}
