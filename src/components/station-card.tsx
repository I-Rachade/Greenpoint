"use client";

import Link from "next/link";
import { availableBatteries, availableSlots, offersCharging, offersSwap, stationAvailability } from "@/lib/availability";
import { formatDistance } from "@/lib/geo";
import { format } from "@/lib/i18n/format";
import { useFavorites } from "@/lib/prefs";
import { stationBrands } from "@/lib/battery-types";
import { offersParcels } from "@/lib/station-points";
import type { StationView } from "@/lib/types";
import { AvailabilityBadge } from "./availability-badge";
import { BatteryIcon, BoltIcon, BoxIcon, HeartIcon, PinIcon } from "./icons";
import { useI18n } from "./i18n-provider";

/** Link to the full station screen. */
export const stationHref = (id: string) => `/station?id=${encodeURIComponent(id)}`;

/** Heart button that adds or removes a station from the favourites on this device. */
export function FavoriteButton({ stationId, className = "" }: { stationId: string; className?: string }) {
  const { t } = useI18n();
  const favorites = useFavorites();
  const on = favorites.has(stationId);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        favorites.toggle(stationId);
      }}
      aria-pressed={on}
      aria-label={on ? t.ui.favorites.remove : t.ui.favorites.add}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
        on ? "text-gp-closed" : "text-gp-muted hover:text-gp-closed dark:text-zinc-400"
      } ${className}`}
    >
      <HeartIcon size={22} filled={on} />
    </button>
  );
}

/** One station in the list and favourites screens. */
export function StationCard({
  station,
  distance,
  nearest,
}: {
  station: StationView;
  distance: number | null;
  nearest?: boolean;
}) {
  const { t } = useI18n();
  const swap = offersSwap(station.kind);
  const charging = offersCharging(station.kind);
  return (
    <Link
      href={stationHref(station.id)}
      className="flex gap-3 rounded-2xl border border-gp-border bg-gp-surface p-3 shadow-sm transition-shadow hover:shadow-md dark:border-white/10"
    >
      <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gp-green/15 text-gp-green-dark dark:text-gp-green">
        {charging ? <BoltIcon size={28} /> : swap ? <BatteryIcon size={28} /> : <BoxIcon size={28} />}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-base font-semibold">{station.name}</h3>
              {nearest && (
                <span className="shrink-0 rounded-full bg-gp-info px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                  {t.map.nearest}
                </span>
              )}
            </div>
            <p className="flex items-center gap-1 truncate text-xs text-gp-muted dark:text-zinc-400">
              <PinIcon size={13} className="shrink-0" />
              <span className="truncate">{station.address}</span>
            </p>
          </div>
          <FavoriteButton stationId={station.id} className="-mr-1 -mt-1" />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <AvailabilityBadge value={stationAvailability(station)} />
          {swap && (
            <span className="flex items-center gap-1 text-gp-muted dark:text-zinc-400">
              <BatteryIcon size={14} />
              <b className="text-gp-forest dark:text-zinc-100">{availableBatteries(station)}</b>/{station.batteryCapacity}
              {stationBrands(station).length > 0 && <span className="truncate">· {stationBrands(station).join(", ")}</span>}
            </span>
          )}
          {charging && (
            <span className="flex items-center gap-1 text-gp-muted dark:text-zinc-400">
              <BoltIcon size={14} />
              <b className="text-gp-forest dark:text-zinc-100">{availableSlots(station)}</b>/{station.chargingSlots}
            </span>
          )}
          {offersParcels(station) && (
            <span className="flex items-center gap-1 text-gp-muted dark:text-zinc-400" title={t.filter.parcel}>
              <BoxIcon size={14} />
              {station.parcelPoint!.lockers > 0 ? format(t.station.lockers, { n: station.parcelPoint!.lockers }) : t.filter.parcel}
            </span>
          )}
          {distance !== null && <span className="ml-auto font-semibold text-gp-forest dark:text-zinc-100">{formatDistance(distance)}</span>}
        </div>
      </div>
    </Link>
  );
}
