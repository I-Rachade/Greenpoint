import { accessConfig, accessIdentity, type AccessSettings } from "./access";

/**
 * The back office on its own address (admin.poinderecharge.com, wrangler.admin.jsonc).
 *
 * Cloudflare Access stands in front: only the people its policy names get here at all.
 * This Worker checks Access's token once more on every request, then serves the web app's
 * pages and hands /api/* to the app Worker through a service binding. The API checks the
 * token a third time before it accepts an admin account (worker/auth.ts, ADMIN_ACCESS_REQUIRED).
 * Without the Access settings nothing is served: a missing setting never opens the door.
 */
export interface AdminEnv extends AccessSettings {
  ASSETS: Fetcher;
  /** The app Worker "pointderecharge-app" (service binding). */
  API: Fetcher;
}

const SECURITY_HEADERS: Record<string, string> = {
  "Cache-Control": "no-store",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow",
};

function plain(text: string, status: number): Response {
  return new Response(text, { status, headers: { "Content-Type": "text/plain; charset=utf-8", ...SECURITY_HEADERS } });
}

function withHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(key, value);
  return out;
}

const adminGateway = {
  async fetch(request: Request, env: AdminEnv): Promise<Response> {
    if (!accessConfig(env)) return plain("Back office not set up (ACCESS_TEAM_DOMAIN, ACCESS_AUD).", 503);
    if (!(await accessIdentity(env, request))) return plain("Access denied.", 403);

    const url = new URL(request.url);
    if (url.pathname === "/") return Response.redirect(new URL("/admin", url).toString(), 302);
    // The API runs in the app Worker; the request goes on unchanged, Access token included.
    if (url.pathname.startsWith("/api/")) return withHeaders(await env.API.fetch(request));
    return withHeaders(await env.ASSETS.fetch(request));
  },
} satisfies ExportedHandler<AdminEnv>;

export default adminGateway;
