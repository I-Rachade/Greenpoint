import { describe, expect, it } from "vitest";
import { oldestCharging, type BatteryEventView } from "@shared/station-work";

let n = 0;
function ev(type: BatteryEventView["type"], emptyAfter: number, at: string, key = "bt"): BatteryEventView {
  return { id: String(n++), type, batteryTypeId: key, delta: 1, fullAfter: 0, emptyAfter, reason: null, swapId: null, person: "x", role: "staff", createdAt: at };
}

describe("oldestCharging", () => {
  it("is null without empties", () => {
    expect(oldestCharging([], "bt", 0)).toBeNull();
  });

  it("is before_today when the empties came before today's events", () => {
    expect(oldestCharging([], "bt", 2)).toBe("before_today");
    expect(oldestCharging([ev("empty_in", 3, "2026-11-04T09:00:00Z")], "bt", 3)).toBe("before_today");
  });

  it("takes the oldest empty still charging, first in first out", () => {
    const events = [
      ev("empty_in", 1, "2026-11-04T08:00:00Z"),
      ev("empty_in", 2, "2026-11-04T09:00:00Z"),
      ev("full", 1, "2026-11-04T10:00:00Z"),
      ev("empty_in", 2, "2026-11-04T11:00:00Z"),
      ev("empty_in", 9, "2026-11-04T07:00:00Z", "other"),
    ];
    expect(oldestCharging(events, "bt", 2)).toBe("2026-11-04T09:00:00Z");
  });

  it("uses up this morning's empties first", () => {
    const events = [ev("full", 0, "2026-11-04T08:00:00Z"), ev("empty_in", 1, "2026-11-04T09:00:00Z")];
    expect(oldestCharging(events, "bt", 1)).toBe("2026-11-04T09:00:00Z");
  });

  it("is null when today's events do not explain the counter (someone else's events missing)", () => {
    expect(oldestCharging([ev("empty_in", 1, "2026-11-04T08:00:00Z")], "bt", 3)).toBeNull();
  });
});
