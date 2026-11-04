import { BleClient, type BleService } from "@capacitor-community/bluetooth-le";
import {
  decodeFieldValue,
  isOvesName,
  OVES_DATA_SERVICE,
  OVES_FIELD_UUIDS,
  OVES_FIELDS,
  OVES_STREAM_CHARACTERISTIC,
  OVES_STREAM_IDS,
  OVES_STREAM_SERVICE,
  parseFieldDescriptor,
  parseStreamFrame,
  toReading,
  USER_DESCRIPTION,
  type OvesField,
  type OvesReading,
} from "@shared/ble-oves";

// Reads an Omnivoltaic battery over Bluetooth in the app (shared/ble-oves.ts has the protocol):
// connect, read the data service field by field (each named by its 0x2901 descriptor), or
// listen to the fff2 stream when that service is missing, then disconnect.

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

async function readDataService(id: string, service: BleService): Promise<Partial<Record<OvesField, number | string | null>>> {
  const fields: Partial<Record<OvesField, number | string | null>> = {};
  for (const c of service.characteristics) {
    if (!c.properties.read) continue;
    let code: string | null = null;
    let size: number | null = null;
    if (c.descriptors.some((d) => same(d.uuid, USER_DESCRIPTION))) {
      try {
        const d = parseFieldDescriptor(new TextDecoder().decode(bytesOf(await BleClient.readDescriptor(id, service.uuid, c.uuid, USER_DESCRIPTION))));
        if (d) ({ code, size } = d);
      } catch {
        // fall back to the known UUIDs below
      }
    }
    code ??= (Object.entries(OVES_FIELD_UUIDS).find(([, uuid]) => same(uuid, c.uuid))?.[0] as OvesField | undefined) ?? null;
    if (!code || !(OVES_FIELDS as readonly string[]).includes(code)) continue;
    fields[code as OvesField] = decodeFieldValue(bytesOf(await BleClient.read(id, service.uuid, c.uuid)), size);
  }
  return fields;
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

/** Connects to the battery, reads it and disconnects (always). Throws when it cannot give its charge. */
export async function readBattery(id: string): Promise<OvesReading> {
  await BleClient.connect(id, undefined, { timeout: 10_000 });
  try {
    const services = await BleClient.getServices(id);
    const data = services.find((s) => same(s.uuid, OVES_DATA_SERVICE));
    let fields = data ? await readDataService(id, data) : {};
    if (typeof fields.rsoc !== "number" && services.some((s) => same(s.uuid, OVES_STREAM_SERVICE))) {
      fields = { ...(await readStream(id)), ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== null && v !== undefined)) };
    }
    const reading = toReading(fields);
    if (reading.socPct === null) throw new Error("no_soc");
    return reading;
  } finally {
    await BleClient.disconnect(id).catch(() => {});
  }
}
