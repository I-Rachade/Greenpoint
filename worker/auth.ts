import type { CodeChannel } from "../src/lib/backend/backend";
import { type Contact, parseContact } from "../src/lib/contact";
import { validPinFormat, weakPin } from "../src/lib/pin";
import type { Profile, UserRole } from "../src/lib/types";
import type { Env } from "./env";
import { ApiError, nowIso, randomDigits, sha256, uuid } from "./http";

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Codes one number or address may request per hour. */
const PER_TARGET_HOURLY = 5;
const SESSION_DAYS = 60;
/** Wrong PINs in a row before the account is locked for PIN_LOCK_MINUTES. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;
/** Highest PBKDF2 iteration count Cloudflare Workers allow. */
const PIN_ITERATIONS = 100_000;
/** Sender of the code e-mails; its domain must be onboarded in Cloudflare Email Service (also in wrangler.jsonc). */
const EMAIL_FROM = "noreply@poinderecharge.com";

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  role: UserRole;
}

export function toProfile(u: UserRow): Profile {
  return { id: u.id, phone: u.phone, email: u.email, fullName: u.full_name, role: u.role };
}

function listSetting(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Fixed codes for test numbers and addresses (no SMS or e-mail is sent to them). */
function testCode(env: Env, target: string): string | null {
  for (const entry of listSetting(env.TEST_OTP)) {
    const [contact, code] = entry.split("=").map((s) => s.trim());
    if (parseContact(contact ?? "")?.value === target && /^\d{6}$/.test(code ?? "")) return code;
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

/** Sends the code by e-mail through Cloudflare Email Service (binding EMAIL, see wrangler.jsonc). */
async function sendEmailCode(env: Env, email: string, code: string) {
  if (!env.EMAIL) {
    console.error("EMAIL binding missing: no e-mail sent");
    throw new ApiError("unknown", 503);
  }
  const text = [
    "Bonjour,",
    "",
    `Votre code poinderecharge : ${code}`,
    "",
    `Il est valable ${CODE_MINUTES} minutes. Ne le communiquez à personne : poinderecharge ne vous le demandera jamais.`,
    "Si vous n'avez rien demandé, ignorez cet e-mail.",
  ].join("\n");
  const html = `<p>Bonjour,</p><p>Votre code poinderecharge :</p><p style="font-size:28px;font-weight:bold;letter-spacing:6px">${code}</p><p>Il est valable ${CODE_MINUTES} minutes. Ne le communiquez à personne : poinderecharge ne vous le demandera jamais.</p><p>Si vous n'avez rien demandé, ignorez cet e-mail.</p>`;
  try {
    await env.EMAIL.send({
      from: { email: EMAIL_FROM, name: "poinderecharge" },
      to: email,
      subject: `${code} est votre code poinderecharge`,
      text,
      html,
    });
  } catch (err) {
    const errorCode = (err as { code?: string }).code;
    console.error("E-mail send failed", errorCode, (err as Error).message);
    if (errorCode === "E_RATE_LIMIT_EXCEEDED" || errorCode === "E_DAILY_LIMIT_EXCEEDED") {
      throw new ApiError("rate_limited", 429);
    }
    if (errorCode === "E_RECIPIENT_SUPPRESSED" || errorCode === "E_VALIDATION_ERROR") {
      throw new ApiError("invalid_contact");
    }
    throw new ApiError("unknown", 502);
  }
}

/**
 * Sends a code to a Togolese number (SMS through Didit) or an e-mail address
 * (Cloudflare Email Service), to register, to set a new PIN, to add a contact
 * or to confirm account deletion.
 */
async function deliverCode(env: Env, contact: Contact) {
  const target = contact.value;
  const fixed = testCode(env, target);
  if (fixed) {
    await env.DB.prepare("insert into otp_codes (phone, code_hash, created_at, expires_at) values (?, ?, ?, ?)")
      .bind(target, await sha256(`${target}:${fixed}`), nowIso(), expiresIn(CODE_MINUTES))
      .run();
    return;
  }

  // otp_codes.phone holds the number or the address (see migration 0003).
  // Per address and in total per channel: SMS cost money, e-mails count against the sending quota.
  const since = hourAgo();
  const kindFilter = contact.kind === "phone" ? "phone like '+%'" : "phone like '%@%'";
  const counts = await env.DB.prepare(
    `select (select count(*) from otp_codes where phone = ? and created_at > ?) as mine, (select count(*) from otp_codes where ${kindFilter} and created_at > ?) as total`,
  )
    .bind(target, since, since)
    .first<{ mine: number; total: number }>();
  const hourly =
    contact.kind === "phone" ? Number(env.OTP_HOURLY_LIMIT) || 30 : Number(env.EMAIL_HOURLY_LIMIT) || 100;
  if ((counts?.mine ?? 0) >= PER_TARGET_HOURLY || (counts?.total ?? 0) >= hourly) {
    throw new ApiError("rate_limited", 429);
  }

  if (contact.kind === "email") {
    const code = randomDigits(6);
    // Stored before sending, so a code that arrives can always be checked.
    await env.DB.prepare("insert into otp_codes (phone, code_hash, created_at, expires_at) values (?, ?, ?, ?)")
      .bind(target, await sha256(`${target}:${code}`), nowIso(), expiresIn(CODE_MINUTES))
      .run();
    await sendEmailCode(env, target, code);
    return;
  }

  const { data } = await didit<{ status: string; reason?: string | null }>(env, "send", {
    phone_number: target,
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
    .bind(target, DIDIT_MARK, nowIso(), expiresIn(5))
    .run();
}

function contactOrThrow(raw: unknown): Contact {
  const text = String(raw ?? "");
  const contact = parseContact(text);
  // A number that is not Togolese gets its own message.
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  return contact;
}

/** Sends a code to register or to set a new PIN. Only Togolese numbers (+228) or e-mail addresses. */
export async function sendCode(env: Env, rawContact: string) {
  await deliverCode(env, contactOrThrow(rawContact));
}

/** Consumes a valid code for this number or address, or throws invalid_code. */
async function checkCode(env: Env, target: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw new ApiError("invalid_code");
  const row = await env.DB.prepare(
    "select id, code_hash, attempts from otp_codes where phone = ? and used = 0 and expires_at > ? order by id desc limit 1",
  )
    .bind(target, nowIso())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) throw new ApiError("invalid_code");

  if (row.code_hash === DIDIT_MARK) {
    const { data } = await didit<{ status: string }>(env, "check", {
      phone_number: target,
      code,
      // Throwaway and internet numbers are a common way to make many accounts.
      disposable_number_action: "DECLINE",
      voip_number_action: "DECLINE",
    });
    if (data.status !== "Approved") {
      await env.DB.prepare("update otp_codes set attempts = attempts + 1 where id = ?").bind(row.id).run();
      throw new ApiError("invalid_code");
    }
  } else if (row.code_hash !== (await sha256(`${target}:${code}`))) {
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

const USER_COLUMNS = "id, phone, email, full_name, role";
/** Column of users that holds this kind of contact. Fixed names only, never user input. */
const contactColumn = (contact: Contact) => (contact.kind === "phone" ? "phone" : "email");

/** Numbers in ADMIN_PHONES and addresses in ADMIN_EMAILS become admin when they register. */
function isAdminContact(env: Env, contact: Contact): boolean {
  const list = listSetting(contact.kind === "phone" ? env.ADMIN_PHONES : env.ADMIN_EMAILS);
  return list.some((entry) => parseContact(entry)?.value === contact.value);
}

/**
 * Registration and "PIN forgotten": checks the code (SMS or e-mail), sets the PIN,
 * creates the user if new, and opens a session. A new PIN ends every other session of the user.
 */
export async function register(env: Env, rawContact: string, rawCode: string, rawPin: string) {
  const contact = contactOrThrow(rawContact);
  const column = contactColumn(contact);
  const pin = String(rawPin ?? "").trim();
  // Checked before the code, so a mistyped PIN does not use up the code.
  checkPinFormat(pin);
  await checkCode(env, contact.value, String(rawCode ?? "").trim());

  const now = nowIso();
  const pinHash = await hashPin(pin);
  const findUser = () =>
    env.DB.prepare(`select ${USER_COLUMNS} from users where ${column} = ?`).bind(contact.value).first<UserRow>();
  let user = await findUser();
  if (!user) {
    const role: UserRole = isAdminContact(env, contact) ? "admin" : "rider";
    const id = uuid();
    await env.DB.prepare(
      `insert into users (id, ${column}, role, created_at, pin_hash) values (?, ?, ?, ?, ?) on conflict do nothing`,
    )
      .bind(id, contact.value, role, now, pinHash)
      .run();
    user = await findUser();
    if (!user) throw new ApiError("unknown", 500);
    if (user.id === id) {
      await env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, null, 'profiles', 'insert', ?, ?, ?)",
      )
        .bind(now, id, id, JSON.stringify({ [column]: contact.value, role }))
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

/** Everyday login with phone number or e-mail address, and PIN. A few wrong PINs lock the account for a while. */
export async function signIn(env: Env, rawContact: string, rawPin: string) {
  const contact = contactOrThrow(rawContact);
  const pin = String(rawPin ?? "").trim();
  if (!validPinFormat(pin)) throw new ApiError("invalid_pin");

  const user = await env.DB.prepare(
    `select ${USER_COLUMNS}, pin_hash, pin_failures, pin_locked_until from users where ${contactColumn(contact)} = ?`,
  )
    .bind(contact.value)
    .first<UserRow & { pin_hash: string | null; pin_failures: number; pin_locked_until: string | null }>();
  // Same answer for unknown contacts and wrong PINs, so the login does not reveal who has an account.
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
    "select u.id, u.phone, u.email, u.full_name, u.role from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?",
  )
    .bind(await sha256(token), nowIso())
    .first<UserRow>();
  return row ? toProfile(row) : null;
}

async function requireUser(env: Env, request: Request): Promise<Profile> {
  const profile = await currentUser(env, request);
  if (!profile) throw new ApiError("not_authenticated", 401);
  return profile;
}

/** Sends a code to a phone number or e-mail address the signed-in user wants to add to the account. */
export async function sendContactCode(env: Env, request: Request, rawContact: string) {
  const profile = await requireUser(env, request);
  const contact = contactOrThrow(rawContact);
  await assertContactFree(env, contact, profile.id);
  await deliverCode(env, contact);
}

async function assertContactFree(env: Env, contact: Contact, userId: string) {
  const other = await env.DB.prepare(`select id from users where ${contactColumn(contact)} = ? and id <> ?`)
    .bind(contact.value, userId)
    .first<{ id: string }>();
  if (other) throw new ApiError("contact_taken", 409);
}

/** Adds (or replaces) the account's phone number or e-mail address once its code is right. */
export async function addContact(env: Env, request: Request, rawContact: string, rawCode: string) {
  const profile = await requireUser(env, request);
  const contact = contactOrThrow(rawContact);
  const column = contactColumn(contact);
  await assertContactFree(env, contact, profile.id);
  await checkCode(env, contact.value, String(rawCode ?? "").trim());
  try {
    await env.DB.batch([
      env.DB.prepare(`update users set ${column} = ? where id = ?`).bind(contact.value, profile.id),
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, ?, 'profiles', 'update', ?, ?, ?)",
      ).bind(nowIso(), profile.id, profile.id, profile.id, JSON.stringify({ [column]: contact.value })),
    ]);
  } catch {
    // Someone else took it in the meantime (unique index).
    throw new ApiError("contact_taken", 409);
  }
  return { ...profile, [column]: contact.value } as Profile;
}

/** The account's own contact for this channel, or bad_request when it has none. */
function deleteTarget(profile: Profile, channel: CodeChannel): Contact {
  if (channel === "sms" && profile.phone) return { kind: "phone", value: profile.phone };
  if (channel === "email" && profile.email) return { kind: "email", value: profile.email };
  throw new ApiError("bad_request");
}

/** Sends the code that confirms account deletion, by SMS or by e-mail to the account's own contact. */
export async function sendDeleteCode(env: Env, request: Request, channel: CodeChannel) {
  const profile = await requireUser(env, request);
  await deliverCode(env, deleteTarget(profile, channel));
}

/**
 * Deletes the signed-in user's account after checking a code sent by SMS or
 * e-mail (Google Play and Loi 2019-014 require self-service deletion). The PIN
 * is still accepted, for app versions released before the code. Sessions, staff
 * assignments and reservations go with it, and the phone number and e-mail
 * address are removed from the activity log. Paid transactions, once they
 * exist, must be kept 5 years without the person.
 */
export async function deleteAccount(
  env: Env,
  request: Request,
  input: { channel?: CodeChannel; code?: string; pin?: string },
) {
  const profile = await requireUser(env, request);
  if (input.code !== undefined) {
    const target = deleteTarget(profile, input.channel === "email" ? "email" : "sms");
    await checkCode(env, target.value, String(input.code).trim());
  } else {
    const row = await env.DB.prepare("select pin_hash from users where id = ?")
      .bind(profile.id)
      .first<{ pin_hash: string | null }>();
    const pin = String(input.pin ?? "").trim();
    if (!row?.pin_hash || !validPinFormat(pin) || !(await pinMatches(pin, row.pin_hash))) {
      throw new ApiError("invalid_pin");
    }
  }
  await env.DB.batch([
    env.DB.prepare(
      "update audit_log set changes = json_remove(changes, '$.phone', '$.email') where user_id = ? or row_id = ?",
    ).bind(profile.id, profile.id),
    env.DB.prepare("delete from sessions where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from station_staff where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from reservations where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from otp_codes where phone in (?, ?)").bind(profile.phone ?? "", profile.email ?? ""),
    env.DB.prepare("delete from users where id = ?").bind(profile.id),
  ]);
}

export async function signOut(env: Env, request: Request) {
  const token = bearer(request);
  if (token) await env.DB.prepare("delete from sessions where token_hash = ?").bind(await sha256(token)).run();
}
