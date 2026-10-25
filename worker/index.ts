import { pruneIpRequests } from "./ip-limits";
import { handleApi } from "./api";
import { recountSilentFreeSlots } from "./devices";
import { runDispatch } from "./drivers";
import type { Env } from "./env";
import { parcelsEnabled } from "./features";
import { corsHeaders } from "./http";
import { handleOcppUpgrade, logOcppAttempt } from "./ocpp";
import { runParcelDeadlines } from "./parcels";
import { runPartnerDeadlines, runPartnerEvents } from "./partners";
import { runShareTimers } from "./share";
import { runCashAlerts } from "./station-cash";
import { ensureTutrackBridge } from "./tutrack-bridge";
import { handleXingkeCallback } from "./xingke";
import { CASH_DEADLINE_HOUR } from "../shared/station-cash";
import { shortLinkRedirect } from "../shared/charging";

// The Durable Object behind each OCPP charge point's WebSocket (wrangler.jsonc).
export { OcppConnection } from "./ocpp";
// The Durable Object that holds the Tutrack MQTT subscription of the Share trackers.
export { TutrackBridge } from "./tutrack-bridge";

/**
 * OCPP charge points connect here (worker/ocpp.ts): /api/devices/ocpp/<id>, or
 * /api/devices/ocpp/k/<key>/<id> for chargers that cannot send a password.
 */
const OCPP_PATH = /^\/api\/devices\/ocpp\/(?:k\/([^/]+)\/)?([^/]+)\/?$/;

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
    // A socket's short QR link (shared/charging.ts boxQrUrl): a temporary redirect, so where it
    // leads can change without new stickers.
    if (url.pathname.startsWith("/q/")) {
      const to = shortLinkRedirect(url.pathname.slice(3).replace(/\/$/, ""));
      if (to) return Response.redirect(new URL(to, url).toString(), 302);
    }
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    // A WebSocket for a charge point, not a browser call: no CORS.
    if (url.pathname.startsWith("/api/devices/ocpp")) {
      const ocpp = OCPP_PATH.exec(url.pathname);
      const response = ocpp ? await handleOcppUpgrade(request, env, ocpp[2], ocpp[1]) : new Response("Unknown charge point", { status: 404 });
      ctx.waitUntil(logOcppAttempt(env.DB, request, ocpp?.[2], response.status).catch((err) => console.error("ocpp log", err)));
      return response;
    }

    // The Xingke platform waits 3 seconds for our acknowledgement: card answers follow it.
    if (url.pathname === "/api/devices/xingke") return handleXingkeCallback(request, env, (work) => ctx.waitUntil(work));

    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const response = await handleApi(request, env);
    // Tell partners right away instead of waiting for the next minute (worker/partners.ts).
    if (request.method !== "GET" && PARCEL_CHANGE.test(url.pathname)) ctx.waitUntil(runPartnerEvents(env));
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  },
  /**
   * Crons in wrangler.jsonc: every minute partner webhooks and driver offers
   * (worker/drivers.ts), daily parcel reminders and returns. Nothing runs while
   * its module is switched off; parcels catch up once the module is back on.
   * The minute cron also takes silent sockets out of the free places.
   * The minute cron also runs out Share reservations and keeps the Tutrack bridge running.
   * At 10:00 the minute cron also tells the admins which stations did not close their cash.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(
      parcelsEnabled(env).then(async (on) => {
        if (!on) return;
        if (controller.cron === DAILY_CRON) await runParcelDeadlines(env).then(() => runPartnerDeadlines(env));
        await runPartnerEvents(env);
      }),
    );
    if (controller.cron === DAILY_CRON) ctx.waitUntil(pruneIpRequests(env.DB).catch((err) => console.error("ip limits", err)));
    if (controller.cron !== DAILY_CRON) ctx.waitUntil(runDispatch(env).catch((err) => console.error("dispatch", err)));
    if (controller.cron !== DAILY_CRON) ctx.waitUntil(runShareTimers(env).catch((err) => console.error("share timers", err)));
    if (controller.cron !== DAILY_CRON) ctx.waitUntil(ensureTutrackBridge(env).catch((err) => console.error("tutrack bridge", err)));
    if (controller.cron !== DAILY_CRON) ctx.waitUntil(recountSilentFreeSlots(env.DB).catch((err) => console.error("free slots", err)));
    const at = new Date(controller.scheduledTime);
    if (controller.cron !== DAILY_CRON && at.getUTCHours() === CASH_DEADLINE_HOUR && at.getUTCMinutes() === 0) {
      ctx.waitUntil(runCashAlerts(env, at).catch((err) => console.error("cash alerts", err)));
    }
  },
} satisfies ExportedHandler<Env>;
