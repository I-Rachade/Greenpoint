// Protection against abuse (plan of 26.10.2026), on top of the PIN lock (auth.ts), the limits
// per address on the login routes (ip-limits.ts) and the code tries (code-tries.ts):
// - the robot check on the PIN login once a contact or an address has a few failed tries, and
//   for everyone while the whole app sees many failed logins (spraying one PIN over many numbers);
// - request limits on the whole API, per address and per account (Cloudflare rate limiting
//   bindings, wrangler.jsonc), and per partner on the partner API;
// - the back office page "Sécurité": locked accounts, unlock, the security log.
import { type Contact, parseContact } from "../shared/contact";
import type { LockedAccount, SecurityEvent, SecurityEventKind, SecurityOverview } from "../shared/security";
import type { Profile } from "../shared/types";
import { contactColumn, signIn } from "./auth";
import type { Env } from "./env";
import { ApiError, nowIso, sha256 } from "./http";
import { captchaSiteKey, checkCaptcha, clientIp } from "./ip-limits";
import { logSecurityEvent } from "./security-log";

/** Failed PIN logins for one contact or from one address within the window before the robot check is asked for. */
export const LOGIN_CAPTCHA_AFTER = 3;
export const LOGIN_FAIL_WINDOW_MINUTES = 15;
/** Failed PIN logins across the app within the window that turn on the alarm: every login asks for the robot check. */
export const LOGIN_ALARM_FAILURES = 200;
/** How long the alarm lasts once on. */
export const LOGIN_ALARM_MINUTES = 60;

/** The contact as the log keeps it: a hash, so tries count for unknown contacts and nothing reveals who has an account. */
export function contactSubject(contact: Contact): Promise<string> {
  return sha256(`login:${contact.kind}:${contact.value}`);
}

/** "+22890****01", "am***@gmail.com": enough for an admin to recognise a contact, not to read it. */
export function maskContact(contact: Contact): string {
  if (contact.kind === "email") {
    const [name, domain] = contact.value.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }
  return `${contact.value.slice(0, 6)}****${contact.value.slice(-2)}`;
}

/** Whether the alarm is on: many failed logins across the app in the window, or an alarm within the last hour. */
async function alarmOn(db: D1Database): Promise<boolean> {
  const now = Date.now();
  const row = await db
    .prepare(
      `select (select count(*) from security_events where kind = 'pin_failed' and at > ?1) as failed,
              (select count(*) from security_events where kind = 'alarm' and at > ?2) as alarms`,
    )
    .bind(new Date(now - LOGIN_FAIL_WINDOW_MINUTES * 60_000).toISOString(), new Date(now - LOGIN_ALARM_MINUTES * 60_000).toISOString())
    .first<{ failed: number; alarms: number }>();
  if (row?.alarms) return true;
  if ((row?.failed ?? 0) < LOGIN_ALARM_FAILURES) return false;
  await logSecurityEvent(db, { kind: "alarm", detail: `${row?.failed}`, dedupe: `alarm:${new Date(now).toISOString().slice(0, 13)}` });
  return true;
}

/**
 * Whether this login must pass the robot check first: LOGIN_CAPTCHA_AFTER failed tries for the
 * contact or from the address within the window, or the alarm. Never while Turnstile is not set up.
 */
export async function loginNeedsCaptcha(env: Env, subject: string, ip: string | null): Promise<boolean> {
  if (!captchaSiteKey(env)) return false;
  const since = new Date(Date.now() - LOGIN_FAIL_WINDOW_MINUTES * 60_000).toISOString();
  const row = await env.DB.prepare(
    `select (select count(*) from security_events where subject = ?1 and kind = 'pin_failed' and at > ?3) as by_contact,
            (select count(*) from security_events where ip = ?2 and kind = 'pin_failed' and at > ?3) as by_ip`,
  )
    .bind(subject, ip ?? "", since)
    .first<{ by_contact: number; by_ip: number }>();
  if ((row?.by_contact ?? 0) >= LOGIN_CAPTCHA_AFTER || (ip && (row?.by_ip ?? 0) >= LOGIN_CAPTCHA_AFTER)) return true;
  return alarmOn(env.DB);
}

