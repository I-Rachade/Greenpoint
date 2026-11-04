import { describe, expect, it } from "vitest";
import { daysAgo, isLow, kmLeft } from "../scooter-battery";

describe("scooter battery", () => {
  it("estimates the kilometres from the energy left, else from the charge", () => {
    // 72 V × 10 Ah = 720 Wh → 24 km at 30 Wh/km
    expect(kmLeft({ socPct: 40, voltageMv: 72_000, remainingMah: 10_000 })).toBe(24);
    expect(kmLeft({ socPct: 50, voltageMv: null, remainingMah: null })).toBe(35);
    expect(kmLeft({ socPct: 0, voltageMv: 70_000, remainingMah: 0 })).toBe(0);
  });

  it("advises a swap under 25 %", () => {
    expect(isLow(24)).toBe(true);
    expect(isLow(25)).toBe(false);
  });

  it("counts calendar days", () => {
    const now = new Date("2026-11-04T08:00:00Z");
    expect(daysAgo("2026-11-04T01:00:00Z", now)).toBe(0);
    expect(daysAgo("2026-11-03T23:59:00Z", now)).toBe(1);
    expect(daysAgo("2026-10-31T12:00:00Z", now)).toBe(4);
  });
});
