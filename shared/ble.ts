// Bluetooth (BLE) helpers for reading batteries, used by the diagnostic screen
// (src/components/ble/ble-diagnostic.tsx, /operator/bluetooth). Pure functions, no plugin:
// hex in and out, the names of the standard GATT services and characteristics, the values a
// standard characteristic carries (battery level 0x2A19 = charge in %, Device Information
// strings), and the report an admin exports to map a battery's own (proprietary) service.

/** Ending of every 16-bit UUID written out in full (Bluetooth base UUID). */
const BASE_UUID_TAIL = "-0000-1000-8000-00805f9b34fb";

/** "0000180f-0000-1000-8000-00805f9b34fb" → "180f"; a 128-bit vendor UUID stays whole (lower case). */
export function shortUuid(uuid: string): string {
  const u = uuid.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(u)) return u;
  if (/^0000[0-9a-f]{4}/.test(u) && u.endsWith(BASE_UUID_TAIL) && u.length === 36) return u.slice(4, 8);
  return u;
}

export const STANDARD_SERVICES: Record<string, string> = {
  "1800": "Generic Access",
  "1801": "Generic Attribute",
  "180a": "Device Information",
  "180f": "Battery Service",
  "181a": "Environmental Sensing",
  fe59: "Nordic DFU",
};

export const STANDARD_CHARACTERISTICS: Record<string, string> = {
  "2a00": "Device Name",
  "2a01": "Appearance",
  "2a04": "Connection Parameters",
  "2a05": "Service Changed",
  "2a19": "Battery Level",
  "2a23": "System ID",
  "2a24": "Model Number",
  "2a25": "Serial Number",
  "2a26": "Firmware Revision",
  "2a27": "Hardware Revision",
  "2a28": "Software Revision",
  "2a29": "Manufacturer Name",
  "2a6e": "Temperature",
  "2902": "Client Characteristic Configuration",
};

/** The standard name of a service, or null for a vendor's own service. */
export function serviceName(uuid: string): string | null {
  return STANDARD_SERVICES[shortUuid(uuid)] ?? null;
}

export function characteristicName(uuid: string): string | null {
  return STANDARD_CHARACTERISTICS[shortUuid(uuid)] ?? null;
}

/** Bytes as "01 A2 FF"; "" for none. */
export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0").toUpperCase()).join(" ");
}

/** "01 a2 ff", "01A2FF", "0x01,0xA2": bytes; null when not an even run of hex digits. */
export function parseHex(text: string): Uint8Array | null {
  const clean = text.replace(/0x/gi, "").replace(/[\s,:;-]/g, "");
  if (clean.length === 0 || clean.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Printable ASCII, every other byte as "·": shows text hidden in a frame (a serial number). */
export function toAscii(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : "·")).join("");
}

/** Characteristics that hold a UTF-8 string (Device Information, device name). */
const STRING_CHARACTERISTICS = new Set(["2a00", "2a24", "2a25", "2a26", "2a27", "2a28", "2a29"]);

export interface DecodedValue {
  /** What the value is, e.g. "Battery Level". */
  label: string;
  /** As shown, e.g. "87 %". */
  text: string;
  /** Battery Level: the charge, 0…100. */
  socPct?: number;
}

/** The value of a standard characteristic; null for a vendor's own one (read its hex instead). */
export function decodeStandard(uuid: string, bytes: Uint8Array): DecodedValue | null {
  const id = shortUuid(uuid);
  const label = STANDARD_CHARACTERISTICS[id];
  if (!label || bytes.length === 0) return null;
  if (id === "2a19") {
    const pct = bytes[0];
    return pct <= 100 ? { label, text: `${pct} %`, socPct: pct } : { label, text: `${pct} (hors 0…100)` };
  }
  if (STRING_CHARACTERISTICS.has(id)) {
    const end = bytes.indexOf(0);
    const text = new TextDecoder().decode(end >= 0 ? bytes.slice(0, end) : bytes).trim();
    return { label, text };
  }
  return null;
}

/** One frame seen during a diagnostic: a read, a notification, or a write sent to the battery. */
export interface BleFrame {
  at: string;
  kind: "read" | "notify" | "write";
  service: string;
  characteristic: string;
  hex: string;
  /** What the admin wrote next to it, e.g. "batterie affiche 64 %, 53,2 V". */
  note?: string;
}

export interface BleCharacteristicInfo {
  uuid: string;
  name: string | null;
  properties: string[];
}

export interface BleServiceInfo {
  uuid: string;
  name: string | null;
  characteristics: BleCharacteristicInfo[];
}

export interface BleReport {
  app: "poinderecharge";
  kind: "ble-diagnostic";
  createdAt: string;
  device: { id: string; name: string | null; rssi: number | null; advertisedServices: string[]; manufacturerData: Record<string, string> };
  services: BleServiceInfo[];
  frames: BleFrame[];
  note: string;
}

/** The properties a characteristic offers, in a fixed order, e.g. ["read", "notify"]. */
export function propertyList(p: Partial<Record<string, boolean>>): string[] {
  return ["read", "write", "writeWithoutResponse", "notify", "indicate", "broadcast", "authenticatedSignedWrites"].filter((k) => p[k]);
}

/** File name for an exported report: "ble-<device>-<date>.json", safe for any phone. */
export function reportFileName(deviceName: string | null, at: Date): string {
  const name = (deviceName ?? "batterie").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "batterie";
  const stamp = at.toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `ble-${name}-${stamp}.json`;
}