/**
 * The PIN login (POST /api/auth/login) with the robot check when loginNeedsCaptcha says so:
 * without a token 400 captcha_required (the form then shows the widget and sends again).
 * A wrong PIN or a locked account is written to the security log, for known and unknown contacts alike.
 */
export async function guardedSignIn(env: Env, request: Request, rawContact: string, pin: string, captcha: unknown) {
  const contact = parseContact(String(rawContact ?? ""));
  // Not a contact at all: signIn gives the right answer, there is nothing to count.
  if (!contact) return signIn(env, request, rawContact, pin);
  const subject = await contactSubject(contact);
  const ip = clientIp(request);
  if (await loginNeedsCaptcha(env, subject, ip)) {
    if (!captcha) throw new ApiError("captcha_required", 400);
    await checkCaptcha(env, request, captcha);
  }
  try {
    return await signIn(env, request, rawContact, pin);
  } catch (err) {
    if (err instanceof ApiError && (err.code === "invalid_pin" || err.code === "pin_locked")) {
      const user = await env.DB.prepare(`select id from users where ${contactColumn(contact)} = ?`).bind(contact.value).first<{ id: string }>();
      await logSecurityEvent(env.DB, { kind: "pin_failed", userId: user?.id, ip, subject, detail: maskContact(contact) });
    }
    throw err;
  }
}

// Request limits -------------------------------------------------------------------

/** Seconds to wait after a refused request: the bindings count per minute. */
const LIMIT_WAIT_SECONDS = 60;

/** Limited keys already written to the log this minute, so a flood does not turn into a flood of writes. */
const loggedLimits = new Map<string, string>();

function logLimitOnce(db: D1Database, kind: SecurityEventKind, key: string, e: { userId?: string | null; ip?: string | null; detail: string }) {
  const minute = new Date().toISOString().slice(0, 16);
  if (loggedLimits.get(`${kind}:${key}`) === minute) return Promise.resolve();
  if (loggedLimits.size > 5000) loggedLimits.clear();
  loggedLimits.set(`${kind}:${key}`, minute);
  return logSecurityEvent(db, { kind, ...e, dedupe: `${kind}:${key}:${minute}` });
}

/** Asks one binding; a missing binding (local runs, tests) or a failing one lets the request through. */
async function allowed(limit: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limit) return true;
  try {
    return (await limit.limit({ key })).success;
  } catch (err) {
    console.error("rate limit", (err as Error).message);
    return true;
  }
}

/**
 * Every API request counts for its address (API_IP_LIMIT, 300 a minute: many phones share a
 * carrier's address). 429 rate_limited over the limit.
 */
export async function limitByIp(env: Env, request: Request): Promise<void> {
  const ip = clientIp(request);
  if (!ip || (await allowed(env.API_IP_LIMIT, `ip:${ip}`))) return;
  await logLimitOnce(env.DB, "api_limited", `ip:${ip}`, { ip, detail: "ip" });
  throw new ApiError("rate_limited", 429, LIMIT_WAIT_SECONDS);
}

/**
 * A signed-in request also counts for its account: customers 120 a minute (API_USER_LIMIT), and
 * at most 30 changes a minute (API_WRITE_LIMIT, every method but GET); staff, drivers and the other
 * working roles 600 a minute (API_STAFF_LIMIT) without a separate limit on changes, as counter work
 * and driver positions send many in a row.
 */
