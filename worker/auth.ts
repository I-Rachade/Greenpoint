import type { CodeChannel } from "../shared/api";
import { type Contact, parseContact } from "../shared/contact";
import { cleanFleetName } from "../shared/fleet";
import { validPinFormat, weakPin } from "../shared/pin";
import type { Profile, UserRole } from "../shared/types";
import { adminAllowed } from "./access";
import type { Env } from "./env";
import { ApiError, nowIso, randomDigits, sha256, uuid } from "./http";
import type { MerchantShopInput } from "../shared/merchants";
import { cleanShop } from "./merchant-rules";
import { roleFromDb, roleToDb } from "./roles";

const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
/** Codes one number or address may request per hour. */
const PER_TARGET_HOURLY = 5;
const SESSION_DAYS = 60;
/**
 * Admins and station staff or owners (role 'operator') hold money and other people's data:
 * their sessions end after a week, also one opened before the account got the role.
 */
const STAFF_SESSION_DAYS = 7;
const STAFF_ROLES_SQL = "('admin', 'operator')";
/** Wrong PINs in a row before the account is locked for PIN_LOCK_MINUTES. */
const PIN_MAX_FAILURES = 5;
const PIN_LOCK_MINUTES = 15;
/** Longest lock after many locks in a row. */
const PIN_LOCK_MAX_MINUTES = 24 * 60;
/** Highest PBKDF2 iteration count Cloudflare Workers allow. */
const PIN_ITERATIONS = 100_000;
/** Sender of the code e-mails; its domain must be onboarded in Cloudflare Email Service (also in wrangler.jsonc). */
const EMAIL_FROM = "noreply@poinderecharge.com";

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  /** As stored, see roles.ts. */
  role: string;
  /** Comma-separated operators this person runs (operator_owners). */
  owner_of?: string | null;
  driver_status?: Profile["driverStatus"];
  /** Merchant accounts: "id|status|is_owner|name" of the shop (merchantOf). */
  merchant?: string | null;
  /** Point partner accounts: "id|status|name" (pointPartnerOf, migration 0039). */
  point_partner?: string | null;
}

function toPointPartner(value: string | null | undefined): Profile["pointPartner"] {
  if (!value) return null;
  const [id, status, ...name] = value.split("|");
  return { id, status: status as NonNullable<Profile["pointPartner"]>["status"], name: name.join("|") };
}

function toMerchant(value: string | null | undefined): Profile["merchant"] {
  if (!value) return null;
  const [id, status, owner, ...name] = value.split("|");
  return { id, status: status as NonNullable<Profile["merchant"]>["status"], isOwner: owner === "1", name: name.join("|") };
}

export function toProfile(u: UserRow): Profile {
  return {
    id: u.id,
    phone: u.phone,
    email: u.email,
    fullName: u.full_name,
    role: roleFromDb(u.role),
    ownerOf: u.owner_of ? u.owner_of.split(",") : [],
    driverStatus: u.driver_status ?? null,
    ...(u.role === "merchant" ? { merchant: toMerchant(u.merchant) } : {}),
    ...(u.point_partner ? { pointPartner: toPointPartner(u.point_partner) } : {}),
  };
}

const ownerOf = (alias: string) =>
  `(select group_concat(operator_id) from operator_owners where user_id = ${alias}.id) as owner_of`;

const merchantOf = (alias: string) =>
  `(select m.id || '|' || m.status || '|' || mm.is_owner || '|' || m.name from merchant_members mm join merchants m on m.id = mm.merchant_id
    where mm.user_id = ${alias}.id) as merchant`;

