// Phone storage for the staff app without network (src/lib/offline/): JSON in localStorage,
// read and written through try/catch (private mode or blocked storage: nothing is kept).

function store(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = store()?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** False when the phone refused to keep it (storage full or blocked). */
export function writeJson(key: string, value: unknown): boolean {
  const s = store();
  if (!s) return false;
  try {
    if (value === null || value === undefined) s.removeItem(key);
    else s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** True when the error is "no network" (fetch failed), not an answer of the server. */
export function isNetworkError(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  return !!e && e.code === "unknown" && e.message === "network";
}
