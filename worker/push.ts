import type { Env } from "./env";
import { ApiError, nowIso } from "./http";
import type { ParcelCtx } from "./parcels";

// Push notifications through Firebase Cloud Messaging (HTTP v1), planung/fahrer.md phase 2.
// The app registers the phone's token after sign-in; the Worker sends a short notice next
// to the e-mail. Without the FCM_SERVICE_ACCOUNT secret nothing is sent (see docs/DEPLOYMENT.md).

export const PUSH_PLATFORMS = ["android", "ios"] as const;
export type PushPlatform = (typeof PUSH_PLATFORMS)[number];

export interface PushNotice {
  title: string;
  body: string;
  /** Path the app opens when the notice is tapped, e.g. "/chauffeur". */
  path?: string;
}

/** Most phones one account keeps tokens for (old installs drop out first). */
const TOKENS_PER_USER = 5;
const TOKEN_MAX = 4096;

type Ctx = Pick<ParcelCtx, "db" | "requireUser">;

/** The app on this phone signs up for notices of the signed-in account. */
export async function registerPushToken(c: Ctx, input: unknown): Promise<{ ok: true }> {
  const user = await c.requireUser();
  const { token, platform } = (input ?? {}) as { token?: unknown; platform?: unknown };
  if (typeof token !== "string" || !token.trim() || token.length > TOKEN_MAX) throw new ApiError("bad_request", 400);
  if (!PUSH_PLATFORMS.includes(platform as PushPlatform)) throw new ApiError("bad_request", 400);
  const now = nowIso();
  await c.db.batch([
    // A phone that changes account moves its token over.
    c.db
      .prepare(
        "insert into push_tokens (token, user_id, platform, updated_at) values (?, ?, ?, ?) on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, updated_at = excluded.updated_at",
      )
      .bind(token.trim(), user.id, platform, now),
    c.db
      .prepare(
        "delete from push_tokens where user_id = ? and token not in (select token from push_tokens where user_id = ? order by updated_at desc limit ?)",
      )
      .bind(user.id, user.id, TOKENS_PER_USER),
  ]);
  return { ok: true };
}

/** Sign-out on this phone: no more notices for that account here. */
export async function removePushToken(c: Ctx, input: unknown): Promise<{ ok: true }> {
  const user = await c.requireUser();
  const { token } = (input ?? {}) as { token?: unknown };
  if (typeof token !== "string") throw new ApiError("bad_request", 400);
  await c.db.prepare("delete from push_tokens where token = ? and user_id = ?").bind(token.trim(), user.id).run();
  return { ok: true };
}

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function serviceAccount(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const sa = JSON.parse(env.FCM_SERVICE_ACCOUNT) as Partial<ServiceAccount>;
    return sa.project_id && sa.client_email && sa.private_key ? (sa as ServiceAccount) : null;
  } catch {
    console.error("FCM_SERVICE_ACCOUNT is not valid JSON");
    return null;
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : new Uint8Array(bytes);
  let s = "";
  raw.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

let cachedToken: { value: string; until: number; email: string } | null = null;

/** OAuth access token of the service account (signed JWT exchanged at Google), kept ~50 minutes. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.until > now) return cachedToken.value;
  const pem = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(
    JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }),
  )}`;
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64url(signature)}`,
  });
  if (!res.ok) throw new Error(`fcm_auth_${res.status}`);
  const body = (await res.json()) as { access_token: string; expires_in?: number };
  cachedToken = { value: body.access_token, until: now + Math.min(body.expires_in ?? 3600, 3600) - 600, email: sa.client_email };
  return body.access_token;
}

/**
 * Sends a notice to every phone of the account. Tokens Firebase no longer knows are removed.
 * Does nothing without FCM_SERVICE_ACCOUNT or tokens. Never throws.
 */
export async function sendPush(env: Env, userId: string, notice: PushNotice): Promise<number> {
  try {
    const sa = serviceAccount(env);
    if (!sa) return 0;
    const { results } = await env.DB.prepare("select token from push_tokens where user_id = ?").bind(userId).all<{ token: string }>();
    if (!results.length) return 0;
    const auth = await accessToken(sa);
    let sent = 0;
    await Promise.all(
      results.map(async ({ token }) => {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: "POST",
          headers: { authorization: `Bearer ${auth}`, "content-type": "application/json" },
          body: JSON.stringify({
            message: {
              token,
              notification: { title: notice.title, body: notice.body },
              data: notice.path ? { path: notice.path } : {},
              android: { priority: "high", notification: { channel_id: "offers", sound: "default" } },
              apns: { payload: { aps: { sound: "default" } } },
            },
          }),
        });
        if (res.ok) sent++;
        else if (res.status === 404) {
          // UNREGISTERED: the app was removed from that phone.
          await env.DB.prepare("delete from push_tokens where token = ?").bind(token).run();
        } else console.error("Push send failed", res.status);
      }),
    );
    return sent;
  } catch (err) {
    console.error("Push failed", (err as Error).message);
    return 0;
  }
}

const APP_ORIGIN = "https://app.poinderecharge.com";

/** The push form of an e-mail message: the subject as title, the text without its link, which becomes the path to open. */
export function noticeOf(message: { subject: string; text: string }): PushNotice {
  const link = message.text.match(/https:\/\/app\.poinderecharge\.com(\/[^\s]*)?/);
  const body = message.text
    .replace(/\s*:?\s*https?:\/\/\S+/g, "")
    .replace(/^poinderecharge\s*:\s*/, "")
    .trim();
  const path = link ? (link[1] ?? "/") : undefined;
  return { title: message.subject, body: body.length > 240 ? `${body.slice(0, 239)}…` : body, path: path && new URL(path, APP_ORIGIN).pathname };
}