export async function limitByUser(env: Env, request: Request, user: Profile): Promise<void> {
  const customer = user.role === "customer";
  const key = `user:${user.id}`;
  let which: string | null = null;
  if (!(await allowed(customer ? env.API_USER_LIMIT : env.API_STAFF_LIMIT, key))) which = customer ? "user" : "staff";
  else if (customer && request.method !== "GET" && !(await allowed(env.API_WRITE_LIMIT, key))) which = "write";
  if (!which) return;
  await logLimitOnce(env.DB, "api_limited", `${which}:${user.id}`, { userId: user.id, ip: clientIp(request), detail: which });
  throw new ApiError("rate_limited", 429, LIMIT_WAIT_SECONDS);
}

/** Partner API: 60 requests a minute per partner, all its keys together (PARTNER_LIMIT). False when over. */
export async function partnerAllowed(env: Env, request: Request, partnerId: string): Promise<boolean> {
  if (await allowed(env.PARTNER_LIMIT, `partner:${partnerId}`)) return true;
  await logLimitOnce(env.DB, "partner_limited", `partner:${partnerId}`, { ip: clientIp(request), detail: partnerId });
  return false;
}

export const PARTNER_RETRY_SECONDS = LIMIT_WAIT_SECONDS;

// Back office ----------------------------------------------------------------------

const EVENTS_SHOWN = 200;

/** GET /api/admin/security: locked accounts, figures of the last 24 hours and the newest events. */
export async function securityOverview(env: Env): Promise<SecurityOverview> {
  const db = env.DB;
  const now = nowIso();
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const [locked, counts, ips, events, alarm] = await Promise.all([
    db
      .prepare(
        `select id, phone, email, full_name, pin_locked_until, pin_lock_count from users
         where pin_locked_until > ? order by pin_locked_until desc limit 200`,
      )
      .bind(now)
      .all<{ id: string; phone: string | null; email: string | null; full_name: string | null; pin_locked_until: string; pin_lock_count: number }>(),
    db.prepare("select kind, count(*) as n from security_events where at > ? group by kind").bind(dayAgo).all<{ kind: SecurityEventKind; n: number }>(),
    db
      .prepare(
        `select ip, count(*) as n from security_events
         where at > ? and ip is not null and kind in ('pin_failed', 'captcha_failed', 'ip_limited', 'api_limited', 'partner_limited')
         group by ip order by n desc limit 10`,
      )
      .bind(dayAgo)
      .all<{ ip: string; n: number }>(),
    db
      .prepare(`select id, at, kind, user_id, ip, detail from security_events order by id desc limit ${EVENTS_SHOWN}`)
      .all<{ id: number; at: string; kind: SecurityEventKind; user_id: string | null; ip: string | null; detail: string | null }>(),
    captchaSiteKey(env) ? alarmOn(db) : Promise.resolve(false),
  ]);
  return {
    captchaOn: !!captchaSiteKey(env),
    alarm,
    locked: locked.results.map(
      (r): LockedAccount => ({
        userId: r.id,
        phone: r.phone,
        email: r.email,
        fullName: r.full_name,
        lockedUntil: r.pin_locked_until,
        lockCount: r.pin_lock_count,
      }),
    ),
    last24h: Object.fromEntries(counts.results.map((r) => [r.kind, r.n])),
    topIps: ips.results.map((r) => ({ ip: r.ip, count: r.n })),
    events: events.results.map((r): SecurityEvent => ({ id: r.id, at: r.at, kind: r.kind, userId: r.user_id, ip: r.ip, detail: r.detail })),
  };
}

/** POST /api/admin/security/unlock/:id: an admin lifts an account's PIN lock and forgets its earlier locks. */
export async function unlockAccount(env: Env, admin: Profile, userId: string): Promise<{ ok: true }> {
  const res = await env.DB.prepare("update users set pin_failures = 0, pin_lock_count = 0, pin_locked_until = null where id = ?").bind(userId).run();
  if (!res.meta.changes) throw new ApiError("not_found", 404);
  await logSecurityEvent(env.DB, { kind: "unlocked", userId, detail: admin.id });
  return { ok: true };
}
