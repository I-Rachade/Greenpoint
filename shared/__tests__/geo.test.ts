import { describe, expect, it } from "vitest";
import { bearing, compassPoint, scooterMinutes } from "../geo";

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

describe("bearing and compassPoint", () => {
  const station = { lat: 6.1262, lng: 1.2236 };
  it("points from the customer to the station", () => {
    expect(compassPoint(bearing({ lat: 6.11, lng: 1.2236 }, station))).toBe("n");
    expect(compassPoint(bearing({ lat: 6.1262, lng: 1.24 }, station))).toBe("w");
    expect(compassPoint(bearing({ lat: 6.12, lng: 1.217 }, station))).toBe("ne");
  });
  it("wraps around north", () => {
    expect(compassPoint(359)).toBe("n");
    expect(compassPoint(-10)).toBe("n");
    expect(compassPoint(200)).toBe("s");
  });
});
