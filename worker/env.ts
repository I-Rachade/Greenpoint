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
  /** Cloudflare Access team domain of the back office, e.g. "https://<team>.cloudflareaccess.com" (worker/access.ts, docs/BACKOFFICE.md). */
  ACCESS_TEAM_DOMAIN?: string;
  /** Application Audience (AUD) tag of the back office's Access application. */
  ACCESS_AUD?: string;
  /** "1": admin accounts only sign in and act through the back office, with a valid Access token. */
  ADMIN_ACCESS_REQUIRED?: string;
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
  /** Firebase service account JSON (secret) for push notifications; without it no push is sent, see docs/DEPLOYMENT.md. */
  FCM_SERVICE_ACCOUNT?: string;
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
  /** Cloudflare Turnstile secret key (secret); with TURNSTILE_SITE_KEY, a login code needs the widget's token. */
  TURNSTILE_SECRET?: string;
  /** Cloudflare Turnstile site key, shown to the login form (GET /api/auth/captcha). */
  TURNSTILE_SITE_KEY?: string;
  /** "tutrack" switches the Share trackers from the simulation to Tutrack (needs both TUTRACK_ACCESS values), see docs/SHARE.md. */
  SHARE_TRACKER_PROVIDER?: string;
  /** Tutrack open API access key (secret). */
  TUTRACK_ACCESS_KEY?: string;
  /** Tutrack open API access secret (secret). */
  TUTRACK_ACCESS_SECRET?: string;
  /** Tutrack API address; default https://openapi-ent.tqiot.com. */
  TUTRACK_BASE_URL?: string;
  /** Tutrack MQTT push: host (default pub.ent.tqiot.com), port (default 2883), "1" for TLS. */
  TUTRACK_MQTT_HOST?: string;
  TUTRACK_MQTT_PORT?: string;
  TUTRACK_MQTT_TLS?: string;
  /** Tutrack MQTT user name and password (secret), from Tutrack. */
  TUTRACK_MQTT_USER?: string;
  TUTRACK_MQTT_PASSWORD?: string;
  /** Our Tutrack enterprise id: the push topic is server/ent/<id>. */
  TUTRACK_ENT_ID?: string;
  /** The one Durable Object that holds the Tutrack MQTT subscription (worker/tutrack-bridge.ts). */
  TUTRACK?: DurableObjectNamespace;
  /** Request limits (Cloudflare rate limiting bindings, wrangler.jsonc; worker/security.ts). Absent: no limit. */
  API_IP_LIMIT?: RateLimit;
  API_USER_LIMIT?: RateLimit;
  API_WRITE_LIMIT?: RateLimit;
  API_STAFF_LIMIT?: RateLimit;
  PARTNER_LIMIT?: RateLimit;
  /** One Durable Object per OCPP charge point, holding its WebSocket (wrangler.jsonc, worker/ocpp.ts). */
  OCPP?: DurableObjectNamespace;
}
