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
  /** "paygate" switches from the simulated payment provider to real payments (needs PAYGATE_AUTH_TOKEN). */
  PAYMENTS_PROVIDER?: string;
  /** PayGate Global API key (secret). */
  PAYGATE_AUTH_TOKEN?: string;
  /** "cinetpay" switches wallet top-ups by bank card from the simulation to real payments (needs both CINETPAY values). */
  CARD_PROVIDER?: string;
  /** CinetPay API key (secret). */
  CINETPAY_API_KEY?: string;
  /** CinetPay site id. */
  CINETPAY_SITE_ID?: string;
  /** Secret in the callback URL the provider calls, see docs/ZAHLUNGEN.md. */
  PAYMENT_CALLBACK_SECRET?: string;
  /** Most code e-mails sent per hour across all addresses. Default 100. */
  EMAIL_HOURLY_LIMIT?: string;
  /** Shared key of the connected sockets (secret), see docs/steckdosen-lora.md. */
  DEVICE_WEBHOOK_SECRET?: string;
  /** Host of the Xingke cloud API, e.g. "api.example.com" (from the vendor), see docs/steckdosen-lora.md. */
  XINGKE_API_HOST?: string;
  /** Our access credential for the Xingke cloud API (secret). */
  XINGKE_API_TOKEN?: string;
  /** Credential the Xingke platform sends with its callbacks to /api/devices/xingke (secret). */
  XINGKE_CALLBACK_TOKEN?: string;
}