const pointPartnerOf = (alias: string) =>
  `(select p.id || '|' || p.status || '|' || p.name from point_partner_accounts a join point_partners p on p.id = a.partner_id
    where a.user_id = ${alias}.id) as point_partner`;

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
export async function deliverCode(env: Env, contact: Contact) {
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

export function contactOrThrow(raw: unknown): Contact {
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
export async function checkCode(env: Env, target: string, code: string) {
  if (!/^\d{6}$/.test(code)) throw new ApiError("invalid_code");
  const row = await env.DB.prepare(
    "select id, code_hash, attempts from otp_codes where phone = ? and used = 0 and expires_at > ? order by id desc limit 1",
  )
    .bind(target, nowIso())
    .first<{ id: number; code_hash: string; attempts: number }>();
  if (!row || row.attempts >= MAX_ATTEMPTS) throw new ApiError("invalid_code");
  // The try is counted before the code is compared, so parallel guesses cannot pass the limit.
  const tried = await env.DB.prepare("update otp_codes set attempts = attempts + 1 where id = ? and attempts < ? and used = 0")
    .bind(row.id, MAX_ATTEMPTS)
    .run();
  if (!tried.meta.changes) throw new ApiError("invalid_code");

  if (row.code_hash === DIDIT_MARK) {
    const { data } = await didit<{ status: string }>(env, "check", {
      phone_number: target,
      code,
      // Throwaway and internet numbers are a common way to make many accounts.
      disposable_number_action: "DECLINE",
      voip_number_action: "DECLINE",
    });
    if (data.status !== "Approved") throw new ApiError("invalid_code");
  } else if (row.code_hash !== (await sha256(`${target}:${code}`))) {
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

export async function hashPin(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${PIN_ITERATIONS}$${b64(salt)}$${await pbkdf2(pin, salt, PIN_ITERATIONS)}`;
}

async function pinMatches(pin: string, stored: string): Promise<boolean> {
  const [scheme, iterations, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !salt || !hash) return false;
  const saltBytes = Uint8Array.from(atob(salt), (ch) => ch.charCodeAt(0));
  return (await pbkdf2(pin, saltBytes, Number(iterations))) === hash;
}

export function checkPinFormat(pin: string) {
  if (!validPinFormat(pin)) throw new ApiError("bad_pin");
  if (weakPin(pin)) throw new ApiError("weak_pin");
}

const USER_COLUMNS = `id, phone, email, full_name, role, ${ownerOf("users")}, ${merchantOf("users")}, ${pointPartnerOf("users")}, (select status from drivers where drivers.user_id = users.id) as driver_status`;
/** Column of users that holds this kind of contact. Fixed names only, never user input. */
export const contactColumn = (contact: Contact) => (contact.kind === "phone" ? "phone" : "email");

/** Numbers in ADMIN_PHONES and addresses in ADMIN_EMAILS become admin when they register. */
function isAdminContact(env: Env, contact: Contact): boolean {
  const list = listSetting(contact.kind === "phone" ? env.ADMIN_PHONES : env.ADMIN_EMAILS);
  return list.some((entry) => parseContact(entry)?.value === contact.value);
}

/**
 * Registration and "PIN forgotten": checks the code (SMS or e-mail), sets the PIN,
 * creates the user if new, and opens a session. A new PIN ends every other session of the user.
 */
export async function register(env: Env, request: Request, rawContact: string, rawCode: string, rawPin: string) {
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
    const role: UserRole = isAdminContact(env, contact) ? "admin" : "customer";
    const id = uuid();
    await env.DB.prepare(
      `insert into users (id, ${column}, role, created_at, pin_hash) values (?, ?, ?, ?, ?) on conflict do nothing`,
    )
      .bind(id, contact.value, roleToDb(role), now, pinHash)
      .run();
    user = await findUser();
    if (!user) throw new ApiError("unknown", 500);
    if (user.id === id) {
      await env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, null, 'profiles', 'insert', ?, ?, ?)",
      )
        .bind(now, id, id, JSON.stringify({ [column]: contact.value, role }))
        .run();
      return openSession(env, request, user);
    }
  }
  await env.DB.batch([
    env.DB.prepare("update users set pin_hash = ?, pin_failures = 0, pin_lock_count = 0, pin_locked_until = null where id = ?").bind(
      pinHash,
      user.id,
    ),
    env.DB.prepare("delete from sessions where user_id = ?").bind(user.id),
  ]);
  return openSession(env, request, user);
}

/**
 * Fleet manager registration (plan phase 6, M1): its own path, never through a customer
 * account (W5). The code proves the number or address, a new account with the role
 * fleet_manager and its fleet (status pending) are made together, and a session opens.
 * Until an admin approves the fleet its functions answer fleet_not_approved (worker/fleet.ts).
 * A number or address that already has an account is refused (one role per account):
 * whoever is also a customer registers the fleet with another number or address.
 */
export async function registerFleetManager(env: Env, request: Request, rawContact: string, rawCode: string, rawPin: string, rawName: unknown) {
  const contact = contactOrThrow(rawContact);
  const column = contactColumn(contact);
  const pin = String(rawPin ?? "").trim();
  const name = cleanFleetName(rawName);
  if (!name) throw new ApiError("bad_request");
  // Checked before the code, so a mistake does not use up the code.
  checkPinFormat(pin);
  const findUser = () => env.DB.prepare(`select ${USER_COLUMNS} from users where ${column} = ?`).bind(contact.value).first<UserRow>();
  if (await findUser()) throw new ApiError("account_exists", 409);
  await checkCode(env, contact.value, String(rawCode ?? "").trim());
  const now = nowIso();
  const id = uuid();
  try {
    await env.DB.batch([
      env.DB.prepare(`insert into users (id, ${column}, full_name, role, created_at, pin_hash) values (?, ?, ?, 'fleet_manager', ?, ?)`).bind(
        id,
        contact.value,
        name,
        now,
        await hashPin(pin),
      ),
      env.DB.prepare("insert into fleets (manager_id, name, status, tier, created_at) values (?, ?, 'pending', 'standard', ?)").bind(id, name, now),
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, ?, 'profiles', 'insert', ?, ?, ?)",
      ).bind(now, id, id, id, JSON.stringify({ [column]: contact.value, role: "fleet_manager" })),
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, ?, 'fleets', 'insert', ?, ?, ?)",
      ).bind(now, id, id, id, JSON.stringify({ name, status: "pending", tier: "standard" })),
    ]);
  } catch (err) {
    // Registered at the same moment from elsewhere.
    if (/UNIQUE/i.test(String(err))) throw new ApiError("account_exists", 409);
    throw err;
  }
  const user = await findUser();
  if (!user) throw new ApiError("unknown", 500);
  return openSession(env, request, user);
}

/**
 * Merchant registration (planung/marchand.md, M1): like fleets, its own path, never through a
 * customer account (W5). A new account with the role merchant, its shop (status pending) and
 * the membership as the shop's merchant are made together, and a session opens. Until an
 * admin approves the shop, its members only see the map and the stations (merchant_not_approved).
 */
export async function registerMerchant(env: Env, request: Request, rawContact: string, rawCode: string, rawPin: string, rawShop: unknown) {
  const contact = contactOrThrow(rawContact);
  const column = contactColumn(contact);
  const pin = String(rawPin ?? "").trim();
  const shop = cleanShop(rawShop as Partial<MerchantShopInput>);
  checkPinFormat(pin);
  const findUser = () => env.DB.prepare(`select ${USER_COLUMNS} from users where ${column} = ?`).bind(contact.value).first<UserRow>();
  if (await findUser()) throw new ApiError("account_exists", 409);
  await checkCode(env, contact.value, String(rawCode ?? "").trim());
  const now = nowIso();
  const id = uuid();
  const shopId = uuid();
  const log = (table: string, rowId: string, changes: Record<string, unknown>) =>
    env.DB.prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, ?, ?, 'insert', ?, ?, ?)",
    ).bind(now, id, table, rowId, id, JSON.stringify(changes));
  try {
    await env.DB.batch([
      env.DB.prepare(`insert into users (id, ${column}, full_name, role, created_at, pin_hash) values (?, ?, ?, 'merchant', ?, ?)`).bind(
        id,
        contact.value,
        shop.name,
        now,
        await hashPin(pin),
      ),
      env.DB.prepare(
        "insert into merchants (id, owner_id, name, phone, address, lat, lng, status, tier, created_at) values (?, ?, ?, ?, ?, ?, ?, 'pending', 'standard', ?)",
      ).bind(shopId, id, shop.name, shop.phone, shop.address, shop.lat, shop.lng, now),
      env.DB.prepare("insert into merchant_members (user_id, merchant_id, is_owner, created_at, added_by) values (?, ?, 1, ?, ?)").bind(id, shopId, now, id),
      log("profiles", id, { [column]: contact.value, role: "merchant" }),
      log("merchants", shopId, { merchant_id: shopId, name: shop.name, status: "pending", tier: "standard" }),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("account_exists", 409);
    throw err;
  }
  const user = await findUser();
  if (!user) throw new ApiError("unknown", 500);
  return openSession(env, request, user);
}

/** Everyday login with phone number or e-mail address, and PIN. A few wrong PINs lock the account for a while. */
export async function signIn(env: Env, request: Request, rawContact: string, rawPin: string) {
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
  await checkPin(env, user.id, pin, user);
  return openSession(env, request, user);
}

interface PinState {
  pin_hash: string | null;
  pin_failures: number;
  pin_locked_until: string | null;
}

/** Compares a PIN with the stored hash. A few wrong PINs in a row lock the account for a while. */
async function checkPin(env: Env, userId: string, pin: string, state: PinState) {
  if (!state.pin_hash) throw new ApiError("invalid_pin");
  const now = nowIso();
  // The try is counted before the PIN is compared, in one statement: parallel guesses each
  // take a try, and none is left once the account is locked.
  const slot = await env.DB.prepare(
    `update users set pin_failures = pin_failures + 1
      where id = ? and pin_failures < ? and (pin_locked_until is null or pin_locked_until <= ?)
      returning pin_failures, pin_lock_count`,
  )
    .bind(userId, PIN_MAX_FAILURES, now)
    .first<{ pin_failures: number; pin_lock_count: number }>();
  if (!slot) throw new ApiError("pin_locked", 429);
  if (!(await pinMatches(pin, state.pin_hash))) {
    if (slot.pin_failures < PIN_MAX_FAILURES) throw new ApiError("invalid_pin");
    // Each lock since the last right PIN lasts twice as long (15 min, 30 min, 1 h, … at most a day).
    const minutes = Math.min(PIN_LOCK_MINUTES * 2 ** slot.pin_lock_count, PIN_LOCK_MAX_MINUTES);
    await env.DB.prepare("update users set pin_failures = 0, pin_lock_count = pin_lock_count + 1, pin_locked_until = ? where id = ?")
      .bind(new Date(Date.now() + minutes * 60_000).toISOString(), userId)
      .run();
    throw new ApiError("pin_locked", 429);
  }
  await env.DB.prepare("update users set pin_failures = 0, pin_lock_count = 0, pin_locked_until = null where id = ?").bind(userId).run();
}

/** Confirms a payment with the signed-in user's PIN; wrong PINs count towards the same lock as the login. */
export async function verifyPin(env: Env, userId: string, rawPin: unknown) {
  const pin = String(rawPin ?? "").trim();
  if (!validPinFormat(pin)) throw new ApiError("invalid_pin");
  const state = await env.DB.prepare("select pin_hash, pin_failures, pin_locked_until from users where id = ?")
    .bind(userId)
    .first<PinState>();
  if (!state) throw new ApiError("not_authenticated", 401);
  await checkPin(env, userId, pin, state);
}

/**
 * Opens a session. With ADMIN_ACCESS_REQUIRED an admin account only gets one through the
 * back office (Cloudflare Access, worker/access.ts): a known PIN or a fresh login code alone
 * is not enough. Checked after the PIN, so this answer says nothing to someone without it.
 */
async function openSession(env: Env, request: Request, user: UserRow): Promise<{ token: string; profile: Profile }> {
  if (user.role === "admin" && !(await adminAllowed(env, request))) throw new ApiError("admin_access_required", 403);
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
      new Date(Date.now() + (user.role === "admin" || user.role === "operator" ? STAFF_SESSION_DAYS : SESSION_DAYS) * 86_400_000).toISOString(),
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
    `select u.id, u.phone, u.email, u.full_name, u.role, ${ownerOf("u")}, ${merchantOf("u")}, ${pointPartnerOf("u")}, d.status as driver_status from sessions s
     join users u on u.id = s.user_id left join drivers d on d.user_id = u.id
     where s.token_hash = ? and s.expires_at > ? and (u.role not in ${STAFF_ROLES_SQL} or s.created_at > ?)`,
  )
    .bind(await sha256(token), nowIso(), new Date(Date.now() - STAFF_SESSION_DAYS * 86_400_000).toISOString())
    .first<UserRow>();
  if (!row) return null;
  // An admin session only counts with Access as well (see openSession), on every request.
  if (row.role === "admin" && !(await adminAllowed(env, request))) return null;
  return toProfile(row);
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

export async function assertContactFree(env: Env, contact: Contact, userId: string) {
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
    // Wrong PINs count towards the same lock as the login.
    await verifyPin(env, profile.id, input.pin);
  }
  // Money left in the wallet belongs to the person: it has to be spent or paid out first.
  const wallet = await env.DB.prepare("select balance_xof from wallets where user_id = ?")
    .bind(profile.id)
    .first<{ balance_xof: number }>();
  if (wallet && wallet.balance_xof > 0) throw new ApiError("wallet_not_empty");
  // A converted driver's money waits in their former customer account until they claim it (0031).
  const unclaimed = await env.DB.prepare("select 1 from former_rider_accounts where driver_id = ? and rider_id is not null and claimed_at is null")
    .bind(profile.id)
    .first();
  if (unclaimed) throw new ApiError("wallet_not_empty");
  await env.DB.batch([
    env.DB.prepare(
      "update audit_log set changes = json_remove(changes, '$.phone', '$.email') where user_id = ? or row_id = ?",
    ).bind(profile.id, profile.id),
    env.DB.prepare("delete from sessions where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from station_staff where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from operator_owners where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from reservations where user_id = ?").bind(profile.id),
    env.DB.prepare("delete from station_reviews where user_id = ?").bind(profile.id),
    // Parcels stay on record (phone numbers included) but lose the link to the account.
    env.DB.prepare("update parcels set sender_user_id = null where sender_user_id = ?").bind(profile.id),
    env.DB.prepare("update parcels set recipient_user_id = null where recipient_user_id = ?").bind(profile.id),
    env.DB.prepare("delete from otp_codes where phone in (?, ?)").bind(profile.phone ?? "", profile.email ?? ""),
    // Only an empty wallet goes; if money arrived meanwhile, the user delete below fails and nothing changes.
    env.DB.prepare("delete from wallets where user_id = ? and balance_xof = 0").bind(profile.id),
    // Top-ups stay on record (accounting) without the paying number.
    env.DB.prepare("update wallet_topups set phone = null where user_id = ?").bind(profile.id),
    // Other people's history keeps the booking but no longer names this person.
    env.DB.prepare("update wallet_transactions set counterparty_label = null where counterparty_user_id = ?").bind(profile.id),
    // A merchant's shop goes with the account (cascade): its employees become customers again (R15).
    env.DB.prepare(
      `update users set role = 'rider' where role = 'merchant' and id <> ?1
         and id in (select mm.user_id from merchant_members mm join merchants m on m.id = mm.merchant_id where m.owner_id = ?1)`,
    ).bind(profile.id),
    env.DB.prepare("delete from users where id = ?").bind(profile.id),
  ]);
}

export async function signOut(env: Env, request: Request) {
  const token = bearer(request);
  if (token) await env.DB.prepare("delete from sessions where token_hash = ?").bind(await sha256(token)).run();
}
