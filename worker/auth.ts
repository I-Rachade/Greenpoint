import { normalizeTogoPhone } from "../src/lib/phone";
import { validPinFormat, weakPin } from "../src/lib/pin";
import type { Profile, UserRole } from "../src/lib/types";
import type { Env } from "./env";
import { ApiError, nowIso, sha256, uuid } from "./http";

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Codes one number may request per hour. */
const PER_PHONE_HOURLY = 5;
const SESSION_DAYS = 60;
/** Wrong PINs in a row before the account is locked for PIN_LOCK_MINUTES. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;
/** Highest PBKDF2 iteration count Cloudflare Workers allow. */
const PIN_ITERATIONS = 100_000;

interface UserRow {
  id: string;
  phone: string;
  full_name: string | null;
  role: UserRole;
}

export function toProfile(u: UserRow): Profile {
  return { id: u.id, phone: u.phone, fullName: u.full_name, role: u.role };
}

function listSetting(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fixed codes for test numbers (no SMS is sent to them). */
function testCode(env: Env, phone: string): string | null {
  for (const entry of listSetting(env.TEST_OTP)) {
    const [number, code] = entry.split("=").map((s) => s.trim());
    if (normalizeTogoPhone(number ?? "") === phone && /^\d{6}$/.test(code ?? "")) return code;
  }
  return null;
}

function hourAgo(): string {
  return new Date(Date.now() - 3_600_000).toISOString();
}

const DIDIT_API = "https://verification.didit.me/v3/phone";
/** Marks rows of codes sent by Didit: Didit keeps the code, we only log the send. */
const DIDIT_MARK = "didit";

async function didit<T>(env: Env, path: "send" | "check", body: unknown): Promise<{ status: number; data: T }> {
  if (!env.DIDIT_API_KEY) {
    console.error("DIDIT_API_KEY missing: no SMS sent");
    throw new ApiError("unknown", 503);
  }
  const res = await fetch(`${DIDIT_API}/${path}/`, {
    method: "POST",
    headers: { "x-api-key": env.DIDIT_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  if (res.status === 429) throw new ApiError("rate_limited", 429);
  if (res.status === 400) throw new ApiError(path === "send" ? "phone_not_allowed" : "invalid_code");
  if (!res.ok) {
    console.error(`Didit ${path} error`, res.status, JSON.stringify(data));
    throw new ApiError("unknown", 502);
  }
  return { status: res.status, data };
}

function expiresIn(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

/** Sends a code by SMS through Didit, to register or to set a new PIN. Only Togolese numbers (+228). */
export async function sendCode(env: Env, rawPhone: string) {
  const phone = normalizeTogoPhone(rawPhone ?? "");
  if (!phone) throw new ApiError("phone_not_allowed");

  const fixed = testCode(env, phone);
  if (fixed) {
    await env.DB.prepare("insert into otp_codes (phone, code_hash, created_at, expires_at) values (?, ?, ?, ?)")
      .bind(phone, await sha256(`${phone}:${fixed}`), nowIso(), expiresIn(CODE_MINUTES))
      .run();
    return;
  }

  const since = hourAgo();
  const counts = await env.DB.prepare(
    "select (select count(*) from otp_codes where phone = ? and created_at > ?) as mine, (select count(*) from otp_codes where created_at > ?) as total",
  )
    .bind(phone, since, since)
    .first<{ mine: number; total: number }>();
  const hourly = Number(env.OTP_HOURLY_LIMIT) || 30;
  if ((counts?.mine ?? 0) >= PER_PHONE_HOURLY || (counts?.total ?? 0) >= hourly) {
    throw new ApiError("rate_limited", 429);
  }

  const { data } = await didit<{ status: string; reason?: string | null }>(env, "send", {
    phone_number: phone,
    options: {
      code_size: 6,
      locale: "fr",
      preferred_channel: env.DIDIT_CHANNEL || "sms",
      sms_sender_name: "poinderecharge",
    },
  });
  if (data.status === "Blocked") {
    console.warn("Didit blocked send", data.reason);
    throw new ApiError("rate_limited", 429);
  }
  // Logged for the hourly limits; Didit codes are valid for 5 minutes.
  await env.DB.prepare("insert into otp_codes (phone, code_hash, created_at, expires_at) values (?, ?, ?, ?)")
    .bind(phone, DIDIT_MARK, nowIso(), expiresIn(5))
    .run();
}

/** Consumes a valid SMS code for this number, or throws invalid_code. */
async function checkCode(env: Env, phone: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw new ApiError("invalid_code");
  const row = await env.DB.prepare(
    "select id, code_hash, attempts from otp_codes where phone = ? and used = 0 and expires_at > ? order by id desc limit 1",
  )
    .bind(phone, nowIso())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) throw new ApiError("invalid_code");

  if (row.code_hash === DIDIT_MARK) {
    const { data } = await didit<{ status: string }>(env, "check", {
      phone_number: phone,
      code,
      // Throwaway and internet numbers are a common way to make many accounts.
      disposable_number_action: "DECLINE",
      voip_number_action: "DECLINE",
    });
    if (data.status !== "Approved") {
      await env.DB.prepare("update otp_codes set attempts = attempts + 1 where id = ?").bind(row.id).run();
      throw new ApiError("invalid_code");
    }
  } else if (row.code_hash !== (await sha256(`${phone}:${code}`))) {
    await env.DB.prepare("update otp_codes set attempts = attempts + 1 where id = ?").bind(row.id).run();
    throw new ApiError("invalid_code");
  }
  // Only one request can use the code.
  const used = await env.DB.prepare("update otp_codes set used = 1 where id = ? and used = 0").bind(row.id).run();
  if (!used.meta.changes) throw new ApiError("invalid_code");
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

async function pbkdf2(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PIN_ITERATIONS}$${b64(salt)}$${await pbkdf2(pin, salt, PIN_ITERATIONS)}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const saltBytes = Uint8Array.from(atob(salt), (ch) => ch.charCodeAt(0));
  return (await pbkdf2(pin, saltBytes, Number(iterations))) === hash;
}

function checkPinFormat(pin: string) {
  if (!validPinFormat(pin)) throw new ApiError("bad_pin");
  if (weakPin(pin)) throw new ApiError("weak_pin");
}

const USER_COLUMNS = "id, phone, full_name, role";

/**
 * Registration and "PIN forgotten": checks the SMS code, sets the PIN, creates the
 * user if new, and opens a session. A new PIN ends every other session of the user.
 */
export async function register(env: Env, rawPhone: string, rawCode: string, rawPin: string) {
  const phone = normalizeTogoPhone(rawPhone ?? "");
  if (!phone) throw new ApiError("phone_not_allowed");
  const pin = String(rawPin ?? "").trim();
  // Checked before the code, so a mistyped PIN does not use up the SMS code.
  checkPinFormat(pin);
  await checkCode(env, phone, String(rawCode ?? "").trim());

  const now = nowIso();
  const pinHash = await hashPin(pin);
  let user = await env.DB.prepare(`select ${USER_COLUMNS} from users where phone = ?`).bind(phone).first<UserRow>();
  if (!user) {
    const role: UserRole = listSetting(env.ADMIN_PHONES).some((p) => normalizeTogoPhone(p) === phone) ? "admin" : "rider";
    const id = uuid();
    await env.DB.prepare(
      "insert into users (id, phone, role, created_at, pin_hash) values (?, ?, ?, ?, ?) on conflict (phone) do nothing",
    )
      .bind(id, phone, role, now, pinHash)
      .run();
    user = await env.DB.prepare(`select ${USER_COLUMNS} from users where phone = ?`).bind(phone).first<UserRow>();
    if (!user) throw new ApiError("unknown", 500);
    if (user.id === id) {
      await env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, null, 'profiles', 'insert', ?, ?, ?)",
      )
        .bind(now, id, id, JSON.stringify({ phone, role }))
        .run();
      return openSession(env, user);
    }
  }
  await env.DB.batch([
    env.DB.prepare("update users set pin_hash = ?, pin_failures = 0, pin_locked_until = null where id = ?").bind(
      pinHash,
      user.id,
    ),
    env.DB.prepare("delete from sessions where user_id = ?").bind(user.id),
  ]);
  return openSession(env, user);
}

/** Everyday login with phone number and PIN. A few wrong PINs lock the account for a while. */
export async function signIn(env: Env, rawPhone: string, rawPin: string) {
  const phone = normalizeTogoPhone(rawPhone ?? "");
  if (!phone) throw new ApiError("phone_not_allowed");
  const pin = String(rawPin ?? "").trim();
  if (!validPinFormat(pin)) throw new ApiError("invalid_pin");

  const user = await env.DB.prepare(
    `select ${USER_COLUMNS}, pin_hash, pin_failures, pin_locked_until from users where phone = ?`,
  )
    .bind(phone)
    .first<UserRow & { pin_hash: string | null; pin_failures: number; pin_locked_until: string | null }>();
  // Same answer for unknown numbers and wrong PINs, so the login does not reveal who has an account.
  if (!user?.pin_hash) throw new ApiError("invalid_pin");
  if (user.pin_locked_until && user.pin_locked_until > nowIso()) throw new ApiError("pin_locked", 429);

  if (!(await pinMatches(pin, user.pin_hash))) {
    const failures = user.pin_failures + 1;
    const locked = failures >= PIN_MAX_FAILURES;
    await env.DB.prepare("update users set pin_failures = ?, pin_locked_until = ? where id = ?")
      .bind(locked ? 0 : failures, locked ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString() : null, user.id)
      .run();
    throw new ApiError(locked ? "pin_locked" : "invalid_pin", locked ? 429 : 400);
  }
  if (user.pin_failures || user.pin_locked_until) {
    await env.DB.prepare("update users set pin_failures = 0, pin_locked_until = null where id = ?").bind(user.id).run();
  }
  return openSession(env, user);
}

async function openSession(env: Env, user: UserRow): Promise<{ token: string; profile: Profile }> {
  const now = nowIso();
  const token = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  await env.DB.batch([
    env.DB.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").bind(
      await sha256(token),
      user.id,
      now,
      new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
    ),
    env.DB.prepare("update users set last_sign_in_at = ? where id = ?").bind(now, user.id),
    // Housekeeping: old codes and sessions.
    env.DB.prepare("delete from otp_codes where created_at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()),
    env.DB.prepare("delete from sessions where expires_at < ?").bind(now),
  ]);
  return { token, profile: toProfile(user) };
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const m = /^Bearer\s+([A-Za-z0-9_-]{20,})$/.exec(header);
  return m ? m[1] : null;
}

/** The signed-in user of this request, or null. */
export async function currentUser(env: Env, request: Request): Promise<Profile | null> {
  const token = bearer(request);
  if (!token) return null;
  const row = await env.DB.prepare(
    "select u.id, u.phone, u.full_name, u.role from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?",
  )
    .bind(await sha256(token), nowIso())
    .first<UserRow>();
  return row ? toProfile(row) : null;
}

export async function signOut(env: Env, request: Request) {
  const token = bearer(request);
  if (token) await env.DB.prepare("delete from sessions where token_hash = ?").bind(await sha256(token)).run();
}
