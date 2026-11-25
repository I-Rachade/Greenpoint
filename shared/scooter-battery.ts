// The rider's own battery on the home "Mon scooter" (mockup A1): its charge comes from a
// Bluetooth reading in the app (shared/ble-oves.ts); the kilometres left are an estimate.

/** Under this charge the home advises a swap. */
export const LOW_BATTERY_PCT = 25;
/** Energy an electric scooter uses in town, Wh per km (about 2 kWh for 70 km). */
export const WH_PER_KM = 30;
/** Range on a full battery when the battery gives only its charge, km. */
export const FULL_RANGE_KM = 70;

export interface BatteryState {
  socPct: number;
  voltageMv: number | null;
  remainingMah: number | null;
}

/** Kilometres left: from the energy left when the battery gives it, else from the charge. */
export function kmLeft(b: BatteryState): number {
  if (b.remainingMah !== null && b.voltageMv !== null && b.remainingMah > 0 && b.voltageMv > 0) {
    return Math.max(0, Math.round((b.remainingMah * b.voltageMv) / 1e6 / WH_PER_KM));
  }
  return Math.max(0, Math.round((Math.min(100, Math.max(0, b.socPct)) / 100) * FULL_RANGE_KM));
}

export const isLow = (socPct: number) => socPct < LOW_BATTERY_PCT;

/** "today", "yesterday" or the number of days, by calendar day in Lomé (UTC). */
export function daysAgo(iso: string, now: Date = new Date()): number {
  const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return Math.max(0, Math.round((day(now) - day(new Date(iso))) / 86_400_000));
}
