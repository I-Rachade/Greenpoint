/**
 * Speed measured on people's phones (Core Web Vitals), sent by the app once per page view to
 * POST /api/vitals and written to the Worker logs (Workers Observability), where they can be
 * read per page, per connection and per platform. Nothing about the person is sent.
 */
export const VITAL_NAMES = ["TTFB", "FCP", "LCP", "CLS", "INP"] as const;
export type VitalName = (typeof VITAL_NAMES)[number];

export interface VitalsReport {
  /** Page path without query (e.g. "/station"). */
  page: string;
  /** "android" | "ios" (the app) or "web". */
  platform: "android" | "ios" | "web";
  /** navigator.connection.effectiveType where the browser tells it ("2g", "3g", "4g"). */
  net: string | null;
  /** navigator.deviceMemory in GB where the browser tells it (a slow phone has 1 or 2). */
  memory: number | null;
  /** App version (package.json). */
  version: string | null;
  /** Milliseconds, CLS without unit. */
  metrics: Partial<Record<VitalName, number>>;
}

const clip = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : null);

/** The report as sent, checked and trimmed; null when it is not one. */
export function cleanVitals(input: unknown): VitalsReport | null {
  if (!input || typeof input !== "object") return null;
  const r = input as Record<string, unknown>;
  const page = clip(r.page, 80);
  if (!page || !page.startsWith("/")) return null;
  const metrics: Partial<Record<VitalName, number>> = {};
  const raw = (r.metrics ?? {}) as Record<string, unknown>;
  for (const name of VITAL_NAMES) {
    const v = raw[name];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v < 600_000) metrics[name] = Math.round(v * 1000) / 1000;
  }
  if (!Object.keys(metrics).length) return null;
  const platform = r.platform === "android" || r.platform === "ios" ? r.platform : "web";
  const memory = typeof r.memory === "number" && r.memory > 0 && r.memory <= 64 ? r.memory : null;
  return { page: page.split("?")[0], platform, net: clip(r.net, 8), memory, version: clip(r.version, 20), metrics };
}
