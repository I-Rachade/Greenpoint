import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile, UserRole } from "../src/lib/types";
import type { Env } from "./env";
import { ApiError, nowIso, sha256, uuid } from "./http";

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Codes one number may request per hour. */
const PER_PHONE_HOURLY = 5;
const SESSION_DAYS = 60;

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

/** Sends a login code by SMS through Didit. Only Togolese numbers (+228). */
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

/** Checks the code, creates the user on first login, and opens a session. */
export async function verifyCode(env: Env, rawPhone: string, rawCode: string): Promise<{ token: string; profile: Profile }> {
  const phone = normalizeTogoPhone(rawPhone ?? "");
  if (!phone) throw new ApiError("phone_not_allowed");
  const code = String(rawCode ?? "").trim();
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

  const now = nowIso();
  let user = await env.DB.prepare("select id, phone, full_name, role from users where phone = ?").bind(phone).first<UserRow>();
  if (!user) {
    const role: UserRole = listSetting(env.ADMIN_PHONES).some((p) => normalizeTogoPhone(p) === phone) ? "admin" : "rider";
    const id = uuid();
    await env.DB.prepare("insert into users (id, phone, role, created_at) values (?, ?, ?, ?) on conflict (phone) do nothing")
      .bind(id, phone, role, now)
      .run();
    user = await env.DB.prepare("select id, phone, full_name, role from users where phone = ?").bind(phone).first<UserRow>();
    if (!user) throw new ApiError("unknown", 500);
    if (user.id === id) {
      await env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, null, 'profiles', 'insert', ?, ?, ?)",
      )
        .bind(now, id, id, JSON.stringify({ phone, role }))
        .run();
    }
  }

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
