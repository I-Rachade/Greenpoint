import { cleanVitals } from "../shared/vitals";

/**
 * POST /api/vitals: speed measured on a phone (shared/vitals.ts), written as one log line
 * `{"vitals": …}` that Workers Observability can filter and chart. Sent with sendBeacon as
 * text/plain (no CORS preflight from the app); always answers 204.
 */
export async function receiveVitals(request: Request): Promise<Response> {
  const text = await request.text().catch(() => "");
  if (text.length <= 2000) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not a report
    }
    const report = cleanVitals(parsed);
    if (report) console.log(JSON.stringify({ vitals: { ...report, country: (request as { cf?: { country?: string } }).cf?.country ?? null } }));
  }
  return new Response(null, { status: 204 });
}
