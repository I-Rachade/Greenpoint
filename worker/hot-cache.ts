/**
 * Short-lived copy of data everyone reads often, in Cloudflare's cache of the data centre
 * that answers (Cache API: the Workers stand-in for Redis). The station list, the switched-on
 * modules and the current promotion are asked for every 15 s by every open app (and the modules
 * on many API calls): a copy of HOT_TTL_S seconds spares most of those queries.
 * Every change sent to the API (POST, PATCH, DELETE) drops the copy in the data centre it went
 * through, so the person who acted sees it at once; elsewhere the copy is at most HOT_TTL_S old.
 */
export const HOT_TTL_S = 10;

/** Everything kept here; a change drops them all. */
export type HotName = "stations" | "features" | "promotion";
const NAMES: HotName[] = ["stations", "features", "promotion"];

const key = (name: string) => new Request(`https://hot-cache.internal/${name}`);

function cache(): Cache | null {
  return typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
}

/** The copy of `name` when one is fresh, otherwise `load()` stored as the new copy. */
export async function hot<T>(name: HotName, load: () => Promise<T>): Promise<T> {
  const store = cache();
  if (!store) return load();
  const hit = await store.match(key(name)).catch(() => undefined);
  if (hit) return (await hit.json()) as T;
  const value = await load();
  const copy = new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", "Cache-Control": `max-age=${HOT_TTL_S}` },
  });
  await store.put(key(name), copy).catch(() => {});
  return value;
}

/** Drops the copies that a change may have made stale. */
export async function dropHot(): Promise<void> {
  const store = cache();
  if (store) await Promise.all(NAMES.map((n) => store.delete(key(n)).catch(() => false)));
}
