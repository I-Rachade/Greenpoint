import { describe, expect, it } from "vitest";
import { characteristicName, decodeStandard, parseHex, propertyList, reportFileName, serviceName, shortUuid, toAscii, toHex } from "../ble";

describe("shortUuid", () => {
  it("shortens standard UUIDs and keeps vendor ones whole", () => {
    expect(shortUuid("0000180F-0000-1000-8000-00805F9B34FB")).toBe("180f");
    expect(shortUuid("2A19")).toBe("2a19");
    expect(shortUuid("6e400001-b5a3-f393-e0a9-e50e24dcca9e")).toBe("6e400001-b5a3-f393-e0a9-e50e24dcca9e");
  });

  it("names standard services and characteristics only", () => {
    expect(serviceName("0000180f-0000-1000-8000-00805f9b34fb")).toBe("Battery Service");
    expect(characteristicName("00002a25-0000-1000-8000-00805f9b34fb")).toBe("Serial Number");
    expect(serviceName("0000ff00-0000-1000-8000-00805f9b34fb")).toBeNull();
  });
});

describe("hex", () => {
  it("writes and reads bytes", () => {
    expect(toHex(new Uint8Array([1, 0xa2, 0xff]))).toBe("01 A2 FF");
    expect(toHex(new Uint8Array())).toBe("");
    expect(Array.from(parseHex("01 a2 FF")!)).toEqual([1, 0xa2, 0xff]);
    expect(Array.from(parseHex("0x01,0xA2")!)).toEqual([1, 0xa2]);
    expect(Array.from(parseHex("DDA50300FFFD77")!)).toEqual([0xdd, 0xa5, 3, 0, 0xff, 0xfd, 0x77]);
  });

  it("refuses odd lengths, other characters and nothing", () => {
    expect(parseHex("123")).toBeNull();
    expect(parseHex("zz")).toBeNull();
    expect(parseHex("  ")).toBeNull();
  });

  it("shows text hidden in a frame", () => {
    expect(toAscii(new Uint8Array([0x4f, 0x56, 0x00, 0x31]))).toBe("OV·1");
  });
});

describe("decodeStandard", () => {
  it("reads the battery level as the charge in %", () => {
    expect(decodeStandard("2a19", new Uint8Array([87]))).toEqual({ label: "Battery Level", text: "87 %", socPct: 87 });
    expect(decodeStandard("2a19", new Uint8Array([200]))?.socPct).toBeUndefined();
  });

  it("reads Device Information strings up to a zero byte", () => {
    const serial = new TextEncoder().encode("OVB123456\0\0");
    expect(decodeStandard("00002a25-0000-1000-8000-00805f9b34fb", serial)).toEqual({ label: "Serial Number", text: "OVB123456" });
  });

  it("leaves vendor characteristics and empty values alone", () => {
    expect(decodeStandard("ff01", new Uint8Array([1]))).toBeNull();
    expect(decodeStandard("2a19", new Uint8Array())).toBeNull();
  });
});

describe("report helpers", () => {
  it("lists properties in a fixed order", () => {
    expect(propertyList({ notify: true, read: true, write: false })).toEqual(["read", "notify"]);
  });

  it("gives a safe file name", () => {
    expect(reportFileName("OV Batt/01", new Date("2026-11-02T19:30:05Z"))).toBe("ble-OV-Batt-01-2026-11-02-19-30-05.json");
    expect(reportFileName(null, new Date("2026-11-02T19:30:05Z"))).toBe("ble-batterie-2026-11-02-19-30-05.json");
  });
});
