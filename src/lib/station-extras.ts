// Photos, amenities and customer reviews of a station.
// Photos and amenities are set in the backoffice; reviews are left by signed-in customers.

/** What a station offers besides batteries: places to rest and everyday services. */
export type Amenity =
  | "seating"
  | "shade"
  | "toilets"
  | "water"
  | "food"
  | "drinks"
  | "wifi"
  | "phone_charging"
  | "shop"
  | "parking";

export const AMENITIES: Amenity[] = [
  "seating",
  "shade",
  "toilets",
  "water",
  "food",
  "drinks",
  "wifi",
  "phone_charging",
  "shop",
  "parking",
];

/** Amenities that make a station a place to rest while the battery charges. */
export const REST_AMENITIES: Amenity[] = ["seating", "shade", "toilets", "water", "food", "drinks"];

/**
 * What a station mainly is, set in the backoffice (migration 0044_station_main_activity.sql).
 * It picks the illustration shown while the station has no photo; null = automatic, from its services.
 * Some stations are first a restaurant or a shop that also charges or swaps.
 */
export type MainActivity = "charging" | "swap" | "ev" | "restaurant" | "shop";

export const MAIN_ACTIVITIES: MainActivity[] = ["charging", "swap", "ev", "restaurant", "shop"];

/** A known main activity, or null (automatic). */
export function cleanMainActivity(value: unknown): MainActivity | null {
  return typeof value === "string" && (MAIN_ACTIVITIES as string[]).includes(value) ? (value as MainActivity) : null;
}

/** Photos a station may have; the first one is the cover. */
export const MAX_STATION_PHOTOS = 6;
export const MAX_REVIEW_COMMENT = 500;

/** Keeps known amenities, in the order of AMENITIES, without duplicates. */
export function cleanAmenities(list: unknown): Amenity[] {
  if (!Array.isArray(list)) return [];
  return AMENITIES.filter((a) => list.includes(a));
}

/** Keeps up to MAX_STATION_PHOTOS image URLs (https, a path on this site, or a data URL in the demo). */
export function cleanPhotos(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const ok = list.filter(
    (u): u is string =>
      typeof u === "string" && u.length <= 2_000_000 && (/^https:\/\//.test(u) || /^\/[\w./-]+$/.test(u) || /^http:\/\/(localhost|127\.0\.0\.1)[:/]/.test(u) || u.startsWith("data:image/")),
  );
  return [...new Set(ok)].slice(0, MAX_STATION_PHOTOS);
}

export function hasRestArea(amenities: readonly Amenity[] | undefined): boolean {
  return (amenities ?? []).some((a) => REST_AMENITIES.includes(a));
}

export interface StationRating {
  /** Average of the stars, 1 to 5 (0 when nobody rated yet). */
  average: number;
  count: number;
}

export interface StationReview {
  id: string;
  stationId: string;
  /** First name and initial of the author, or null when the account has no name. */
  authorName: string | null;
  /** 1 to 5 stars. */
  rating: number;
  comment: string;
  createdAt: string;
  /** The signed-in user wrote it (they may change or delete it). */
  isMine: boolean;
}

export interface ReviewInput {
  rating: number;
  comment: string;
}

/** The cleaned input, or null when the stars or the comment are not acceptable. */
export function cleanReview(input: ReviewInput): ReviewInput | null {
  const rating = Number(input?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return null;
  const comment = typeof input.comment === "string" ? input.comment.trim().replace(/\s+\n/g, "\n") : "";
  if (comment.length > MAX_REVIEW_COMMENT) return null;
  return { rating, comment };
}

/** "Kossi Mensah" → "Kossi M."; empty → null. */
export function shortName(fullName: string | null | undefined): string | null {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function ratingOf(reviews: readonly { rating: number }[]): StationRating {
  if (reviews.length === 0) return { average: 0, count: 0 };
  const sum = reviews.reduce((n, r) => n + r.rating, 0);
  return { average: Math.round((sum / reviews.length) * 10) / 10, count: reviews.length };
}

/** How many reviews gave 5, 4, 3, 2 and 1 stars (index 0 = 5 stars). */
export function starCounts(reviews: readonly { rating: number }[]): number[] {
  return [5, 4, 3, 2, 1].map((n) => reviews.filter((r) => r.rating === n).length);
}

/** The station fields that pick its pictures. */
type PictureFields = { kind: string; id: string; photos?: string[]; evChargers?: unknown[]; mainActivity?: MainActivity | null };

/**
 * Illustration shown when a station has no photo yet: its main activity when one is set,
 * else an electric car when it has a charger for one, else its main service.
 */
export function placeholderPhoto(station: PictureFields): string {
  const main = cleanMainActivity(station.mainActivity);
  if (main) return `/station-photos/${main}.svg`;
  if ((station.evChargers ?? []).length > 0) return "/station-photos/ev.svg";
  if (station.kind === "parcel") return "/station-photos/parcel.svg";
  if (station.kind === "swap") return "/station-photos/swap.svg";
  if (station.kind === "charging") return "/station-photos/charging.svg";
  return "/station-photos/hub.svg";
}

export function stationPhotos(station: PictureFields): string[] {
  return station.photos && station.photos.length > 0 ? station.photos : [placeholderPhoto(station)];
}
