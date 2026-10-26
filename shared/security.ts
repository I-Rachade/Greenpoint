// The back office page "Sécurité" (worker/security.ts): locked accounts, the security log and
// the figures of the last 24 hours. Imported by worker/ and src/ alike.

/** What the security log records. */
export const SECURITY_EVENT_KINDS = ["pin_failed", "pin_locked", "captcha_failed", "ip_limited", "api_limited", "partner_limited", "alarm", "unlocked"] as const;
export type SecurityEventKind = (typeof SECURITY_EVENT_KINDS)[number];

export interface SecurityEvent {
  id: number;
  at: string;
  kind: SecurityEventKind;
  userId: string | null;
  ip: string | null;
  /** Masked contact of a failed login, the limit that refused a request, or the admin who unlocked. */
  detail: string | null;
}

/** An account locked by wrong PINs right now. */
export interface LockedAccount {
  userId: string;
  phone: string | null;
  email: string | null;
  fullName: string | null;
  lockedUntil: string;
  /** Locks in a row since the last right PIN (each one lasts twice as long). */
  lockCount: number;
}

export interface SecurityOverview {
  /** Whether the robot check (Cloudflare Turnstile) is set up; without it the login cannot ask for one. */
  captchaOn: boolean;
  /** Whether every login asks for the robot check right now (many failed logins across the app). */
  alarm: boolean;
  locked: LockedAccount[];
  /** Counts per kind over the last 24 hours. */
  last24h: Partial<Record<SecurityEventKind, number>>;
  /** Addresses with the most failed logins and refused requests over the last 24 hours. */
  topIps: { ip: string; count: number }[];
  /** The newest events, newest first. */
  events: SecurityEvent[];
}
