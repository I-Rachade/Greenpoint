/**
 * Whether two answers hold the same data: plain objects, arrays and plain values compared
 * deeply; anything else (Map, Date, class) counts as changed.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => sameData(x, b[i]));
  }
  const plain = (o: object) => [Object.prototype, null].includes(Object.getPrototypeOf(o));
  if (!plain(a) || !plain(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameData((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}
