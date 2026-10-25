/** Modules an admin can switch off in the backoffice (worker/features.ts). */
export interface Features {
  /** Parcel depot, partner API and driver pickups. */
  parcels: boolean;
  /** Courses, express door to door, pickups and deliveries at home: everything a driver does. */
  drivers: boolean;
  /** Green Credit (0047); on in Lite too, as an energy credit. Its own switch lives in /admin/wallet. */
  wallet: boolean;
  /** Electric car chargers at the stations; false only while Lite is on. */
  evChargers: boolean;
  /** Share: e-motorbikes (later e-scooters and cars) to rent from station to station; off until an admin turns it on. */
  share: boolean;
  /**
   * Lite version: map, stations, reservations, Green Credit and the account only. Hides
   * parcels, courses, Share and electric car chargers whatever their own switches say,
   * and turning it off brings back exactly what was on before.
   */
  lite: boolean;
}

/** Hidden until known, so a switched-off module never flashes up. */
export const UNKNOWN_FEATURES: Features = { parcels: false, drivers: false, wallet: false, evChargers: false, share: false, lite: false };

/** What the app shows, given the stored switches and the Lite preset. */
export function effectiveFeatures(stored: { parcels: boolean; drivers: boolean; share?: boolean; lite: boolean }): Features {
  const full = !stored.lite;
  return { parcels: stored.parcels && full, drivers: stored.drivers && full, wallet: true, evChargers: full, share: !!stored.share && full, lite: stored.lite };
}

export function sameFeatures(a: Features, b: Features): boolean {
  return a.parcels === b.parcels && a.drivers === b.drivers && a.wallet === b.wallet && a.evChargers === b.evChargers && a.share === b.share && a.lite === b.lite;
}
