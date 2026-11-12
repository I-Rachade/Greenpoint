import { describe, expect, it } from "vitest";
import { merchantStats, periodKey, validStatsQuery, type StatsTrip } from "../merchants";

const trip = (over: Partial<StatsTrip>): StatsTrip => ({
  status: "done",
  fareFcfa: 1000,
  createdAt: "2026-10-14T10:00:00.000Z",
  pickedUpAt: "2026-10-14T10:10:00.000Z",
  doneAt: "2026-10-14T10:30:00.000Z",
  bookedBy: { userId: "afi", name: "Afi" },
  driverId: "kofi",
  ...over,
});

describe("merchant statistics", () => {
  it("groups by day, week from Monday and month", () => {
    expect(periodKey("2026-10-16T12:00:00.000Z", "day")).toBe("2026-10-16");
    expect(periodKey("2026-10-16T12:00:00.000Z", "week")).toBe("2026-10-12");
    expect(periodKey("2026-10-12T00:00:00.000Z", "week")).toBe("2026-10-12");
    expect(periodKey("2026-10-18T23:00:00.000Z", "week")).toBe("2026-10-12");
    expect(periodKey("2026-10-16T12:00:00.000Z", "month")).toBe("2026-10");
  });

  it("checks the period", () => {
    expect(validStatsQuery({ from: "2026-10-01", to: "2026-10-31", group: "day" })).toBe(true);
    expect(validStatsQuery({ from: "2026-10-31", to: "2026-10-01", group: "day" })).toBe(false);
    expect(validStatsQuery({ from: "2025-01-01", to: "2026-10-01", group: "month" })).toBe(false);
    expect(validStatsQuery({ from: "2026-10-01", to: "2026-10-02", group: "year" as "day" })).toBe(false);
  });

  it("counts trips, spend, success, time, employees and driver hours", () => {
    const s = merchantStats(
      { from: "2026-10-13", to: "2026-10-15", group: "day" },
      [
        trip({}),
        trip({ status: "failed", doneAt: "2026-10-14T11:00:00.000Z", bookedBy: { userId: "yao", name: "Yao" } }), // paid at the start
        trip({ status: "cancelled", pickedUpAt: null, doneAt: null }),
        trip({ createdAt: "2026-10-15T08:00:00.000Z", doneAt: "2026-10-15T08:50:00.000Z", fareFcfa: 500 }),
      ],
      [
        { driverId: "kofi", driverName: "Kofi", payMode: "hourly", inAt: "2026-10-14T08:00:00.000Z", outAt: "2026-10-14T12:30:00.000Z", amountFcfa: 4500 },
        { driverId: "kodjo", driverName: "Kodjo", payMode: "per_trip", inAt: "2026-10-15T08:00:00.000Z", outAt: "2026-10-15T09:00:00.000Z", amountFcfa: null },
      ],
    );
    expect(s.totals).toEqual({ booked: 4, done: 2, failed: 1, cancelled: 1, spendFcfa: 2500, successRate: 2 / 3, avgMinutes: 40, hourlyFcfa: 4500 });
    expect(s.periods.map((p) => [p.key, p.booked, p.spendFcfa])).toEqual([
      ["2026-10-13", 0, 0],
      ["2026-10-14", 3, 2000],
      ["2026-10-15", 1, 500],
    ]);
    expect(s.employees.map((e) => [e.userId, e.booked])).toEqual([
      ["afi", 3],
      ["yao", 1],
    ]);
    expect(s.drivers).toEqual([
      { driverId: "kofi", name: "Kofi", checkins: 1, hours: 4.5, hourlyFcfa: 4500, trips: 2 },
      { driverId: "kodjo", name: "Kodjo", checkins: 1, hours: 1, hourlyFcfa: 0, trips: 0 },
    ]);
  });
});
