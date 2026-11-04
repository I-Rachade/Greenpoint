import { describe, expect, it } from "vitest";
import type { Reservation, StationView } from "@shared/types";
import { initials, tripStatus } from "./trip-status";

const station = {
  status: { fullBatteries: 3 },
  batteryTypes: [
    { id: "spiro", fullBatteries: 2 },
    { id: "ov", fullBatteries: 0 },
  ],
} as unknown as StationView;
const r = (extra: Partial<Reservation>) => ({ kind: "swap", type: "battery", target: "spiro", ...extra }) as Reservation;

describe("tripStatus", () => {
  it("is ready once marked, redirected once another station was offered", () => {
    expect(tripStatus(r({}), station)).toBe("prepare");
    expect(tripStatus(r({ readyAt: "x" }), station)).toBe("ready");
    expect(tripStatus(r({ readyAt: "x", redirectedAt: "y" }), station)).toBe("redirected");
  });
  it("is out of stock when no full battery of the reserved type is left", () => {
    expect(tripStatus(r({ target: "ov" }), station)).toBe("out");
    expect(tripStatus(r({ target: "gone" }), station)).toBe("out");
    expect(tripStatus(r({ target: null }), { ...station, status: { ...station.status, fullBatteries: 0 } } as StationView)).toBe("out");
    // A charging reservation has no battery stock.
    expect(tripStatus(r({ kind: "charging_point", type: "slot", target: null }), { ...station, status: { ...station.status, fullBatteries: 0 } } as StationView)).toBe("prepare");
  });
});

describe("initials", () => {
  it("takes two letters of the name, or the last digits of a masked phone", () => {
    expect(initials("Kossi A.")).toBe("KA");
    expect(initials("Ama")).toBe("A");
    expect(initials("+228 •• •• 12 34")).toBe("34");
    expect(initials(null)).toBe("?");
  });
});
