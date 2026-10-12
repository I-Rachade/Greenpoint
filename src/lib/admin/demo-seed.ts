import { RESERVATION_MINUTES, type Reservation, type ReservationStatus, type ReservationType } from "../types";
import type { AdminUser, StaffAssignment } from "./types";

// Example users and history for the backoffice in demo mode. The ids
// `demo-<role>` are the ones the demo login uses (see DemoBackend.verifyCode).

export function demoUsers(now: Date): AdminUser[] {
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
  return [
    { id: "demo-admin", phone: "+22890000001", email: null, fullName: "Admin démo", role: "admin", createdAt: daysAgo(60), lastSignInAt: null },
    { id: "demo-operator", phone: "+22890000002", email: null, fullName: "Kossi (Grand Marché)", role: "operator", createdAt: daysAgo(45), lastSignInAt: daysAgo(0.2) },
    { id: "demo-operator-2", phone: "+22890000003", email: null, fullName: "Afi", role: "operator", createdAt: daysAgo(20), lastSignInAt: daysAgo(9) },
    { id: "demo-rider", phone: "+22890000004", email: null, fullName: null, role: "rider", createdAt: daysAgo(30), lastSignInAt: daysAgo(1) },
    { id: "demo-u1", phone: "+22891111111", email: null, fullName: "Yao", role: "rider", createdAt: daysAgo(25), lastSignInAt: daysAgo(0.1) },
    { id: "demo-u2", phone: "+22892222222", email: null, fullName: null, role: "rider", createdAt: daysAgo(12), lastSignInAt: daysAgo(2) },
    { id: "demo-u3", phone: "+22893333333", email: null, fullName: "Ama", role: "rider", createdAt: daysAgo(3), lastSignInAt: daysAgo(0.5) },
    { id: "demo-fleet_manager", phone: "+22890000005", email: null, fullName: "Flotte Express", role: "fleet_manager", createdAt: daysAgo(8), lastSignInAt: null },
  ];
}

export const DEMO_STAFF: StaffAssignment[] = [
  { stationId: "st-grand-marche", userId: "demo-operator" },
  { stationId: "st-tokoin", userId: "demo-operator" },
  { stationId: "st-universite", userId: "demo-operator" },
  { stationId: "st-be", userId: "demo-operator" },
  { stationId: "st-agoe", userId: "demo-operator" },
];

/** Past reservations over the last two weeks, including a rider who never shows up. */
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
