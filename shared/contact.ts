import { normalizeTogoPhone } from "./phone";

/** How a person signs in: a Togolese phone number (code by SMS) or an e-mail address (code by e-mail). */
export type Contact = { kind: "phone"; value: string } | { kind: "email"; value: string };

/** Same limits as the database (worker/migrations/0003_email_login.sql). */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lower-cases and checks an e-mail address, or returns null. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= 254 && EMAIL_PATTERN.test(email) ? email : null;
}

/**
 * Reads what was typed in the login field: anything with "@" is an e-mail
 * address, everything else a phone number. Returns null when neither is valid.
 */
export function parseContact(input: string): Contact | null {
  const raw = (input ?? "").trim();
  if (raw.includes("@")) {
    const email = normalizeEmail(raw);
    return email ? { kind: "email", value: email } : null;
  }
  const phone = normalizeTogoPhone(raw);
  return phone ? { kind: "phone", value: phone } : null;
}
