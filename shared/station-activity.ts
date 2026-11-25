// The station's day at a glance (UI batch 5, mockups B1 and B5): what happened today, by hour,
// and the latest operations. Built in the app from what the staff already read (swaps,
// charges, parcels); Lomé time is UTC, so "today" and the hours are UTC.

export type ActivityKind = "swap" | "charge" | "parcel_in" | "parcel_out";

export interface ActivityItem {
  id: string;
  kind: ActivityKind;
  at: string;
  /** "Spiro 72 V", the outlet's label or the parcel's number. */
  what: string | null;
  /** Customer's name, if known. */
  who: string | null;
  /** Amount taken, FCFA; null = nothing to pay here. */
  amountXof: number | null;
  /** How it was paid, e.g. "wallet"; free text, translated by the screen. */
  payment?: string | null;
}

/** "2026-11-04": the UTC day of an ISO time. */
export const dayOf = (iso: string) => iso.slice(0, 10);

/** Whether `iso` falls on the same (UTC) day as `now`. */
export function isToday(iso: string | null | undefined, now: Date): boolean {
  return !!iso && dayOf(iso) === now.toISOString().slice(0, 10);
}

export interface HourBucket {
  hour: number;
  n: number;
}

/**
 * Operations per hour of the day, from the first hour with any (at most `from`, 7 h by
 * default) to the current hour, so the chart covers the day so far without empty mornings.
 */
export function hourly(times: string[], now: Date, from = 7): HourBucket[] {
  const counts = new Map<number, number>();
  for (const t of times) {
    const h = new Date(t).getUTCHours();
    counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  const first = Math.min(from, ...counts.keys());
  const last = Math.max(now.getUTCHours(), ...counts.keys());
  const out: HourBucket[] = [];
  for (let h = first; h <= last; h++) out.push({ hour: h, n: counts.get(h) ?? 0 });
  return out;
}

/** The busiest hour (the earliest on a tie), or null on a day without operations. */
export function peak(buckets: HourBucket[]): HourBucket | null {
  let best: HourBucket | null = null;
  for (const b of buckets) if (b.n > 0 && (!best || b.n > best.n)) best = b;
  return best;
}

/** Newest first. */
export function latest(items: ActivityItem[], n: number): ActivityItem[] {
  return [...items].sort((a, b) => b.at.localeCompare(a.at)).slice(0, n);
}
