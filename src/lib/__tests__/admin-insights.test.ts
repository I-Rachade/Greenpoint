import { describe, expect, it } from "vitest";
import { computeKpis, findAnomalies, reservationsPerDay } from "../admin/insights";
import type { AdminSnapshot, AdminStation, AdminUser, ChargingPointInfo } from "@shared/admin/types";
import type { Reservation } from "@shared/types";

const now = new Date("2026-10-12T12:00:00Z");
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000).toISOString();

function station(id: string, patch: Partial<AdminStation> = {}, status: Partial<AdminStation["status"]> = {}): AdminStation {
  return {
    id,
    operatorId: "op",
    operatorName: "poinderecharge",
    isOwn: true,
    name: id,
    address: "",
    lat: 6.13,
    lng: 1.22,
    kind: "both",
    vehicleTypes: ["scooter"],
    chargingSlots: 4,
    batteryCapacity: 10,
    isSolar: false,
    openingHours: "",
    phone: null,
    isActive: true,
    reservedSlots: 0,
    reservedBatteries: 0,
    ...patch,
    status: { stationId: id, isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt: ago(10), ...status },
  };
}

function reservation(id: string, userId: string, stationId: string, createdMinutesAgo: number, patch: Partial<Reservation> = {}): Reservation {
  const created = new Date(now.getTime() - createdMinutesAgo * 60_000);
  return {
    id,
    userId,
    stationId,
    type: "battery",
    status: "active",
    createdAt: created.toISOString(),
    expiresAt: new Date(created.getTime() + 20 * 60_000).toISOString(),
    ...patch,
  };
}

function user(id: string, role: AdminUser["role"], patch: Partial<AdminUser> = {}): AdminUser {
  return { id, phone: "+228", email: null, fullName: null, role, createdAt: ago(60 * 24 * 30), lastSignInAt: null, ...patch };
}

function snapshot(patch: Partial<AdminSnapshot> = {}): AdminSnapshot {
  return {
    stations: [station("a")],
    users: [user("staff", "operator")],
    staff: [{ stationId: "a", userId: "staff" }],
    reservations: [],
    chargingPoints: [],
    ...patch,
  };
}

const kinds = (snap: AdminSnapshot) => findAnomalies(snap, now).map((f) => f.kind);

describe("findAnomalies", () => {
  it("reports nothing for a healthy setup", () => {
    expect(findAnomalies(snapshot(), now)).toEqual([]);
  });

  it("flags a closed station that still has customers holding capacity", () => {
    const snap = snapshot({
      stations: [station("a", {}, { isOpen: false })],
      reservations: [reservation("r1", "u1", "a", 5)],
    });
    expect(findAnomalies(snap, now)[0]).toMatchObject({ kind: "closed_with_reservations", stationId: "a", count: 1, severity: "high" });
  });

  it("flags open stations whose status nobody confirmed for 2 hours", () => {
    const snap = snapshot({ stations: [station("a", {}, { updatedAt: ago(180) })] });
    expect(findAnomalies(snap, now)).toEqual([{ kind: "stale_status", stationId: "a", count: 3, severity: "medium" }]);
  });

  it("ignores stale status at closed or deactivated stations", () => {
    const snap = snapshot({
      stations: [station("a", {}, { updatedAt: ago(600), isOpen: false }), station("b", { isActive: false }, { updatedAt: ago(600) })],
      staff: [{ stationId: "a", userId: "staff" }, { stationId: "b", userId: "staff" }],
    });
    expect(kinds(snap)).toEqual([]);
  });

  it("flags counters above capacity", () => {
    expect(kinds(snapshot({ stations: [station("a", {}, { fullBatteries: 11 })] }))).toEqual(["over_capacity"]);
  });

  it("flags reservations held far longer than 20 minutes", () => {
    const r = reservation("r1", "u1", "a", 5, { expiresAt: new Date(now.getTime() + 365 * 86_400_000).toISOString() });
    expect(kinds(snapshot({ reservations: [r] }))).toContain("long_hold");
  });

  it("flags customers who keep reserving and customers who never show up", () => {
    const reservations = [
      reservation("r1", "loop", "a", 30, { status: "cancelled" }),
      reservation("r2", "loop", "a", 60, { status: "cancelled" }),
      reservation("r3", "loop", "a", 90, { status: "cancelled" }),
      reservation("r4", "ghost", "a", 60 * 30, { status: "expired" }),
      // Still "active" in the table but long past its expiry: also a no-show.
      reservation("r5", "ghost", "a", 60 * 50),
    ];
    const findings = findAnomalies(snapshot({ reservations }), now);
    expect(findings).toContainEqual({ kind: "repeat_reserver", userId: "loop", count: 3, severity: "medium" });
    expect(findings).toContainEqual({ kind: "no_show", userId: "ghost", count: 2, severity: "medium" });
    expect(findings).toContainEqual({ kind: "lapsed_still_active", count: 1, severity: "low" });
  });

  it("flags connected sockets that went silent or report a fault", () => {
    const point = (id: string, p: Partial<ChargingPointInfo>): ChargingPointInfo => ({
      id,
      stationId: "a",
      label: id,
      status: "free",
      deviceId: "DEV",
      lastSeenAt: ago(1),
      ...p,
    });
    const snap = snapshot({
      chargingPoints: [
        point("p1", { lastSeenAt: ago(30) }),
        point("p2", { lastSeenAt: null }),
        point("p3", { status: "fault" }),
        point("manual", { deviceId: null, lastSeenAt: null }),
      ],
    });
    const findings = findAnomalies(snap, now);
    expect(findings).toContainEqual({ kind: "silent_device", stationId: "a", count: 2, severity: "high" });
    expect(findings).toContainEqual({ kind: "point_fault", stationId: "a", count: 1, severity: "high" });
  });

  it("flags staff role and station assignment that disagree", () => {
    const snap = snapshot({
      users: [user("staff", "operator"), user("lonely", "operator"), user("helper", "customer")],
      staff: [{ stationId: "a", userId: "staff" }, { stationId: "a", userId: "helper" }],
    });
    expect(kinds(snap).sort()).toEqual(["operator_without_station", "staff_without_role"]);
  });

  it("flags own stations without staff, most urgent findings first", () => {
    const snap = snapshot({
      staff: [],
      users: [],
      stations: [station("a", {}, { isOpen: false })],
      reservations: [reservation("r1", "u1", "a", 5)],
    });
    expect(kinds(snap)).toEqual(["closed_with_reservations", "station_without_staff"]);
  });
});

