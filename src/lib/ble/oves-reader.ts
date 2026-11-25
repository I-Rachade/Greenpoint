import { BleClient, type BleService } from "@capacitor-community/bluetooth-le";
import {
  decodeFieldValue,
  isOvesName,
  looksLikeSerial,
  OVES_DATA_SERVICE,
  OVES_FIELD_UUIDS,
  OVES_FIELDS,
  OVES_STREAM_CHARACTERISTIC,
  OVES_STREAM_IDS,
  OVES_STREAM_SERVICE,
  parseFieldDescriptor,
  parseStreamFrame,
  SERIAL_NUMBER_STRING,
  serialSuffixFromName,
  toReading,
  USER_DESCRIPTION,
  type OvesField,
  type OvesReading,
} from "@shared/ble-oves";

// Reads an Omnivoltaic battery over Bluetooth in the app (shared/ble-oves.ts has the protocol):
// connect, read the fields (each named by its 0x2901 descriptor) including the serial number,
// or listen to the fff2 stream when the charge is missing, then disconnect.

export interface FoundBattery {
  id: string;
  name: string;
  rssi: number | null;
}

let initialized = false;

/** Initializes the plugin once; false when Bluetooth is off (the caller offers to turn it on). */
export async function bleReady(): Promise<boolean> {
  if (!initialized) {
    await BleClient.initialize();
    initialized = true;
  }
  return BleClient.isEnabled();
}

/** Scans for OVES batteries; calls `onFound` with each one (again when its signal changes). Stop with stopScan(). */
export async function scanBatteries(onFound: (b: FoundBattery) => void): Promise<void> {
  await BleClient.requestLEScan({ allowDuplicates: true }, (r) => {
    const name = r.localName ?? r.device.name ?? null;
    if (!isOvesName(name)) return;
    onFound({ id: r.device.deviceId, name: name!.trim(), rssi: r.rssi ?? null });
  });
}

export async function stopScan(): Promise<void> {
  await BleClient.stopLEScan().catch(() => {});
}

function bytesOf(v: DataView): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

type Fields = Partial<Record<OvesField, number | string | null>>;

/** Generic Access / Generic Attribute: nothing of the battery's own there. */
const SKIP_SERVICES = ["00001800-0000-1000-8000-00805f9b34fb", "00001801-0000-1000-8000-00805f9b34fb"];

async function describe(id: string, service: string, c: BleService["characteristics"][number]): Promise<{ code: string; size: number } | null> {
  if (!c.descriptors.some((d) => same(d.uuid, USER_DESCRIPTION))) return null;
  try {
    const d = parseFieldDescriptor(new TextDecoder().decode(bytesOf(await BleClient.readDescriptor(id, service, c.uuid, USER_DESCRIPTION))));
    return d ? { code: d.code, size: d.size } : null;
  } catch {
    return null;
  }
}

/**
 * Reads the battery's fields, each named by its 0x2901 descriptor, in the data service and
 * in the battery's other services (its serial number, opid, may sit outside the data service).
 * Texts that are not named opid are kept as serial candidates.
 */
async function readFields(id: string, services: BleService[]): Promise<{ fields: Fields; texts: string[] }> {
  const fields: Fields = {};
  const texts: string[] = [];
  const ordered = [...services].sort((a, b) => Number(same(b.uuid, OVES_DATA_SERVICE)) - Number(same(a.uuid, OVES_DATA_SERVICE)));
  for (const service of ordered) {
    if (SKIP_SERVICES.some((u) => same(u, service.uuid))) continue;
    const isData = same(service.uuid, OVES_DATA_SERVICE);
    for (const c of service.characteristics) {
      if (!c.properties.read) continue;
      try {
        if (same(c.uuid, SERIAL_NUMBER_STRING)) {
          const t = decodeFieldValue(bytesOf(await BleClient.read(id, service.uuid, c.uuid)), 5);
          if (typeof t === "string") texts.push(t);
          continue;
        }
        const d = await describe(id, service.uuid, c);
        let code = d?.code ?? null;
        if (!code && isData) code = Object.entries(OVES_FIELD_UUIDS).find(([, uuid]) => same(uuid, c.uuid))?.[0] ?? null;
        const known = !!code && (OVES_FIELDS as readonly string[]).includes(code);
        // Outside the data service only the serial and text fields are worth a read.
        if (!known && d?.size !== 5) continue;
        if (known && !isData && code !== "opid") continue;
        if (known && fields[code as OvesField] !== undefined) continue;
        const v = decodeFieldValue(bytesOf(await BleClient.read(id, service.uuid, c.uuid)), d?.size ?? null);
        if (known) fields[code as OvesField] = v;
        else if (typeof v === "string") texts.push(v);
      } catch {
        // one field that cannot be read does not stop the others
      }
    }
  }
  return { fields, texts };
}

/** Listens to the fff2 stream until the charge came in, or `ms` passed. */
async function readStream(id: string, ms = 4000): Promise<Partial<Record<OvesField, number | string | null>>> {
  const fields: Partial<Record<OvesField, number | string | null>> = {};
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    BleClient.startNotifications(id, OVES_STREAM_SERVICE, OVES_STREAM_CHARACTERISTIC, (v) => {
      const frame = parseStreamFrame(bytesOf(v));
      const field = frame ? OVES_STREAM_IDS[frame.id] : undefined;
      if (!frame || !field) return;
      fields[field] = decodeFieldValue(frame.data, null);
      if (fields.rsoc !== undefined && fields.pckv !== undefined && fields.fccp !== undefined) {
        clearTimeout(timer);
        resolve();
      }
    }).catch((e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
  await BleClient.stopNotifications(id, OVES_STREAM_SERVICE, OVES_STREAM_CHARACTERISTIC).catch(() => {});
  return fields;
}

export interface BatteryReading extends OvesReading {
  /** End of the serial number from the battery's Bluetooth name ("100136"), to check or complete it. */
  nameSuffix: string | null;
}

/**
 * Connects to the battery, reads it and disconnects (always): its charge and its serial number
 * (opid, else a text field that ends like its Bluetooth name). Throws when it cannot give its charge.
 */
export async function readBattery(id: string, name?: string | null): Promise<BatteryReading> {
  const nameSuffix = serialSuffixFromName(name);
  await BleClient.connect(id, undefined, { timeout: 10_000 });
  try {
    const services = await BleClient.getServices(id);
    const read = await readFields(id, services);
    let fields = read.fields;
    if (typeof fields.rsoc !== "number" && services.some((s) => same(s.uuid, OVES_STREAM_SERVICE))) {
      fields = { ...(await readStream(id)), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)) };
    }
    const reading = toReading(fields);
    if (reading.socPct === null) throw new Error("no_soc");
    if (!reading.serial) {
      const found = read.texts.find((t) => looksLikeSerial(t, nameSuffix));
      if (found) reading.serial = found.trim().toUpperCase();
    }
    return { ...reading, nameSuffix };
  } finally {
    await BleClient.disconnect(id).catch(() => {});
  }
}
