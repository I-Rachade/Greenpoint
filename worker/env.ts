/** Bindings and settings of the Worker (see wrangler.jsonc and docs/DEPLOYMENT.md). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  /** Cloudflare Email Service binding that sends the login codes by e-mail (wrangler.jsonc `send_email`). */
  EMAIL?: SendEmail;
  /** Didit API key (secret) for the login codes, see docs/DEPLOYMENT.md. */
  DIDIT_API_KEY?: string;
  /** How Didit delivers the code: "sms" (default) or "whatsapp" etc.; falls back to SMS. */
  DIDIT_CHANNEL?: string;
  /** Numbers or addresses that log in with a fixed code and get no SMS or e-mail, e.g. "+22890000001=123456,test@example.com=654321". */
  TEST_OTP?: string;
  /** Numbers that become admin on their first login, e.g. "+22890000001". */
  ADMIN_PHONES?: string;
  /** E-mail addresses that become admin on their first login, e.g. "chef@poinderecharge.com". */
  ADMIN_EMAILS?: string;
  /** Most login SMS sent per hour across all numbers (cost protection). Default 30. */
  OTP_HOURLY_LIMIT?: string;
  /** Most code e-mails sent per hour across all addresses. Default 100. */
  EMAIL_HOURLY_LIMIT?: string;
}
