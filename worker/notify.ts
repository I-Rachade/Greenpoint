import type { Env } from "./env";
import { nowIso } from "./http";
import { noticeOf, sendPush } from "./push";

/** Sender of all e-mails; its domain is onboarded in Cloudflare Email Service (see wrangler.jsonc). */
export const EMAIL_FROM = "noreply@poinderecharge.com";

export interface Message {
  subject: string;
  text: string;
}

type SendResult = { ok: true } | { ok: false; error: string };

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

/** Sends a plain message by e-mail through Cloudflare Email Service (binding EMAIL). */
async function sendEmail(env: Env, email: string, message: Message): Promise<SendResult> {
  if (!env.EMAIL) return { ok: false, error: "email_not_configured" };
  try {
    await env.EMAIL.send({
      from: { email: EMAIL_FROM, name: "poinderecharge" },
      to: email,
      subject: message.subject,
      text: message.text,
      html: message.text
        .split("\n\n")
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
        .join(""),
    });
    return { ok: true };
  } catch (err) {
    const code = (err as { code?: string }).code ?? "email_failed";
    console.error("E-mail send failed", code, (err as Error).message);
    return { ok: false, error: code };
  }
}

/**
 * Tells one person about a parcel. Every customer sees their parcels and their
 * status in the app ("Mes colis"); people whose account has an e-mail address
 * also get an e-mail. No SMS (decided in planung/paketdepot.md). Each e-mail is
 * logged in parcel_notifications. Never throws: a failed message must not undo the parcel step.
 */
export async function notifyPerson(
  env: Env,
  parcelId: string,
  kind: string,
  userId: string | null,
  message: Message,
): Promise<void> {
  if (!userId) return;
  try {
    const user = await env.DB.prepare("select email from users where id = ?").bind(userId).first<{ email: string | null }>();
    if (!user?.email) return;
    const result = await sendEmail(env, user.email, message);
    await env.DB.prepare(
      "insert into parcel_notifications (parcel_id, at, kind, channel, target, ok, error) values (?, ?, ?, 'email', ?, ?, ?)",
    )
      .bind(parcelId, nowIso(), kind, user.email, result.ok ? 1 : 0, result.ok ? null : result.error)
      .run();
  } catch (err) {
    console.error("Parcel notification failed", parcelId, kind, (err as Error).message);
  }
}

/**
 * Tells an account holder about something outside parcels (e.g. a reservation cancelled
 * because the station closed) by e-mail when the account has an address. The app shows it
 * too (alerts). Never throws.
 */
export async function notifyUser(env: Env, userId: string, message: Message): Promise<void> {
  await sendPush(env, userId, noticeOf(message));
  try {
    const user = await env.DB.prepare("select email from users where id = ?").bind(userId).first<{ email: string | null }>();
    if (user?.email) await sendEmail(env, user.email, message);
  } catch (err) {
    console.error("Notification failed", userId, (err as Error).message);
  }
}
