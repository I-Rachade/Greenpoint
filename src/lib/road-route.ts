/**
 * The way by road between two points (mockups A1, A2, A5), from an OSRM routing server.
 * NEXT_PUBLIC_ROUTING_URL picks the server; empty = the public OSRM demo server, which is
 * fine for a start but has no guarantee and allows about one request a second. "off" turns
 * the road route off: the map then draws a straight dashed line, as before.
 * The two points are sent to that server (see the privacy policy).
 */

export type LngLat = [number, number];

export interface RoadRoute {
  coordinates: LngLat[];
  /** Metres by road. */
  meters: number;
}

const DEFAULT_URL = "https://router.project-osrm.org";

export function routingUrl(): string | null {
  const url = (process.env.NEXT_PUBLIC_ROUTING_URL ?? "").trim().replace(/\/+$/, "");
  if (url === "off") return null;
  return url || DEFAULT_URL;
}

/** Rounded to about 50 m, so a moving rider does not ask for a new route every second. */
export function routeKey(from: { lat: number; lng: number }, to: { lat: number; lng: number }): string {
  const r = (x: number) => (Math.round(x * 2000) / 2000).toFixed(4);
  return `${r(from.lng)},${r(from.lat)};${r(to.lng)},${r(to.lat)}`;
}

const cache = new Map<string, RoadRoute | null>();

/** The route, or null when there is none or the server does not answer (the caller draws a straight line). */
export async function roadRoute(from: { lat: number; lng: number }, to: { lat: number; lng: number }, signal?: AbortSignal): Promise<RoadRoute | null> {
  const base = routingUrl();
  if (!base) return null;
  const key = routeKey(from, to);
  if (cache.has(key)) return cache.get(key) ?? null;
  // Manual timeout: AbortSignal.any() and .timeout() are missing on older phones.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 6000);
  const stop = () => ctrl.abort();
  signal?.addEventListener("abort", stop);
  try {
    const res = await fetch(`${base}/route/v1/driving/${key}?overview=full&geometries=geojson`, { signal: ctrl.signal });
    if (!res.ok) return null;
    const route = parseOsrm(await res.json());
    cache.set(key, route);
    return route;
  } catch {
    // Offline, timeout or aborted: no cache entry, the next position tries again.
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", stop);
  }
}

/** The first route of an OSRM answer, or null. */
export function parseOsrm(body: unknown): RoadRoute | null {
  const route = (body as { code?: string; routes?: { distance?: number; geometry?: { coordinates?: unknown } }[] } | null)?.routes?.[0];
  if ((body as { code?: string })?.code !== "Ok" || !route) return null;
  const coords = route.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length < 2) return null;
  const coordinates = coords.filter((c): c is LngLat => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1])).map((c) => [c[0], c[1]] as LngLat);
  if (coordinates.length < 2) return null;
  return { coordinates, meters: Number.isFinite(route.distance) ? Math.round(route.distance as number) : 0 };
}
