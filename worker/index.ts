import { handleApi } from "./api";
import type { Env } from "./env";
import { parcelsEnabled } from "./features";
import { corsHeaders } from "./http";
import { handleOcppUpgrade } from "./ocpp";
import { runParcelDeadlines } from "./parcels";
import { runPartnerDeadlines, runPartnerEvents } from "./partners";

// The Durable Object behind each OCPP charge point's WebSocket (wrangler.jsonc).
export { OcppConnection } from "./ocpp";

/**
 * OCPP charge points connect here (worker/ocpp.ts): /api/devices/ocpp/<id>, or
 * /api/devices/ocpp/k/<key>/<id> for chargers that cannot send a password.
 */
const OCPP_PATH = /^\/api\/devices\/ocpp\/(?:k\/([^/]+)\/)?([^/]+)$/;

/** The daily cron in wrangler.jsonc. */
const DAILY_CRON = "0 8 * * *";

/** Requests after which partners may have news (parcel or booking changes). */
const PARCEL_CHANGE = /^\/api\/(stations\/[\w-]+\/(parcels|bookings)|parcels|admin\/parcels|partner\/)/;

/**
 * The whole app on Cloudflare: /api/* is answered here (D1 database, R2 images,
 * SMS login), everything else is the static web app from `out/`.
 */
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // A WebSocket for a charge point, not a browser call: no CORS.
    const ocpp = OCPP_PATH.exec(url.pathname);
    if (ocpp) return handleOcppUpgrade(request, env, ocpp[2], ocpp[1]);

    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const response = await handleApi(request, env);
    // Tell partners right away instead of waiting for the next minute (worker/partners.ts).
    if (request.method !== "GET" && PARCEL_CHANGE.test(url.pathname)) ctx.waitUntil(runPartnerEvents(env));
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  },
  /**
   * Crons in wrangler.jsonc: every minute partner webhooks, daily parcel reminders and returns.
   * Nothing runs while the parcel module is switched off; it catches up once it is back on.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      parcelsEnabled(env).then(async (on) => {
        if (!on) return;
        if (controller.cron === DAILY_CRON) await runParcelDeadlines(env).then(() => runPartnerDeadlines(env));
        await runPartnerEvents(env);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
