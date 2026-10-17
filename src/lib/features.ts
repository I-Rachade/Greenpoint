/** Modules an admin can switch off in the backoffice (worker/features.ts). */
export interface Features {
  /** Parcel depot, partner API and driver pickups. */
  parcels: boolean;
  /** Courses, express door to door, pickups and deliveries at home: everything a driver does. */
  drivers: boolean;
  /** Cashplus wallet; false only while Lite is on (the wallet's own switch lives in /admin/wallet). */
  wallet: boolean;
  /** Electric car chargers at the stations; false only while Lite is on. */
  evChargers: boolean;
  /**
   * Lite version: map, stations, reservations and the account only. Hides parcels,
   * courses, Cashplus and electric car chargers whatever their own switches say,
   * and turning it off brings back exactly what was on before.
   */
  lite: boolean;
}

/** Hidden until known, so a switched-off module never flashes up. */
export const UNKNOWN_FEATURES: Features = { parcels: false, drivers: false, wallet: false, evChargers: false, lite: false };

/** What the app shows, given the stored switches and the Lite preset. */
export function effectiveFeatures(stored: { parcels: boolean; drivers: boolean; lite: boolean }): Features {
  const full = !stored.lite;
  return { parcels: stored.parcels && full, drivers: stored.drivers && full, wallet: full, evChargers: full, lite: stored.lite };
}

export function sameFeatures(a: Features, b: Features): boolean {
  return a.parcels === b.parcels && a.drivers === b.drivers && a.wallet === b.wallet && a.evChargers === b.evChargers && a.lite === b.lite;
}
