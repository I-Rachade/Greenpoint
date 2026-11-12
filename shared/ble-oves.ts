// Omnivoltaic (OVES) batteries over Bluetooth: how they give their charge (SOC), voltage and
// capacity. Mapped from captures of the brand's own app on 2026-11-04 (3 battery types,
// /mnt/project-files/bluetooth/protocole-batterie-omnivoltaic.md); no pairing, no encryption.
//
// Two sources, the same values:
//   data service 9b074000-…   one characteristic per field (Read), each described by its 0x2901
//                             descriptor "code:size:label" (size 0 = uint16 LE, 2 = uint32 LE,
//                             5 = text). Handles differ between models: always go by UUID.
//   stream fff0 / fff2        notifications from the moment of connection, frames
//                             aa LL ID DL data CRC16 5b 5a (LL = DL + 5, CRC-16/MODBUS over
//                             LL…data, little endian). IDs a0 pckv, a2 rsoc, a3 rcap, a4 fccp.
// Pure functions: the reader is src/lib/ble/oves-reader.ts.

export const OVES_DATA_SERVICE = "9b074000-d1ec-4451-be62-f86a05dd9b47";
export const OVES_STREAM_SERVICE = "0000fff0-0000-1000-8000-00805f9b34fb";
export const OVES_STREAM_CHARACTERISTIC = "0000fff2-0000-1000-8000-00805f9b34fb";
export const USER_DESCRIPTION = "00002901-0000-1000-8000-00805f9b34fb";

/** The fields poinderecharge reads. */
export type OvesField = "rsoc" | "pckv" | "rcap" | "fccp" | "opid";
export const OVES_FIELDS: readonly OvesField[] = ["rsoc", "pckv", "rcap", "fccp", "opid"];

/** Characteristics seen in the captures, used when a descriptor cannot be read. */
export const OVES_FIELD_UUIDS: Partial<Record<OvesField, string>> = {
  pckv: "9b074005-d1ec-4451-be62-f86a05dd9b47",
  rsoc: "9b074007-d1ec-4451-be62-f86a05dd9b47",
  rcap: "9b074008-d1ec-4451-be62-f86a05dd9b47",
  fccp: "9b074009-d1ec-4451-be62-f86a05dd9b47",
};

/** Stream frame IDs. */
export const OVES_STREAM_IDS: Record<number, OvesField> = { 0xa0: "pckv", 0xa2: "rsoc", 0xa3: "rcap", 0xa4: "fccp" };

/** A battery announces itself as "OVES BATT 100136" (end of its serial number). */
export function isOvesName(name: string | null | undefined): boolean {
  return !!name && /^OVES\b/i.test(name.trim());
}

export interface FieldDescriptor {
  code: string;
  /** 0 = uint16, 2 = uint32, 5 = text; other numbers are kept as they are. */
  size: number;
  label: string;
}

/** "rsoc:0:Relative State of Charge" → { code: "rsoc", size: 0, label: … }; null when not of that form. */
export function parseFieldDescriptor(text: string): FieldDescriptor | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9_]*):(\d+):([^]*)$/.exec(text.replace(/\0+$/, ""));
  return m ? { code: m[1].toLowerCase(), size: Number(m[2]), label: m[3].trim() } : null;
}

function uint(bytes: Uint8Array, n: 2 | 4): number | null {
  if (bytes.length < n) return null;
  let v = 0;
  for (let i = n - 1; i >= 0; i--) v = v * 256 + bytes[i];
  return v;
}

/** A field's value by its descriptor size; without one, by its length (2 or 4 bytes). */
export function decodeFieldValue(bytes: Uint8Array, size: number | null): number | string | null {
  if (size === 5) {
    const end = bytes.indexOf(0);
    const text = new TextDecoder().decode(end >= 0 ? bytes.slice(0, end) : bytes).trim();
    return text || null;
  }
  if (size === 0) return uint(bytes, 2);
  if (size === 2) return uint(bytes, 4);
  if (bytes.length === 2) return uint(bytes, 2);
  if (bytes.length === 4) return uint(bytes, 4);
  return null;
}

/** CRC-16/MODBUS (poly 0xA001 reflected, init 0xFFFF). */
export function crc16Modbus(bytes: Uint8Array): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}

/** One frame of the fff2 stream: its ID and data; null when it is cut, malformed or its CRC is wrong. */
export function parseStreamFrame(bytes: Uint8Array): { id: number; data: Uint8Array } | null {
  if (bytes.length < 8 || bytes[0] !== 0xaa) return null;
  const dl = bytes[3];
  if (bytes[1] !== dl + 5 || bytes.length < dl + 8) return null;
  const end = 4 + dl;
  if (bytes[end + 2] !== 0x5b || bytes[end + 3] !== 0x5a) return null;
  const crc = bytes[end] | (bytes[end + 1] << 8);
  if (crc16Modbus(bytes.slice(1, end)) !== crc) return null;
  return { id: bytes[2], data: bytes.slice(4, end) };
}

export interface OvesReading {
  /** Charge, 0…100. */
  socPct: number | null;
  /** Pack voltage, mV. */
  voltageMv: number | null;
  /** Remaining and full capacity as the battery gives them (mAh by the values seen). */
  remainingMah: number | null;
  fullMah: number | null;
  /** Serial number when the battery gives it (opid), e.g. "B0724525100136". */
  serial: string | null;
}

/** The reading from the decoded fields; a charge outside 0…100 is dropped. */
export function toReading(fields: Partial<Record<OvesField, number | string | null>>): OvesReading {
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const soc = num(fields.rsoc);
  return {
    socPct: soc !== null && soc >= 0 && soc <= 100 ? soc : null,
    voltageMv: num(fields.pckv),
    remainingMah: num(fields.rcap),
    fullMah: num(fields.fccp),
    serial: typeof fields.opid === "string" && fields.opid ? fields.opid : null,
  };
}

/** "B0724525100136" vs "b0724525100136 " → same; the battery number typed or scanned at a swap. */
export function sameSerial(a: string, b: string): boolean {
  const clean = (s: string) => s.replace(/\s+/g, "").toUpperCase();
  return clean(a) !== "" && clean(a) === clean(b);
}
