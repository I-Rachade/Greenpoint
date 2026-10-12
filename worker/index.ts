import { handleApi } from "./api";
import type { Env } from "./env";
import { corsHeaders } from "./http";
import { runParcelDeadlines } from "./parcels";
import { runPartnerDeadlines, runPartnerEvents } from "./partners";

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

    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const response = await handleApi(request, env);
    // Tell partners right away instead of waiting for the next minute (worker/partners.ts).
    if (request.method !== "GET" && PARCEL_CHANGE.test(url.pathname)) ctx.waitUntil(runPartnerEvents(env));
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  },
  /** Crons in wrangler.jsonc: every minute partner webhooks, daily parcel reminders and returns. */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    if (controller.cron === DAILY_CRON) {
      ctx.waitUntil(runParcelDeadlines(env).then(() => runPartnerDeadlines(env)));
    }
    ctx.waitUntil(runPartnerEvents(env));
  },
} satisfies ExportedHandler<Env>;
