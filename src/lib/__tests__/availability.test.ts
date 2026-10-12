import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER,
  availableBatteries,
  availableSlots,
  countHolding,
  isHolding,
  rankStations,
  stationAvailability,
} from "../availability";
import type { Reservation, StationView } from "../types";

function station(overrides: Partial<StationView> = {}): StationView {
  return {
    id: "s1",
    operatorId: "op",
    operatorName: "Greenpoint",
    isOwn: true,
    name: "A",
    address: "",
    lat: 6.13,
    lng: 1.22,
    kind: "both",
    vehicleTypes: ["scooter"],
    chargingSlots: 4,
    batteryCapacity: 10,
    openingHours: "",
    phone: null,
    status: { stationId: "s1", isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt: "" },
    reservedSlots: 0,
    reservedBatteries: 0,
    ...overrides,
  };
}

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: "r1",
    userId: "u1",
    stationId: "s1",
    type: "battery",
    status: "active",
    createdAt: "2026-10-12T10:00:00Z",
    expiresAt: "2026-10-12T10:20:00Z",
    ...overrides,
  };
}

describe("availability", () => {
  it("subtracts reservations from free capacity", () => {
    const s = station({ reservedSlots: 1, reservedBatteries: 5 });
    expect(availableSlots(s)).toBe(1);
    expect(availableBatteries(s)).toBe(0);
  });

  it("reports nothing for services the station does not offer", () => {
    expect(availableSlots(station({ kind: "swap" }))).toBe(0);
    expect(availableBatteries(station({ kind: "charging" }))).toBe(0);
  });

  it("classifies closed, full, limited and available stations", () => {
    const closed = station();
    closed.status = { ...closed.status, isOpen: false };
    expect(stationAvailability(closed)).toBe("closed");
    expect(stationAvailability(station({ reservedSlots: 2, reservedBatteries: 5 }))).toBe("full");
    expect(stationAvailability(station({ reservedSlots: 2, reservedBatteries: 3 }))).toBe("limited");
    expect(stationAvailability(station())).toBe("available");
  });
});

describe("reservation holds", () => {
  const now = new Date("2026-10-12T10:10:00Z");

  it("only counts active, unexpired reservations", () => {
    expect(isHolding(reservation(), now)).toBe(true);
    expect(isHolding(reservation({ status: "cancelled" }), now)).toBe(false);
    expect(isHolding(reservation({ expiresAt: "2026-10-12T10:05:00Z" }), now)).toBe(false);
  });

  it("counts slots and batteries per station", () => {
    const list = [
      reservation({ id: "a" }),
      reservation({ id: "b", type: "slot" }),
      reservation({ id: "c", stationId: "other" }),
      reservation({ id: "d", status: "completed" }),
    ];
    expect(countHolding(list, "s1", now)).toEqual({ slots: 1, batteries: 1 });
  });
});

describe("rankStations", () => {
  const near = station({ id: "near", name: "Z near", lat: 6.131, lng: 1.223 });
  const far = station({ id: "far", name: "A far", lat: 6.2245, lng: 1.208 });

  it("sorts nearest first when the position is known", () => {
    const ranked = rankStations([far, near], { lat: 6.1319, lng: 1.2228 }, DEFAULT_FILTER);
    expect(ranked.map((r) => r.station.id)).toEqual(["near", "far"]);
    expect(ranked[0].distance).toBeLessThan(200);
  });

  it("sorts by name without a position", () => {
    const ranked = rankStations([near, far], null, DEFAULT_FILTER);
    expect(ranked.map((r) => r.station.id)).toEqual(["far", "near"]);
    expect(ranked[0].distance).toBeNull();
  });

  it("filters by vehicle, service and availability", () => {
    const swapOnly = station({ id: "swap", kind: "swap", vehicleTypes: ["tuktuk"] });
    const all = [near, swapOnly];
    expect(rankStations(all, null, { ...DEFAULT_FILTER, vehicle: "tuktuk" }).map((r) => r.station.id)).toEqual(["swap"]);
    expect(rankStations(all, null, { ...DEFAULT_FILTER, service: "charging" }).map((r) => r.station.id)).toEqual(["near"]);
    const emptySwap = station({ id: "empty", kind: "swap", reservedBatteries: 5 });
    expect(rankStations([emptySwap], null, { ...DEFAULT_FILTER, onlyAvailable: true })).toEqual([]);
  });
});
