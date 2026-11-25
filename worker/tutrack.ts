import type { Env } from "./env";

// Tutrack (Tuqiang Enterprise Open API V1.1.0): the GPS trackers and ignition locks of the Share
// vehicles. HTTP for commands and a fresh status; positions, online changes and alarms arrive by
// MQTT (worker/tutrack-bridge.ts). Without credentials the trackers are simulated: commands
// succeed on their own and the app sends the phone's position during a ride (docs/SHARE.md).

export const TUTRACK_BASE_URL = "https://openapi-ent.tqiot.com";
const TOKEN_SECONDS = 7200;
/** Ask for a new token this long before the old one runs out. */
const TOKEN_MARGIN_MS = 5 * 60_000;

export type TrackerAction = "unlock" | "lock" | "locate";

/** What a tracker says about its vehicle right now. */
export interface TrackerStatus {
  online: boolean;
  ignition: boolean | null;
  batteryPercent: number | null;
  lat: number | null;
  lng: number | null;
  /** Time of the position, ISO in UTC. */
  fixAt: string | null;
}

export interface TrackerVehicle {
  trackerId: string | null;
  unlockCommand: string;
  lockCommand: string;
}

export interface Tracker {
  readonly name: "tutrack" | "simulated";
  /** Sends a command; throws TrackerError when the tracker refused it or cannot be reached. */
  command(vehicle: TrackerVehicle, action: TrackerAction): Promise<void>;
  /** Fresh status; null when the tracker cannot be asked (simulated, or no tracker fitted). */
  status(trackerId: string): Promise<TrackerStatus | null>;
}

export class TrackerError extends Error {}

type Fetch = typeof fetch;

