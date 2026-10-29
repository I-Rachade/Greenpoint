// Parsing and handling of connected-socket messages. Dependency-free so it runs
// both in the Worker (worker/devices.ts) and in the app's tests (Node).

/** Status a device can report. "reserved" is set by the app, never by hardware. */
export type DeviceStatus = "free" | "charging" | "done" | "fault";

export interface OutletReading {
  outlet: number;
  status?: DeviceStatus;
  powerWatts?: number;
  energyWh?: number;
  /** The charge the reading belongs to, when the device says (Xingke cloud transactionId). */
  transactionId?: string;
}

/** The device's answer to a start or stop command we sent (see worker/devices.ts). */
export interface CommandAck {
  order: string;
  kind: "start" | "stop";
  ok: boolean;
  code?: string;
}

/** One message from a socket, independent of how it reached us. */
export interface DeviceEvent {
  externalId: string;
  outlets: OutletReading[];
  /** A fault of the whole device: every outlet takes this status. */
  allOutlets?: DeviceStatus;
  ack?: CommandAck;
}

/**
 * Where the message comes from:
 * - `generic`: our own JSON, for a vendor cloud or a small bridge we run.
 * - `ttn`: The Things Network (v3) uplink webhook.
 * - `chirpstack`: ChirpStack (v4) HTTP integration, "up" event.
 * - `xingke`: the text lines of the Xingke 16-port protocol V1.1, sent as plain
 *   text by a bridge (planung/xingke-16-port-protocol-v1.1-en.md).
 * For LoRaWAN the payload formatter on the network server must decode the
 * vendor's bytes into the generic `outlets` shape (see docs/steckdosen-lora.md).
 */
export type DeviceFormat = "generic" | "ttn" | "chirpstack" | "xingke";
export const DEVICE_FORMATS: DeviceFormat[] = ["generic", "ttn", "chirpstack", "xingke"];

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

export function parseDeviceEvent(format: Exclude<DeviceFormat, "xingke">, body: unknown): DeviceEvent {
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

// Xingke 16-port protocol ---------------------------------------------------
// Lines like "MOD:52;EID:123456;PORT:0000|0101;\r\n". EID is the 6-digit device
// number, plus the 2-digit channel when a port is meant. Channels count from 00,
// outlets from 1.

/** Splits a text body into messages of field name to value. */
export function parseXingkeLines(text: string): Record<string, string>[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const fields: Record<string, string> = {};
      for (const part of line.split(/[;；]/)) {
        const at = part.search(/[:：]/);
        if (at > 0) fields[part.slice(0, at).trim().toUpperCase()] = part.slice(at + 1).trim();
      }
      if (!fields.MOD) throw new DeviceParseError(`MOD missing in "${line.slice(0, 80)}"`);
      return fields;
    });
}

function xingkeTerminal(eid: string | undefined): { device: string; outlet?: number } {
  if (!eid || !/^\d{6}(\d{2})?$/.test(eid)) throw new DeviceParseError(`EID must be 6 or 8 digits`);
  return eid.length === 8 ? { device: eid.slice(0, 6), outlet: Number(eid.slice(6)) + 1 } : { device: eid };
}

function xingkeNumber(value: string | undefined, scale: number): number | undefined {
  if (value === undefined || value === "") return undefined;
  if (!/^\d+$/.test(value)) throw new DeviceParseError(`"${value}" is not a number`);
  return Math.round(Number(value) / scale);
}

/** Order status (MOD 51) message codes: only 00 and 03 keep the outlet busy. */
function xingkeOrderStatus(msg: string | undefined): DeviceStatus {
  if (msg === "00") return "charging";
  if (msg === "03") return "done";
  if (msg === "08") return "fault"; // device temperature
  return "free"; // stopped: unplugged, nothing connected, protection, balance 0
}

/** Port status in the device status report (MOD 52): 00 idle, 01 charging, 90/91/99 faults. */
function xingkePortStatus(code: string): DeviceStatus {
  return code === "00" ? "free" : code === "01" ? "charging" : "fault";
}

/**
 * Turns one Xingke message into an event; null for messages that change no
 * outlet and name no device (firmware upgrade result).
 */
