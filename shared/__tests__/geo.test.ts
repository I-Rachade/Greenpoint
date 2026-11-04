import { describe, expect, it } from "vitest";
import { scooterMinutes } from "../geo";

describe("scooterMinutes", () => {
  it("adds a road factor to the straight-line distance", () => {
    // 990 m straight → about 1.3 km of road at 22 km/h → 4 minutes (the mockup's example).
    expect(scooterMinutes(990)).toBe(4);
    expect(scooterMinutes(5000)).toBe(18);
  });

  it("never says 0 minutes", () => {
    expect(scooterMinutes(0)).toBe(1);
    expect(scooterMinutes(50)).toBe(1);
    expect(scooterMinutes(Number.NaN)).toBe(1);
  });
});
