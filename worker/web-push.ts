import type { PushNotice } from "./push";
import { nowIso } from "./http";

// Push notices in the browser (web app) through the standard Web Push protocol: RFC 8030
// delivery, RFC 8291 payload encryption and RFC 8292 VAPID sign-in, all with WebCrypto.
// Firebase is not needed for this. The VAPID key pair is made once and kept in app_settings
// like the driver pass secret; only its public half leaves the Worker.

interface VapidKeys {
  /** Uncompressed P-256 point, base64url: the browser's applicationServerKey. */
  publicKey: string;
  privateJwk: JsonWebKey;
}

export interface WebSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

const SETTING = "web_push_vapid";
const CONTACT = "mailto:contact@poinderecharge.com";

export const b64url = (bytes: ArrayBuffer | Uint8Array) => {
  let s = "";
  new Uint8Array(bytes).forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export const fromB64url = (text: string) => {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (ch) => ch.charCodeAt(0));
};

const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

async function vapidKeys(db: D1Database): Promise<VapidKeys> {
  const read = () => db.prepare("select value from app_settings where key = ?").bind(SETTING).first<{ value: string }>();
  const row = await read();
  if (row) return JSON.parse(row.value) as VapidKeys;
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const fresh: VapidKeys = {
    publicKey: b64url((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey,
  };
  // Two first calls at once: the one that lands first wins, both use it.
  await db.prepare("insert or ignore into app_settings (key, value, updated_at) values (?, ?, ?)").bind(SETTING, JSON.stringify(fresh), nowIso()).run();
  return JSON.parse((await read())!.value) as VapidKeys;
}

/** The key the browser subscribes with (GET /api/push/web-key). */
export async function webPushKey(db: D1Database): Promise<{ publicKey: string }> {
  return { publicKey: (await vapidKeys(db)).publicKey };
}

/** The subscription as the browser gives it (PushSubscription.toJSON()), or null. */
export function parseSubscription(token: string): WebSubscription | null {
  try {
    const sub = JSON.parse(token) as Partial<WebSubscription>;
    if (typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://")) return null;
    if (typeof sub.keys?.p256dh !== "string" || typeof sub.keys?.auth !== "string") return null;
    return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
  } catch {
    return null;
  }
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, bytes: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}

/** RFC 8291: the payload encrypted for this browser, as one aes128gcm record. */
export async function encryptPayload(sub: WebSubscription, plaintext: Uint8Array): Promise<Uint8Array> {
  const uaPublic = fromB64url(sub.keys.p256dh);
  const authSecret = fromB64url(sub.keys.auth);
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // workers-types spells the field "$public"; the runtime (like the spec) reads "public".
  const ecdh = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const shared = new Uint8Array(await crypto.subtle.deriveBits(ecdh, local.privateKey, 256));
  const enc = new TextEncoder();
  const ikm = await hkdf(authSecret, shared, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  // 0x02 marks the last (and only) record.
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, concat(plaintext, new Uint8Array([2]))));
  const header = new Uint8Array(21);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, cipher);
}

/** RFC 8292: the Authorization header for the push service of this endpoint. */
async function vapidHeader(keys: VapidKeys, endpoint: string): Promise<string> {
  const enc = new TextEncoder();
  const head = b64url(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64url(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: CONTACT })));
  const key = await crypto.subtle.importKey("jwk", keys.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  // WebCrypto signs ECDSA as r||s, the form JWS wants.
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/**
 * Sends one notice to one browser. "gone" when the browser dropped the subscription
 * (the caller forgets it). Throws only on bad keys.
 */
export async function sendWebPush(db: D1Database, sub: WebSubscription, notice: PushNotice): Promise<"sent" | "gone" | "failed"> {
  const keys = await vapidKeys(db);
  const body = await encryptPayload(sub, new TextEncoder().encode(JSON.stringify(notice)));
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      authorization: await vapidHeader(keys, sub.endpoint),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(24 * 3600),
      urgency: "high",
    },
    body,
  });
  if (res.ok) return "sent";
  if (res.status === 404 || res.status === 410) return "gone";
  console.error("Web push failed", res.status);
  return "failed";
}