/** Tutrack sends Beijing time (UTC+8) without a zone in its V1 answers and in MQTT; V2 answers carry one. */
export function tutrackTime(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const s = value.trim();
  const zoned = /[zZ]|[+-]\d\d:?\d\d$/.test(s);
  const ms = Date.parse(zoned ? s : `${s.replace(" ", "T")}+08:00`);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** The device detail of the V2 API as a TrackerStatus. */
export function statusFromDetail(data: unknown): TrackerStatus {
  const status = ((data as { deviceStatus?: Record<string, unknown> })?.deviceStatus ?? {}) as Record<string, unknown>;
  const pos = (status.posInfo ?? {}) as Record<string, unknown>;
  const lat = num(pos.lat);
  const lng = num(pos.lng);
  const online = status.onlineStatus;
  const percent = num(status.powerPercent);
  const acc = num(status.acc);
  return {
    online: online === 1 || online === "1" || online === "ONLINE",
    ignition: acc === null ? null : acc === 1,
    batteryPercent: percent === null ? null : Math.max(0, Math.min(100, Math.round(percent))),
    // 0/0 is what an unknown position looks like.
    lat: lat && lng ? lat : null,
    lng: lat && lng ? lng : null,
    fixAt: tutrackTime(status.lastPosTime),
  };
}

/** The tracker set up for the Worker: Tutrack once SHARE_TRACKER_PROVIDER is "tutrack" and the keys are set. */
export function trackerFromEnv(env: Env, fetchImpl: Fetch = fetch): Tracker {
  if (env.SHARE_TRACKER_PROVIDER === "tutrack" && env.TUTRACK_ACCESS_KEY && env.TUTRACK_ACCESS_SECRET) {
    return tutrackTracker({ accessKey: env.TUTRACK_ACCESS_KEY, secret: env.TUTRACK_ACCESS_SECRET, baseUrl: env.TUTRACK_BASE_URL || TUTRACK_BASE_URL }, fetchImpl);
  }
  return simulatedTracker();
}

export function simulatedTracker(): Tracker {
  return {
    name: "simulated",
    async command() {},
    async status() {
      return null;
    },
  };
}

interface Token {
  value: string;
  expiresAt: number;
}

/** Tokens per access key, kept for the life of the Worker instance. */
const tokens = new Map<string, Token>();

export function tutrackTracker(config: { accessKey: string; secret: string; baseUrl: string }, fetchImpl: Fetch = fetch): Tracker {
  const base = config.baseUrl.replace(/\/+$/, "");

  async function token(): Promise<string> {
    const cached = tokens.get(config.accessKey);
    if (cached && cached.expiresAt - TOKEN_MARGIN_MS > Date.now()) return cached.value;
    const res = await fetchImpl(`${base}/api/ent-manager/tenant/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accessKey: config.accessKey, sign: md5(`${config.accessKey}${config.secret}${TOKEN_SECONDS}`), expiresSecond: TOKEN_SECONDS }),
    });
    const body = (await res.json().catch(() => null)) as { code?: string; data?: { token?: string } } | null;
    if (!res.ok || body?.code !== "00000" || !body.data?.token) throw new TrackerError(`tutrack auth ${res.status} ${body?.code ?? ""}`);
    tokens.set(config.accessKey, { value: body.data.token, expiresAt: Date.now() + TOKEN_SECONDS * 1000 });
    return body.data.token;
  }

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      method,
      headers: { "Content-Type": "application/json", token: await token() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const out = (await res.json().catch(() => null)) as { code?: string; data?: T; msg?: string } | null;
    if (res.status === 401) tokens.delete(config.accessKey);
    if (!res.ok || out?.code !== "00000") throw new TrackerError(`tutrack ${path} ${res.status} ${out?.code ?? ""} ${out?.msg ?? ""}`.trim());
    return out.data as T;
  }

  return {
    name: "tutrack",
    async command(vehicle, action) {
      if (!vehicle.trackerId) throw new TrackerError("no tracker");
      const code = action === "unlock" ? vehicle.unlockCommand : action === "lock" ? vehicle.lockCommand : "locate_now";
      if (!code) throw new TrackerError(`no ${action} command set`);
      await call("POST", "/ent-openapi/api/ent-manager/tenant/v2/cmd/v2/send", { cmdCategoryCode: code, deviceId: vehicle.trackerId });
    },
    async status(trackerId) {
      return statusFromDetail(await call("GET", `/ent-openapi/api/ent-manager/tenant/v2/device/detail/get/${encodeURIComponent(trackerId)}`));
    },
  };
}

/** Forgets cached tokens (tests). */
export function resetTutrackTokens() {
  tokens.clear();
}

// MD5 for the signature of the token request (Web Crypto has none). RFC 1321.

const S = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
const K = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32) >>> 0);

export function md5(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const length = ((bytes.length + 8) >>> 6) * 64 + 64;
  const msg = new Uint8Array(length);
  msg.set(bytes);
  msg[bytes.length] = 0x80;
  const view = new DataView(msg.buffer);
  view.setUint32(length - 8, (bytes.length * 8) >>> 0, true);
  view.setUint32(length - 4, Math.floor((bytes.length * 8) / 2 ** 32), true);
  let a0 = 0x67452301,
    b0 = 0xefcdab89,
    c0 = 0x98badcfe,
    d0 = 0x10325476;
  for (let off = 0; off < length; off += 64) {
    let a = a0,
      b = b0,
      c = c0,
      d = d0;
    for (let i = 0; i < 64; i++) {
      let f: number, g: number;
      if (i < 16) [f, g] = [(b & c) | (~b & d), i];
      else if (i < 32) [f, g] = [(d & b) | (~d & c), (5 * i + 1) % 16];
      else if (i < 48) [f, g] = [b ^ c ^ d, (3 * i + 5) % 16];
      else [f, g] = [c ^ (b | ~d), (7 * i) % 16];
      const sum = (a + f + K[i] + view.getUint32(off + g * 4, true)) >>> 0;
      a = d;
      d = c;
      c = b;
      b = (b + ((sum << S[i]) | (sum >>> (32 - S[i])))) >>> 0;
    }
    a0 = (a0 + a) >>> 0;
    b0 = (b0 + b) >>> 0;
    c0 = (c0 + c) >>> 0;
    d0 = (d0 + d) >>> 0;
  }
  const out = new DataView(new ArrayBuffer(16));
  [a0, b0, c0, d0].forEach((w, i) => out.setUint32(i * 4, w, true));
  return [...new Uint8Array(out.buffer)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
