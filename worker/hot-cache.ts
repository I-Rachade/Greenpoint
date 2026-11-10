/**
 * Short-lived copy of data everyone reads often, in Cloudflare's cache of the data centre
 * that answers (Cache API: the Workers stand-in for Redis). The station list is asked for every
 * 15 s by every open app and costs five queries: a copy of HOT_TTL_S seconds spares most of them.
 * Every change sent to the API (POST, PATCH, DELETE) drops the copy in the data centre it went
 * through, so the person who acted sees it at once; elsewhere the copy is at most HOT_TTL_S old.
 */
export const HOT_TTL_S = 10;

const key = (name: string) => new Request(`https://hot-cache.internal/${name}`);

function cache(): Cache | null {
  return typeof caches === "undefined" ? null : (caches as unknown as { default: Cache }).default;
}

/** The copy of `name` when one is fresh, otherwise `load()` stored as the new copy. */
export async function hot<T>(name: string, load: () => Promise<T>): Promise<T> {
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
  await cache()?.delete(key("stations")).catch(() => false);
}
