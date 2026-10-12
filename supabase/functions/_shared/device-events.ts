// Parsing and handling of connected-socket messages. Dependency-free so it runs
// both in the Supabase Edge Function (Deno) and in the app's tests (Node).

/** Status a device can report. "reserved" is set by the app, never by hardware. */
export type DeviceStatus = "free" | "charging" | "done" | "fault";

export interface OutletReading {
  outlet: number;
  status?: DeviceStatus;
  powerWatts?: number;
  energyWh?: number;
}

/** One message from a socket, independent of how it reached us. */
export interface DeviceEvent {
  externalId: string;
  outlets: OutletReading[];
}

/**
 * Where the message comes from:
 * - `generic`: our own JSON, for a vendor cloud or a small bridge we run.
 * - `ttn`: The Things Network (v3) uplink webhook.
 * - `chirpstack`: ChirpStack (v4) HTTP integration, "up" event.
 * For LoRaWAN the payload formatter on the network server must decode the
 * vendor's bytes into the generic `outlets` shape (see docs/steckdosen-lora.md).
 */
export type DeviceFormat = "generic" | "ttn" | "chirpstack";
export const DEVICE_FORMATS: DeviceFormat[] = ["generic", "ttn", "chirpstack"];

export class DeviceParseError extends Error {}

/** Below this draw an outlet counts as idle when the device sends no status. */
const IDLE_WATTS = 5;

const STATUS_ALIASES: Record<string, DeviceStatus> = {
  free: "free",
  idle: "free",
  available: "free",
  off: "free",
  charging: "charging",
  on: "charging",
  busy: "charging",
  done: "done",
  finished: "done",
  full: "done",
  complete: "done",
  fault: "fault",
  error: "fault",
  overload: "fault",
};

function record(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DeviceParseError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalNumber(value: unknown, what: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) {
    throw new DeviceParseError(`${what} must be a non-negative number`);
  }
  return Math.round(n);
}

export function normalizeStatus(value: unknown, powerWatts?: number): DeviceStatus | undefined {
  if (value === undefined || value === null) {
    if (powerWatts === undefined) return undefined;
    return powerWatts > IDLE_WATTS ? "charging" : "free";
  }
  const status = STATUS_ALIASES[String(value).trim().toLowerCase()];
  if (!status) throw new DeviceParseError(`unknown status "${String(value)}"`);
  return status;
}

function parseOutlet(value: unknown, index: number): OutletReading {
  const o = record(value, `outlets[${index}]`);
  const outlet = optionalNumber(o.outlet ?? o.port ?? o.socket, `outlets[${index}].outlet`);
  if (!outlet) throw new DeviceParseError(`outlets[${index}].outlet must be 1 or more`);
  const powerWatts = optionalNumber(o.power_watts ?? o.power ?? o.watts, `outlets[${index}].power_watts`);
  const energyWh = optionalNumber(o.energy_wh ?? o.energy, `outlets[${index}].energy_wh`);
  const status = normalizeStatus(o.status ?? o.state, powerWatts);
  return { outlet, status, powerWatts, energyWh };
}

/** Reads `{ outlets: [...] }`, the decoded payload every format carries. */
function parseOutlets(payload: unknown): OutletReading[] {
  const p = record(payload, "payload");
  if (p.outlets === undefined) return []; // heartbeat
  if (!Array.isArray(p.outlets)) throw new DeviceParseError("outlets must be a list");
  return p.outlets.map(parseOutlet);
}

function deviceId(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new DeviceParseError("device id missing");
  return value.trim().toUpperCase();
}

export function parseDeviceEvent(format: DeviceFormat, body: unknown): DeviceEvent {
  const b = record(body, "body");
  switch (format) {
    case "generic":
      return { externalId: deviceId(b.device), outlets: parseOutlets(b) };
    case "ttn": {
      const ids = record(b.end_device_ids, "end_device_ids");
      const uplink = record(b.uplink_message, "uplink_message");
      return { externalId: deviceId(ids.dev_eui), outlets: parseOutlets(uplink.decoded_payload ?? {}) };
    }
    case "chirpstack": {
      const info = record(b.deviceInfo, "deviceInfo");
      return { externalId: deviceId(info.devEui), outlets: parseOutlets(b.object ?? {}) };
    }
  }
}

/** Shape expected by the `ingest_device_event` database function. */
export function toIngestOutlets(event: DeviceEvent) {
  return event.outlets.map((o) => ({
    outlet: o.outlet,
    status: o.status,
    power_watts: o.powerWatts,
    energy_wh: o.energyWh,
  }));
}

/** Calls the `ingest_device_event` database function; returns the number of outlets updated. */
export type Ingest = (
  externalId: string,
  outlets: ReturnType<typeof toIngestOutlets>,
  payload: unknown,
) => Promise<{ updated: number } | { error: string }>;

function sameSecret(given: string | null, expected: string): boolean {
  if (!given || given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function providedKey(request: Request): string | null {
  const key = request.headers.get("x-device-key");
  if (key) return key.trim();
  const auth = request.headers.get("authorization");
  return auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
}

/**
 *   POST .../device-events?format=generic|ttn|chirpstack
 *   X-Device-Key: <DEVICE_WEBHOOK_SECRET>   (or Authorization: Bearer <secret>)
 */
export async function handleDeviceRequest(request: Request, secret: string | undefined, ingest: Ingest) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!sameSecret(providedKey(request), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });

  const format = (new URL(request.url).searchParams.get("format") ?? "generic") as DeviceFormat;
  if (!DEVICE_FORMATS.includes(format)) return Response.json({ error: "unknown_format" }, { status: 400 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  let event: DeviceEvent;
  try {
    event = parseDeviceEvent(format, body);
  } catch (err) {
    if (err instanceof DeviceParseError) return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }

  const result = await ingest(event.externalId, toIngestOutlets(event), body);
  if ("error" in result) {
    const unknown = result.error.includes("unknown_device");
    return Response.json({ error: unknown ? "unknown_device" : "ingest_failed" }, { status: unknown ? 404 : 500 });
  }
  return Response.json({ device: event.externalId, updated: result.updated });
}
