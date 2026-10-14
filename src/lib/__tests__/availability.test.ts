import { describe, expect, it } from "vitest";
import {
  DEFAULT_FILTER,
  availableBatteries,
  availableSlots,
  countHolding,
  isHolding,
  isStale,
  rankStations,
  stationAvailability,
  stockBatteries,
  withinOpeningHours,
} from "../availability";
import type { Reservation, StationView } from "../types";

function station(overrides: Partial<StationView> = {}): StationView {
  return {
    id: "s1",
    operatorId: "op",
    operatorName: "poinderecharge",
    isOwn: true,
    name: "A",
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
    const swapOnly = station({ id: "swap", kind: "swap", vehicleTypes: ["tricycle"] });
    const all = [near, swapOnly];
    expect(rankStations(all, null, { ...DEFAULT_FILTER, vehicle: "tricycle" }).map((r) => r.station.id)).toEqual(["swap"]);
    expect(rankStations(all, null, { ...DEFAULT_FILTER, service: "charging" }).map((r) => r.station.id)).toEqual(["near"]);
    const emptySwap = station({ id: "empty", kind: "swap", reservedBatteries: 5 });
    expect(rankStations([emptySwap], null, { ...DEFAULT_FILTER, onlyAvailable: true })).toEqual([]);
  });
});

describe("opening hours and stale reports", () => {
  const at = (hhmm: string) => new Date(`2026-10-12T${hhmm}:00Z`);

  it("checks simple and overnight ranges in Lomé time (UTC)", () => {
    expect(withinOpeningHours("07:00-21:00", at("06:59"))).toBe(false);
    expect(withinOpeningHours("07:00-21:00", at("07:00"))).toBe(true);
    expect(withinOpeningHours("07:00-21:00", at("21:00"))).toBe(false);
    expect(withinOpeningHours("18:00-02:00", at("01:30"))).toBe(true);
    expect(withinOpeningHours("18:00-02:00", at("12:00"))).toBe(false);
    expect(withinOpeningHours("00:00-24:00", at("03:00"))).toBe(true);
  });

  it("ignores opening hours it cannot read", () => {
    expect(withinOpeningHours("", at("03:00"))).toBe(true);
    expect(withinOpeningHours("Lun-Sam 8h-18h", at("03:00"))).toBe(true);
  });

  it("marks reports older than two hours as stale", () => {
    const now = at("12:00");
    const s = (updatedAt: string) =>
      station({ status: { stationId: "s1", isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt } });
    expect(isStale(s("2026-10-12T10:30:00Z"), now)).toBe(false);
    expect(isStale(s("2026-10-12T09:30:00Z"), now)).toBe(true);
  });
});

describe("parcel points", () => {
  const now = new Date().toISOString();
  const parcel = station({
    id: "p1",
    kind: "parcel",
    chargingSlots: 0,
    batteryCapacity: 0,
    status: { stationId: "p1", isOpen: true, freeSlots: 0, fullBatteries: 0, updatedAt: "2020-01-01T00:00:00Z" },
    parcelPoint: { counter: false, lockers: 12 },
  });
  const battery = station({ status: { stationId: "s1", isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt: now } });

  it("are available while open, with nothing to reserve", () => {
    expect(stationAvailability(parcel)).toBe("available");
    expect(availableSlots(parcel)).toBe(0);
    expect(availableBatteries(parcel)).toBe(0);
  });

  it("match the parcel filter, battery stations do not", () => {
    const ids = (service: "parcel" | "charging" | "swap", onlyAvailable = false) =>
      rankStations([parcel, battery], null, { ...DEFAULT_FILTER, service, onlyAvailable }).map((r) => r.station.id);
    expect(ids("parcel")).toEqual(["p1"]);
    expect(ids("parcel", true)).toEqual(["p1"]);
    expect(ids("charging")).toEqual(["s1"]);
    expect(ids("swap")).toEqual(["s1"]);
    expect(rankStations([parcel], null, { ...DEFAULT_FILTER, onlyAvailable: true })).toHaveLength(1);
  });
});

describe("battery brand filter", () => {
  const now = new Date().toISOString();
  const spiro = { id: "t1", brand: "Spiro", name: "72 V", isActive: true, fullBatteries: 5 };
  const ovt = { id: "t2", brand: "Omnivoltaic", name: "60 V", isActive: true, fullBatteries: 0 };
  const a = station({ id: "a", status: { stationId: "a", isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt: now }, batteryTypes: [spiro] });
  const b = station({ id: "b", status: { stationId: "b", isOpen: true, freeSlots: 2, fullBatteries: 0, updatedAt: now }, batteryTypes: [ovt, { ...spiro, fullBatteries: 0 }] });
  // Full batteries, but none of Omnivoltaic.
  const d = station({ id: "d", status: { stationId: "d", isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt: now }, batteryTypes: [ovt, spiro] });
  const c = station({ id: "c", status: { stationId: "c", isOpen: true, freeSlots: 2, fullBatteries: 5, updatedAt: now } });
  const ids = (brand: string, onlyAvailable = false) =>
    rankStations([a, b, c, d], null, { ...DEFAULT_FILTER, brand, onlyAvailable }).map((r) => r.station.id).sort();

  it("keeps stations that swap the brand's batteries", () => {
    expect(ids("all")).toEqual(["a", "b", "c", "d"]);
    expect(ids("Spiro")).toEqual(["a", "b", "d"]);
    expect(ids("Omnivoltaic")).toEqual(["b", "d"]);
    expect(ids("Spiro", true)).toEqual(["a", "d"]);
    expect(ids("Omnivoltaic", true)).toEqual([]);
  });
});

describe("battery stock", () => {
  it("shows the stock of a closed station, but offers none of it", () => {
    const now = new Date().toISOString();
    const closed = station({ status: { stationId: "s1", isOpen: false, freeSlots: 0, fullBatteries: 4, updatedAt: now } });
    expect(stockBatteries(closed)).toBe(4);
    expect(availableBatteries(closed)).toBe(0);
  });
});

describe("electric car filter", () => {
  const ev = station({ id: "ev", name: "EV", evChargers: [{ id: "c1", name: "Borne 1", connector: "ccs2", powerKw: 60 }] });
  const plain = station({ id: "plain", name: "Plain", evChargers: [] });

  it("keeps only stations with a charger, whatever the two-wheeler type", () => {
    const filter = { ...DEFAULT_FILTER, service: "ev" as const, vehicle: "tricycle" as const };
    expect(rankStations([ev, plain], null, filter).map((r) => r.station.id)).toEqual(["ev"]);
  });

  it("with only available, leaves out a closed station", () => {
    const closed = { ...ev, status: { ...ev.status, isOpen: false } };
    expect(rankStations([closed], null, { ...DEFAULT_FILTER, service: "ev", onlyAvailable: true })).toEqual([]);
  });
});
