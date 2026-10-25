import { describe, expect, it } from "vitest";
import {
  balanceOf,
  DEFAULT_DRIVER_SETTINGS,
  driverBadgePayload,
  driverEarning,
  fareFor,
  inServiceArea,
  isDriverPassFormat,
  newDriverCode,
  parseDriverBadge,
  pickDriver,
  validSettings,
  vehicleFits,
  type QueueEntry,
} from "../drivers";

const s = DEFAULT_DRIVER_SETTINGS;

describe("trip prices", () => {
  it("charges 500 FCFA plus 100 FCFA per started km, and 1000 FCFA more for express", () => {
    expect(fareFor(0, false, s)).toBe(600);
    expect(fareFor(1000, false, s)).toBe(600);
    expect(fareFor(1001, false, s)).toBe(700);
    expect(fareFor(4400, true, s)).toBe(500 + 500 + 1000);
  });

  it("gives the driver 55 % in whole francs", () => {
    expect(driverEarning(700, s)).toBe(385);
    expect(driverEarning(2001, s)).toBe(1100);
  });

  it("adds up what the driver owes", () => {
    expect(balanceOf([{ kind: "collected", amountFcfa: 1700 }, { kind: "earning", amountFcfa: 385 }, { kind: "settlement", amountFcfa: 1315 }])).toBe(0);
    expect(balanceOf([{ kind: "earning", amountFcfa: 385 }])).toBe(-385);
  });
});

describe("vehicles", () => {
  it("keeps big or heavy parcels off motorbikes", () => {
    expect(vehicleFits("moto", "M", 5, s)).toBe(true);
    expect(vehicleFits("moto", "L", 5, s)).toBe(false);
    expect(vehicleFits("moto", "M", 25, s)).toBe(false);
    expect(vehicleFits("tricycle", "XL", 50, s)).toBe(false);
    expect(vehicleFits("cargo_tricycle", "XL", 150, s)).toBe(true);
  });

  it("validates settings", () => {
    expect(validSettings(s)).toBe(true);
    expect(validSettings({ ...s, driverSharePct: 101 })).toBe(false);
    expect(validSettings({ ...s, vehicles: s.vehicles.slice(1) })).toBe(false);
  });
});

describe("dispatch", () => {
  const stations = [
    { id: "near", lat: 6.13, lng: 1.22 },
    { id: "far", lat: 6.2, lng: 1.3 },
  ];
  const q = (driverId: string, stationId: string, since: string, vehicleType: QueueEntry["vehicleType"] = "cargo_tricycle"): QueueEntry => ({
    driverId,
    stationId,
    since,
    vehicleType,
  });

  it("picks the first in line at the nearest station with a fitting vehicle", () => {
    const queue = [q("late", "near", "2026-10-12T10:05:00Z"), q("early", "near", "2026-10-12T10:00:00Z"), q("other", "far", "2026-10-12T09:00:00Z")];
    expect(pickDriver({ lat: 6.131, lng: 1.221 }, queue, stations, () => true)?.driverId).toBe("early");
    expect(pickDriver({ lat: 6.131, lng: 1.221 }, queue, stations, (t) => t !== "cargo_tricycle")).toBeNull();
    const mixed = [q("moto", "near", "2026-10-12T10:00:00Z", "moto"), q("cargo", "far", "2026-10-12T10:00:00Z")];
    expect(pickDriver({ lat: 6.131, lng: 1.221 }, mixed, stations, (t) => t === "cargo_tricycle")?.driverId).toBe("cargo");
  });

  it("only serves Lomé", () => {
    expect(inServiceArea({ lat: 6.17, lng: 1.21 })).toBe(true);
    expect(inServiceArea({ lat: 9.55, lng: 1.19 })).toBe(false);
  });
});

describe("driver QR code", () => {
  it("reads scanned and typed codes", () => {
    const code = newDriverCode();
    expect(code).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
    expect(parseDriverBadge(driverBadgePayload(code))).toBe(code);
    expect(parseDriverBadge(` ${code.slice(0, 4)}-${code.slice(4).toLowerCase()} `)).toBe(code);
    expect(parseDriverBadge("POINDERECHARGE-COLIS:GP-AAAAAA:123456")).toBeNull();
  });

  it("tells a pass (checked as such, genuine or not) from the typed code and the old static QR", () => {
    const code = newDriverCode();
    expect(isDriverPassFormat(`${driverBadgePayload(code)}:0:ABC:0123456789ABCDEF`)).toBe(true);
    expect(isDriverPassFormat(` ${driverBadgePayload(code).toLowerCase()}:x `)).toBe(true);
    expect(isDriverPassFormat(driverBadgePayload(code))).toBe(false);
    expect(isDriverPassFormat(code)).toBe(false);
  });
});
