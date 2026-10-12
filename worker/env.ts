/** Bindings and settings of the Worker (see wrangler.jsonc and docs/DEPLOYMENT.md). */
export interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  MEDIA: R2Bucket;
  /** Twilio account that sends the login SMS (secrets). */
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_MESSAGING_SERVICE_SID?: string;
  /** Numbers that log in with a fixed code and get no SMS, e.g. "+22890000001=123456,+22890000002=654321". */
  TEST_OTP?: string;
  /** Numbers that become admin on their first login, e.g. "+22890000001". */
  ADMIN_PHONES?: string;
  /** Most login SMS sent per hour across all numbers (cost protection). Default 30. */
  OTP_HOURLY_LIMIT?: string;
}
