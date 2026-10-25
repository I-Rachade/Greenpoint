import { RESERVATION_MINUTES, type Reservation, type ReservationStatus, type ReservationType } from "@shared/types";
import type { AdminUser, StaffAssignment } from "@shared/admin/types";

// Example users and history for the backoffice in demo mode. The ids
// `demo-<role>` are the ones the demo login uses (see DemoBackend.verifyCode).

export function demoUsers(now: Date): AdminUser[] {
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  return [
    { id: "demo-admin", phone: "+22890000001", email: null, fullName: "Admin démo", role: "admin", createdAt: daysAgo(60), lastSignInAt: null },
    { id: "demo-operator", phone: "+22890000002", email: null, fullName: "Kossi (Grand Marché)", role: "operator", createdAt: daysAgo(45), lastSignInAt: daysAgo(0.2) },
    { id: "demo-operator-2", phone: "+22890000003", email: null, fullName: "Afi", role: "operator", createdAt: daysAgo(20), lastSignInAt: daysAgo(9) },
    { id: "demo-customer", phone: "+22890000004", email: null, fullName: null, role: "customer", createdAt: daysAgo(30), lastSignInAt: daysAgo(1) },
    { id: "demo-u1", phone: "+22891111111", email: null, fullName: "Yao", role: "customer", createdAt: daysAgo(25), lastSignInAt: daysAgo(0.1) },
    { id: "demo-u2", phone: "+22892222222", email: null, fullName: null, role: "customer", createdAt: daysAgo(12), lastSignInAt: daysAgo(2) },
    { id: "demo-u3", phone: "+22893333333", email: null, fullName: "Ama", role: "customer", createdAt: daysAgo(3), lastSignInAt: daysAgo(0.5) },
    { id: "demo-fleet_manager", phone: "+22890000005", email: null, fullName: "Flotte Express", role: "fleet_manager", createdAt: daysAgo(8), lastSignInAt: null },
    { id: "demo-merchant", phone: "+22890000006", email: null, fullName: "Boutique Akwaba", role: "merchant", createdAt: daysAgo(15), lastSignInAt: null },
  ];
}

/** Staff work at exactly one station (W2, migration 0033): Kossi keeps the Grand Marché. */
export const DEMO_STAFF: StaffAssignment[] = [{ stationId: "st-grand-marche", userId: "demo-operator" }];

/** Afi owns the operator poinderecharge (operator_owners): its stations have someone there. */
export const DEMO_OWNERS: { operatorId: string; userId: string }[] = [{ operatorId: "op-poinderecharge", userId: "demo-operator-2" }];

/**
 * His other former stations, as migration 0033 lists them for the owner to re-staff
 * (staff_reassignments). Kossi was last seen at the Grand Marché.
 */
export function demoReassignments(now: Date): { id: string; userId: string; stationId: string; operatorId: string; createdAt: string; resolvedAt: string | null }[] {
  const at = new Date(now.getTime() - 86_400_000).toISOString();
  return ["st-tokoin", "st-universite", "st-be", "st-agoe"].map((stationId) => ({
    id: `reassign-${stationId}`,
    userId: "demo-operator",
    stationId,
    operatorId: "op-poinderecharge",
    createdAt: at,
    resolvedAt: null,
  }));
}

/** Past reservations over the last two weeks, including a customer who never shows up. */
export function demoHistory(now: Date): Reservation[] {
  const rows: [string, string, ReservationType, ReservationStatus, number][] = [
    // user, station, type, status, hours ago
    ["demo-u1", "st-grand-marche", "battery", "completed", 3],
    ["demo-u2", "st-tokoin", "battery", "completed", 20],
    ["demo-u3", "st-universite", "slot", "completed", 26],
    ["demo-u1", "st-agoe", "battery", "completed", 50],
    ["demo-u2", "st-grand-marche", "slot", "cancelled", 70],
    ["demo-u3", "st-tokoin", "battery", "completed", 96],
    ["demo-u1", "st-grand-marche", "battery", "completed", 120],
    ["demo-u2", "st-agoe", "battery", "completed", 150],
    ["demo-u3", "st-universite", "slot", "completed", 200],
    ["demo-u1", "st-tokoin", "battery", "completed", 260],
    ["demo-u2", "st-be", "slot", "completed", 300],
    // demo-u2 reserves and never comes: three no-shows this week.
    ["demo-u2", "st-tokoin", "battery", "expired", 5],
    ["demo-u2", "st-tokoin", "battery", "expired", 30],
    ["demo-u2", "st-tokoin", "battery", "expired", 54],
  ];
  return rows.map(([userId, stationId, type, status, hours], i) => {
    const created = new Date(now.getTime() - hours * 3_600_000);
    return {
      id: `demo-history-${i}`,
      userId,
      stationId,
      type,
      status,
      createdAt: created.toISOString(),
      expiresAt: new Date(created.getTime() + RESERVATION_MINUTES * 60_000).toISOString(),
    };
  });
}
