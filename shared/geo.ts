export interface LatLng {
  lat: number;
  lng: number;
}

/** Centre of Lomé, used when the user's position is unknown. */
export const LOME_CENTER: LatLng = { lat: 6.1319, lng: 1.2228 };

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in metres (haversine formula). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
}

/** Link that opens turn-by-turn navigation in Google Maps (app or web). */
export function directionsUrl(to: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${to.lat},${to.lng}`;
}

/** Roads are longer than the straight line between two points in town. */
const ROAD_FACTOR = 1.3;
/** Average speed of a motorbike in Lomé traffic, km/h. */
const SCOOTER_KMH = 22;

/**
 * Rough minutes by motorbike for a straight-line distance (station screen): no route is
 * fetched, so it adds a road factor to the haversine distance. At least 1 minute.
 */
export function scooterMinutes(meters: number): number {
  if (!Number.isFinite(meters) || meters <= 0) return 1;
  return Math.max(1, Math.round((meters * ROAD_FACTOR) / ((SCOOTER_KMH * 1000) / 60)));
}
