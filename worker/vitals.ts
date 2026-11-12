import { cleanVitals } from "../shared/vitals";
import type { Env } from "./env";
import { nowIso } from "./http";

/** How long measures are kept (daily cron, pruneVitals). */
export const VITALS_DAYS = 30;

/**
 * POST /api/vitals: speed measured on a phone (shared/vitals.ts), kept in web_vitals (migration
 * 0072) and written as one log line `{"vitals": …}` for Workers Observability. Sent with sendBeacon
 * as text/plain (no CORS preflight from the app); always answers 204.
 */
export async function receiveVitals(request: Request, env: Env): Promise<Response> {
  const text = await request.text().catch(() => "");
  if (text.length <= 2000) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not a report
    }
    const report = cleanVitals(parsed);
    if (report) {
      const country = (request as { cf?: { country?: string } }).cf?.country ?? null;
      console.log(JSON.stringify({ vitals: { ...report, country } }));
      const m = report.metrics;
      await env.DB.prepare(
        "insert into web_vitals (at, page, platform, net, memory, version, country, ttfb, fcp, lcp, cls, inp) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(nowIso(), report.page, report.platform, report.net, report.memory, report.version, country, m.TTFB ?? null, m.FCP ?? null, m.LCP ?? null, m.CLS ?? null, m.INP ?? null)
        .run()
        .catch((err: Error) => console.error("vitals", err.message));
    }
  }
  return new Response(null, { status: 204 });
}

/** Daily: forgets measures older than VITALS_DAYS. */
export async function pruneVitals(db: D1Database): Promise<void> {
  await db.prepare("delete from web_vitals where at < ?").bind(new Date(Date.now() - VITALS_DAYS * 86_400_000).toISOString()).run();
}
