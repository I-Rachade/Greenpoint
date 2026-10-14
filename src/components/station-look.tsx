"use client";

import { isOpenNow } from "@/lib/availability";
import { useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { type Amenity, stationPhotos } from "@/lib/station-extras";
import type { StationView } from "@/lib/types";
import {
  BenchIcon,
  CupIcon,
  DropIcon,
  FoodIcon,
  ParkingIcon,
  PhoneBoltIcon,
  StarIcon,
  StoreIcon,
  ToiletIcon,
  UmbrellaIcon,
  WifiIcon,
} from "./icons";
import { useI18n } from "./i18n-provider";

// Pieces shared by the station cards and the station screen: photos, stars, amenities.

export const AMENITY_ICONS: Record<Amenity, typeof StarIcon> = {
  seating: BenchIcon,
  shade: UmbrellaIcon,
  toilets: ToiletIcon,
  water: DropIcon,
  food: FoodIcon,
  drinks: CupIcon,
  wifi: WifiIcon,
  phone_charging: PhoneBoltIcon,
  shop: StoreIcon,
  parking: ParkingIcon,
};

/** "00:00-24:00" and other all-day hours read as "24h/24". */
export function useHoursLabel() {
  const { t } = useI18n();
  return (hours: string) => {
    const h = (hours ?? "").trim();
    if (!h) return "–";
    if (/^0?0:00\s*[-–]\s*(24:00|0?0:00|23:59)$/.test(h) || /^24\s*h/i.test(h)) return t.stationLook.allDay;
    return h.replace(/\s*[-–]\s*/, " – ");
  };
}

/** Cover photo of a station, or its illustration while it has none. */
export function StationPhoto({
  station,
  index = 0,
  className = "",
  sizes,
}: {
  station: Pick<StationView, "id" | "kind" | "photos" | "name">;
  index?: number;
  className?: string;
  sizes?: string;
}) {
  const photos = stationPhotos(station);
  const src = photos[Math.min(index, photos.length - 1)];
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" loading="lazy" decoding="async" sizes={sizes} className={`object-cover ${className}`} />
  );
}

/** Green "Open" or red "Closed" label, following staff and opening hours. */
export function OpenBadge({ station, className = "" }: { station: StationView; className?: string }) {
  const { t } = useI18n();
  const now = useNow();
  const open = isOpenNow(station, now);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        open ? "bg-gp-green text-gp-forest" : "bg-gp-closed text-white"
      } ${className}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${open ? "bg-gp-forest" : "bg-white"}`} aria-hidden />
      {open ? t.stationLook.open : t.stationLook.closed}
    </span>
  );
}

/** "★ 4.5 (12)"; nothing while the station has no review. */
export function RatingInline({ station, className = "" }: { station: StationView; className?: string }) {
  const { t } = useI18n();
  const rating = station.rating;
  if (!rating || rating.count === 0) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={format(t.stationLook.reviews.count, { n: rating.count })}>
      <StarIcon size={15} filled className="text-gp-yellow" />
      <b className="font-semibold">{rating.average.toFixed(1)}</b>
      <span className="text-gp-muted dark:text-zinc-400">({rating.count})</span>
    </span>
  );
}

/** Five stars filled up to `value` (halves rounded). */
export function Stars({ value, size = 16, className = "" }: { value: number; size?: number; className?: string }) {
  const { t } = useI18n();
  const full = Math.round(value);
  return (
    <span className={`inline-flex items-center gap-0.5 text-gp-yellow ${className}`} role="img" aria-label={format(t.stationLook.reviews.stars, { n: value.toFixed(1) })}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon key={n} size={size} filled={n <= full} className={n <= full ? "" : "text-zinc-300 dark:text-zinc-600"} />
      ))}
    </span>
  );
}

/** Five large star buttons to pick a rating. */
export function StarInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label={t.stationLook.reviews.rate}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={value === n}
          aria-label={format(t.stationLook.reviews.chooseStars, { n })}
          onClick={() => onChange(n)}
          className={`rounded-full p-1 transition-transform active:scale-90 ${n <= value ? "text-gp-yellow" : "text-zinc-300 dark:text-zinc-600"}`}
        >
          <StarIcon size={32} filled={n <= value} />
        </button>
      ))}
    </div>
  );
}