export function xingkeEvent(f: Record<string, string>): DeviceEvent | null {
  switch (f.MOD) {
    case "51": {
      const t = xingkeTerminal(f.EID);
      if (!t.outlet) throw new DeviceParseError("MOD 51 needs an 8-digit EID");
      return {
        externalId: t.device,
        outlets: [
          {
            outlet: t.outlet,
            status: xingkeOrderStatus(f.MSG),
            powerWatts: xingkeNumber(f.P, 1000), // 0.001 W
            energyWh: xingkeNumber(f.E, 1), // 0.001 kWh = 1 Wh
          },
        ],
      };
    }
    case "52": {
      const t = xingkeTerminal(f.EID);
      const outlets = (f.PORT ?? "")
        .split(/[|,]/)
        .filter(Boolean)
        .map((entry) => {
          if (!/^\d{4}$/.test(entry)) throw new DeviceParseError(`PORT entry "${entry}" must be 4 digits`);
          return { outlet: Number(entry.slice(0, 2)) + 1, status: xingkePortStatus(entry.slice(2)) };
        });
      return { externalId: t.device, outlets };
    }
    case "70": {
      const t = xingkeTerminal(f.EID);
      return t.outlet
        ? { externalId: t.device, outlets: [{ outlet: t.outlet, status: "fault" }] }
        : { externalId: t.device, outlets: [], allOutlets: "fault" };
    }
    case "01":
    case "02": {
      const t = xingkeTerminal(f.EID);
      const start = f.MOD === "01";
      const ok = f.RES === "0";
      const ack: CommandAck = { order: f.ORD ?? "", kind: start ? "start" : "stop", ok, code: f.MSG };
      // "05" = this channel is already charging.
      const status: DeviceStatus | undefined = start ? (ok || f.MSG === "05" ? "charging" : undefined) : ok ? "free" : undefined;
      return {
        externalId: t.device,
        outlets: t.outlet && status ? [{ outlet: t.outlet, status }] : [],
        ack,
      };
    }
    case "98":
      return null;
    default: {
      // Card swipe (53), parameter and restart results (90, 91, 99): a sign of life.
      const t = xingkeTerminal(f.EID);
      return { externalId: t.device, outlets: [] };
    }
  }
}

/** All events in a text body, in order. */
export function parseXingke(text: string): DeviceEvent[] {
  return parseXingkeLines(text)
    .map(xingkeEvent)
    .filter((e): e is DeviceEvent => e !== null);
}

/** One outlet reading as ingest() takes it. */
export interface IngestOutlet {
  outlet: number;
  status?: DeviceStatus;
  power_watts?: number;
  energy_wh?: number;
  transaction_id?: string;
}

/** Outlet readings as the Worker stores them (worker/devices.ts). */
export function toIngestOutlets(event: DeviceEvent): IngestOutlet[] {
  return event.outlets.map((o) => ({
    outlet: o.outlet,
    status: o.status,
    power_watts: o.powerWatts,
    energy_wh: o.energyWh,
    transaction_id: o.transactionId,
  }));
}

/** Stores one message; returns the number of outlets updated. */
export type Ingest = (
  externalId: string,
  outlets: IngestOutlet[],
  payload: unknown,
  extra?: Pick<DeviceEvent, "allOutlets" | "ack">,
) => Promise<{ updated: number } | { error: string }>;

/** Compares secrets (or their hashes) in constant time. */
export function sameSecret(given: string | null, expected: string): boolean {
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

/** The error response when a request lacks the device key, or null when it has it. */
export function deviceKeyError(request: Request, secret: string | undefined): Response | null {
  if (!secret) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!sameSecret(providedKey(request), secret)) return Response.json({ error: "unauthorized" }, { status: 401 });
  return null;
}

/**
 *   POST /api/devices/events?format=generic|ttn|chirpstack
 *   X-Device-Key: <DEVICE_WEBHOOK_SECRET>   (or Authorization: Bearer <secret>)
 */
export async function handleDeviceRequest(request: Request, secret: string | undefined, ingest: Ingest) {
  if (request.method !== "POST") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const denied = deviceKeyError(request, secret);
  if (denied) return denied;

  const format = (new URL(request.url).searchParams.get("format") ?? "generic") as DeviceFormat;
  if (!DEVICE_FORMATS.includes(format)) return Response.json({ error: "unknown_format" }, { status: 400 });
  if (format === "xingke") return handleXingke(await request.text(), ingest);

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

/** A Xingke body can carry several lines; each is stored on its own. */
async function handleXingke(text: string, ingest: Ingest) {
  let messages: [Record<string, string>, DeviceEvent | null][];
  try {
    messages = parseXingkeLines(text).map((fields) => [fields, xingkeEvent(fields)]);
  } catch (err) {
    if (err instanceof DeviceParseError) return Response.json({ error: err.message }, { status: 422 });
    throw err;
  }
  const results = [];
  for (const [fields, event] of messages) {
    if (!event) continue;
    const { allOutlets, ack } = event;
    const result = await ingest(event.externalId, toIngestOutlets(event), fields, { allOutlets, ack });
    results.push({ device: event.externalId, ...result });
  }
  const unknown = results.length > 0 && results.every((r) => "error" in r);
  return Response.json({ results }, { status: unknown ? 404 : 200 });
}
