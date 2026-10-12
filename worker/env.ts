/** Bindings and settings of the Worker (see wrangler.jsonc and docs/DEPLOYMENT.md). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  /** Didit API key (secret) for the login codes, see docs/DEPLOYMENT.md. */
  DIDIT_API_KEY?: string;
  /** How Didit delivers the code: "sms" (default) or "whatsapp" etc.; falls back to SMS. */
  DIDIT_CHANNEL?: string;
  /** Numbers that log in with a fixed code and get no SMS, e.g. "+22890000001=123456,+22890000002=654321". */
  TEST_OTP?: string;
  /** Numbers that become admin on their first login, e.g. "+22890000001". */
  ADMIN_PHONES?: string;
  /** Most login SMS sent per hour across all numbers (cost protection). Default 30. */
  OTP_HOURLY_LIMIT?: string;
  /** "paygate" switches from the simulated payment provider to real payments (needs PAYGATE_AUTH_TOKEN). */
  PAYMENTS_PROVIDER?: string;
  /** PayGate Global API key (secret). */
  PAYGATE_AUTH_TOKEN?: string;
  /** Secret in the callback URL the provider calls, see docs/ZAHLUNGEN.md. */
  PAYMENT_CALLBACK_SECRET?: string;
}