describe("computeKpis", () => {
  it("counts stations, users and the last week's reservations", () => {
    const snap = snapshot({
      stations: [station("a"), station("b", {}, { isOpen: false }), station("c", { isActive: false })],
      users: [
        user("u1", "customer", { createdAt: ago(60), lastSignInAt: ago(30) }),
        user("u2", "customer"),
        user("admin", "admin", { lastSignInAt: ago(60 * 24 * 10) }),
      ],
      reservations: [
        reservation("r1", "u1", "a", 5),
        reservation("r2", "u1", "a", 60 * 30, { status: "completed" }),
        reservation("r3", "u2", "a", 60 * 30, { status: "completed" }),
        reservation("r4", "u2", "a", 60 * 30, { status: "cancelled" }),
        reservation("r5", "u2", "a", 60 * 40),
        reservation("r6", "u2", "a", 60 * 24 * 9, { status: "completed" }),
      ],
    });
    const k = computeKpis(snap, now);
    expect(k).toMatchObject({
      stationsActive: 2,
      stationsInactive: 1,
      stationsOpen: 1,
      usersTotal: 3,
      usersNew7d: 1,
      usersActive7d: 1,
      holdingNow: 1,
      reservations24h: 1,
      reservations7d: 5,
    });
    expect(k.usersByRole).toEqual({ customer: 2, operator: 0, fleet_manager: 0, admin: 1, driver: 0, merchant: 0 });
    // 4 ended this week: 2 completed, 1 cancelled, 1 expired.
    expect(k.completionRate7d).toBe(0.5);
    expect(k.noShowRate7d).toBe(0.25);
  });

  it("has no rates when nothing ended", () => {
    const k = computeKpis(snapshot(), now);
    expect(k.noShowRate7d).toBeNull();
    expect(k.completionRate7d).toBeNull();
  });
});

describe("reservationsPerDay", () => {
  it("buckets the last days oldest first, including empty days", () => {
    const days = reservationsPerDay(
      [
        reservation("r1", "u", "a", 60, { status: "completed" }),
        reservation("r2", "u", "a", 60 * 24 * 2, { status: "expired" }),
        reservation("old", "u", "a", 60 * 24 * 30),
      ],
      now,
      7,
    );
    expect(days).toHaveLength(7);
    expect(days.at(-1)).toMatchObject({ total: 1, completed: 1, noShows: 0 });
    expect(days.at(-3)).toMatchObject({ total: 1, completed: 0, noShows: 1 });
    expect(days.reduce((n, d) => n + d.total, 0)).toBe(2);
  });
});
