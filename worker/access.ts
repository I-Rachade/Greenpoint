/**
 * Cloudflare Access in front of the back office (admin.poinderecharge.com, worker/admin-gateway.ts).
 *
 * Access signs every request it lets through with a JWT in the Cf-Access-Jwt-Assertion header.
 * We check that token ourselves (RS256 against the team's public keys), on the gateway and
 * again in the API: a header alone proves nothing, anyone can send one.
 * See docs/BACKOFFICE.md for the setup in the Cloudflare dashboard.
 */

export interface AccessSettings {
  /** Team domain from Zero Trust, e.g. "https://<team>.cloudflareaccess.com" (a bare host is accepted too). */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the Access application for the back office. */
  ACCESS_AUD?: string;
  /** "1": admin accounts only work with a valid Access token, i.e. only through the back office. */
  ADMIN_ACCESS_REQUIRED?: string;
}

export interface AccessConfig {
  teamDomain: string;
  aud: string;
}

/** The checked identity of whoever Access let through. */
export interface AccessIdentity {
  email: string | null;
  sub: string;
}

export const ACCESS_HEADER = "Cf-Access-Jwt-Assertion";

/** The Access settings, or null while they are not both set. */
export function accessConfig(env: AccessSettings): AccessConfig | null {
  const domain = (env.ACCESS_TEAM_DOMAIN ?? "").trim().replace(/\/+$/, "");
  const aud = (env.ACCESS_AUD ?? "").trim();
  if (!domain || !aud) return null;
  const teamDomain = /^https:\/\//i.test(domain) ? domain : `https://${domain.replace(/^http:\/\//i, "")}`;
  return { teamDomain, aud };
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
}

const KEYS_TTL_MS = 10 * 60_000;
let keyCache: { teamDomain: string; at: number; keys: Jwk[] } | null = null;

/** Only for tests: forget the cached public keys. */
export function resetAccessKeyCache() {
  keyCache = null;
}

async function teamKeys(cfg: AccessConfig, fetcher: typeof fetch, now: number, fresh: boolean): Promise<Jwk[]> {
  if (!fresh && keyCache && keyCache.teamDomain === cfg.teamDomain && now - keyCache.at < KEYS_TTL_MS) return keyCache.keys;
  const res = await fetcher(`${cfg.teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`access certs ${res.status}`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = Array.isArray(body.keys) ? body.keys.filter((k) => k && k.kty === "RSA" && typeof k.kid === "string") : [];
  keyCache = { teamDomain: cfg.teamDomain, at: now, keys };
  return keys;
}

/** Logs why a token was refused (never the token itself) and refuses it. */
function deny(reason: string, detail?: unknown): null {
  console.warn("access denied:", reason, detail ?? "");
  return null;
}

function base64UrlBytes(part: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(part)) throw new Error("bad base64url");
  const b64 = part.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (part.length % 4)) % 4);
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function base64UrlJson(part: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(base64UrlBytes(part)));
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * Checks an Access token: RS256 signature by one of the team's keys, our AUD,
 * the team as issuer, and the time window. Returns the identity, or null for any doubt.
 */
export async function verifyAccessJwt(
  token: string,
  cfg: AccessConfig,
  // Called through a wrapper: the runtime's fetch must not be detached from the global scope.
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  now = Date.now(),
): Promise<AccessIdentity | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return deny("malformed");
  const header = base64UrlJson(parts[0]);
  const payload = base64UrlJson(parts[1]);
  if (!header || !payload) return deny("malformed");
  // Only RS256: never "none" or a key type the token chooses itself.
  if (header.alg !== "RS256" || typeof header.kid !== "string") return deny("alg", header.alg);

  const aud = payload.aud;
  if (!(Array.isArray(aud) ? aud.includes(cfg.aud) : aud === cfg.aud)) return deny("aud", aud);
  // Compared without a trailing slash, however the team domain was written.
  if (String(payload.iss ?? "").replace(/\/+$/, "") !== cfg.teamDomain) return deny("iss", payload.iss);
  const seconds = now / 1000;
  // A minute of leeway for clocks that differ a little.
  if (typeof payload.exp !== "number" || payload.exp < seconds - 60) return deny("expired", payload.exp);
  if (typeof payload.nbf === "number" && payload.nbf > seconds + 60) return deny("not yet valid", payload.nbf);
  if (typeof payload.sub !== "string") return deny("sub");

  let keys: Jwk[];
  try {
    keys = await teamKeys(cfg, fetcher, now, false);
    // Keys rotate: an unknown kid gets one fresh look.
    if (!keys.some((k) => k.kid === header.kid)) keys = await teamKeys(cfg, fetcher, now, true);
  } catch (err) {
    console.error("access keys", err);
    return null;
  }
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return deny("unknown key", header.kid);

  try {
    const key = await crypto.subtle.importKey(
      "jwk",
      { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      base64UrlBytes(parts[2]),
      new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
    );
    if (!ok) return deny("signature");
  } catch (err) {
    return deny("verify failed", String(err));
  }
  return { email: typeof payload.email === "string" ? payload.email : null, sub: payload.sub };
}

/** The checked Access identity of this request, or null (no token, wrong token, or Access not set up). */
export async function accessIdentity(env: AccessSettings, request: Request): Promise<AccessIdentity | null> {
  const cfg = accessConfig(env);
  const token = request.headers.get(ACCESS_HEADER);
  if (!cfg) return null;
  if (!token) return deny("no token");
  return verifyAccessJwt(token, cfg);
}

/** Whether admin accounts must come through Access (ADMIN_ACCESS_REQUIRED=1). */
export const adminAccessRequired = (env: AccessSettings) => (env.ADMIN_ACCESS_REQUIRED ?? "").trim() === "1";

/**
 * Whether an admin account may sign in or act with this request. Without ADMIN_ACCESS_REQUIRED
 * everything stays as before; with it, only a valid Access token counts, and a missing
 * setting closes the door instead of opening it.
 */
export async function adminAllowed(env: AccessSettings, request: Request): Promise<boolean> {
  if (!adminAccessRequired(env)) return true;
  return (await accessIdentity(env, request)) !== null;
}
