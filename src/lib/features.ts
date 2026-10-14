/** Modules an admin can switch off in the backoffice (worker/features.ts). */
export interface Features {
  /** Parcel depot, partner API and driver pickups. */
  parcels: boolean;
  /** Courses, express door to door, pickups and deliveries at home: everything a driver does. */
  drivers: boolean;
}
