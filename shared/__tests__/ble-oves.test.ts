import { describe, expect, it } from "vitest";
import {
  crc16Modbus,
  decodeFieldValue,
  isOvesName,
  looksLikeSerial,
  parseFieldDescriptor,
  parseStreamFrame,
  sameSerial,
  serialSuffixFromName,
  toReading,
} from "../ble-oves";

// Frames and values from the captures of 2026-11-04 (three battery types).
const hex = (s: string) => Uint8Array.from(s.trim().split(/\s+/).map((b) => parseInt(b, 16)));

describe("data service fields", () => {
  it("reads the descriptor", () => {
    expect(parseFieldDescriptor("rsoc:0:Relative State of Charge")).toEqual({ code: "rsoc", size: 0, label: "Relative State of Charge" });
    expect(parseFieldDescriptor("fccp:2:Full Charge Capacity\0")).toEqual({ code: "fccp", size: 2, label: "Full Charge Capacity" });
    expect(parseFieldDescriptor("Battery")).toBeNull();
  });

  it("decodes the charge and the voltage", () => {
    expect(decodeFieldValue(hex("64 00"), 0)).toBe(100);
    expect(decodeFieldValue(hex("63 00"), 0)).toBe(99);
    expect(decodeFieldValue(hex("be 2c 01 00"), 2)).toBe(76990);
  });

  it("decodes fccp as uint16 or uint32, as the descriptor says", () => {
    expect(decodeFieldValue(hex("2a 75"), 0)).toBe(29994);
    expect(decodeFieldValue(hex("6e 89 01 00"), 2)).toBe(100718);
    expect(decodeFieldValue(hex("6e 89 01 00"), null)).toBe(100718);
  });

  it("decodes text fields", () => {
    expect(decodeFieldValue(new TextEncoder().encode("B0724525100136\0\0"), 5)).toBe("B0724525100136");
  });

  it("refuses values that are too short", () => {
    expect(decodeFieldValue(hex("64"), 0)).toBeNull();
    expect(decodeFieldValue(hex("be 2c"), 2)).toBeNull();
  });
});

describe("fff2 stream", () => {
  it("checks the CRC of the captured frame", () => {
    expect(crc16Modbus(hex("07 a2 02 63 00"))).toBe(0x483b);
    expect(parseStreamFrame(hex("aa 07 a2 02 63 00 3b 48 5b 5a"))).toEqual({ id: 0xa2, data: hex("63 00") });
  });

  it("drops cut or damaged frames", () => {
    expect(parseStreamFrame(hex("aa 07 a2 02 63 00 3b 49 5b 5a"))).toBeNull();
    expect(parseStreamFrame(hex("aa 07 a2 02 63 00 3b"))).toBeNull();
    expect(parseStreamFrame(hex("ab 07 a2 02 63 00 3b 48 5b 5a"))).toBeNull();
  });
});

describe("reading", () => {
  it("keeps a charge 0…100 and the serial", () => {
    expect(toReading({ rsoc: 99, pckv: 76990, rcap: 45397, fccp: 45438, opid: "B0724525100136" })).toEqual({
      socPct: 99,
      voltageMv: 76990,
      remainingMah: 45397,
      fullMah: 45438,
      serial: "B0724525100136",
    });
    expect(toReading({ rsoc: 640 }).socPct).toBeNull();
    expect(toReading({}).serial).toBeNull();
  });

  it("knows the batteries by name and compares numbers", () => {
    expect(isOvesName("OVES BATT 100136")).toBe(true);
    expect(isOvesName("Mi Band")).toBe(false);
    expect(isOvesName(null)).toBe(false);
    expect(sameSerial("b0724525100136 ", "B0724525100136")).toBe(true);
    expect(sameSerial("", "")).toBe(false);
  });

  it("takes the end of the serial number from the Bluetooth name", () => {
    expect(serialSuffixFromName("OVES BATT 100136")).toBe("100136");
    expect(serialSuffixFromName(" OVES BATT 050006 ")).toBe("050006");
    expect(serialSuffixFromName("OVES BATT")).toBeNull();
    expect(serialSuffixFromName("Mi Band 123456")).toBeNull();
  });

  it("recognizes a serial number in a text field", () => {
    expect(looksLikeSerial("B0724525100136", "100136")).toBe(true);
    expect(looksLikeSerial("b0724525100136\0", "100136")).toBe(true);
    expect(looksLikeSerial("B0723025050006", "100136")).toBe(false);
    expect(looksLikeSerial("1.0.7", null)).toBe(false);
    expect(looksLikeSerial("OVES BATT", null)).toBe(false);
    expect(toReading({ rsoc: 50, opid: " b0724525100136 " }).serial).toBe("B0724525100136");
  });
});
