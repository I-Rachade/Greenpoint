import { handleApi } from "./api";
import type { Env } from "./env";
import { corsHeaders } from "./http";
import { runParcelDeadlines } from "./parcels";

/**
 * The whole app on Cloudflare: /api/* is answered here (D1 database, R2 images,
 * SMS login), everything else is the static web app from `out/`.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    const cors = corsHeaders(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    const response = await handleApi(request, env);
    for (const [key, value] of Object.entries(cors)) response.headers.set(key, value);
    return response;
  },
  /** Daily job (cron in wrangler.jsonc): parcel reminders and returns. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(runParcelDeadlines(env));
  },
} satisfies ExportedHandler<Env>;
