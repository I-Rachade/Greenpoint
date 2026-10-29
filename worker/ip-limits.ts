// Limits per IP address on the open login routes (security review 2026-10-19, point 9), and the
// optional Cloudflare Turnstile check before a code is sent. The request is written down before
// it runs, in one statement with the count, so parallel requests cannot pass the limit.
import type { Env } from "./env";
import { ApiError, nowIso } from "./http";
import { logSecurityEvent } from "./security-log";

/** "login": PIN logins and registrations (a code and a new PIN). */
export type IpLimitKind = "send" | "login";

/** Requests one IP address may make per window: generous, as many phones share a carrier's address. */
export const IP_LIMITS: Record<IpLimitKind, { max: number; minutes: number }> = {
  send: { max: 10, minutes: 60 },
  login: { max: 60, minutes: 15 },
};

/** The caller's address as Cloudflare sees it; absent outside Cloudflare (local runs, tests). */
export function clientIp(request: Request): string | null {
  return request.headers.get("CF-Connecting-IP");
}

/** Counts the request for its IP address; 429 rate_limited once the window's limit is reached. */
export async function countIpRequest(db: D1Database, request: Request, kind: IpLimitKind): Promise<void> {
  const ip = clientIp(request);
  if (!ip) return;
  const { max, minutes } = IP_LIMITS[kind];
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const counted = await db
    .prepare(
      `insert into auth_ip_requests (ip, kind, at)
       select ?1, ?2, ?3 where (select count(*) from auth_ip_requests where ip = ?1 and kind = ?2 and at > ?4) < ?5
       returning rowid`,
    )
    .bind(ip, kind, nowIso(), since, max)
    .first<{ rowid: number }>();
  if (counted) return;
  // How long until the oldest request of the window ages out.
  const oldest = await db
    .prepare("select min(at) as at from auth_ip_requests where ip = ? and kind = ? and at > ?")
    .bind(ip, kind, since)
    .first<{ at: string | null }>();
  const wait = oldest?.at ? (Date.parse(oldest.at) + minutes * 60_000 - Date.now()) / 1000 : minutes * 60;
  await logSecurityEvent(db, { kind: "ip_limited", ip, detail: kind, dedupe: `ip_limited:${kind}:${ip}:${new Date().toISOString().slice(0, 16)}` });
  throw new ApiError("rate_limited", 429, Math.max(wait, 1));
}

/** Drops counts older than a day (minute cron). */
export async function pruneIpRequests(db: D1Database): Promise<void> {
  await db.prepare("delete from auth_ip_requests where at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()).run();
}

/** The Turnstile site key the login form shows the widget with; null while Turnstile is off. */
export function captchaSiteKey(env: Env): string | null {
  return env.TURNSTILE_SECRET && env.TURNSTILE_SITE_KEY ? env.TURNSTILE_SITE_KEY : null;
}

/**
 * With TURNSTILE_SECRET and TURNSTILE_SITE_KEY set, a code is only sent with a Turnstile token
 * Cloudflare confirms; otherwise nothing is checked.
 */
export async function checkCaptcha(env: Env, request: Request, token: unknown): Promise<void> {
  if (!captchaSiteKey(env)) return;
  if (typeof token !== "string" || !token || token.length > 2048) throw new ApiError("captcha_failed", 400);
  const form = new FormData();
  form.append("secret", env.TURNSTILE_SECRET!);
  form.append("response", token);
  const ip = clientIp(request);
  if (ip) form.append("remoteip", ip);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form });
  const outcome = res.ok ? await res.json<{ success?: boolean }>().catch(() => null) : null;
  if (!outcome?.success) {
    await logSecurityEvent(env.DB, { kind: "captcha_failed", ip });
    throw new ApiError("captcha_failed", 400);
  }
}
