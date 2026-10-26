// The security log (0062 security_events), written by the login, the PIN lock and the request
// limits, read by the back office page "Sécurité" (worker/security.ts). Kept apart from
// security.ts so worker/auth.ts can write to it without importing the login guard.
import type { SecurityEventKind } from "../shared/security";
import { nowIso } from "./http";

export interface SecurityEventInput {
  kind: SecurityEventKind;
  userId?: string | null;
  ip?: string | null;
  /** SHA-256 of the contact typed at the login (security.ts contactSubject). */
  subject?: string | null;
  detail?: string | null;
  /** At most one row per key: a second write with the same key is dropped. */
  dedupe?: string;
}

/** Days the log keeps its rows (daily cron). */
export const SECURITY_LOG_DAYS = 30;

/** Writes one event. Never throws: a full log must not turn a refusal into a 500. */
export async function logSecurityEvent(db: D1Database, e: SecurityEventInput): Promise<void> {
  try {
    await db
      .prepare("insert or ignore into security_events (at, kind, user_id, ip, subject, detail, dedupe) values (?, ?, ?, ?, ?, ?, ?)")
      .bind(nowIso(), e.kind, e.userId ?? null, e.ip ?? null, e.subject ?? null, e.detail ?? null, e.dedupe ?? null)
      .run();
  } catch (err) {
    console.error("security log", e.kind, (err as Error).message);
  }
}

/** Drops events older than SECURITY_LOG_DAYS (daily cron). */
export async function pruneSecurityEvents(db: D1Database): Promise<void> {
  await db
    .prepare("delete from security_events where at < ?")
    .bind(new Date(Date.now() - SECURITY_LOG_DAYS * 86_400_000).toISOString())
    .run();
}
