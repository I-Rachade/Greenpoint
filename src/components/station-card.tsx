"use client";

import Link from "next/link";
import { useState } from "react";
import { availableSlots, offersCharging, offersSwap, stockBatteries } from "@/lib/availability";
import { directionsUrl, formatDistance } from "@/lib/geo";
import { format } from "@/lib/i18n/format";
import { useFavorites } from "@/lib/prefs";
import { brandFullBatteries, stationBrands } from "@/lib/battery-types";
import { chargesEvs } from "@/lib/ev-chargers";
import { hasRestArea, isUnattended } from "@/lib/station-extras";
import { offersParcels } from "@/lib/station-points";
import type { StationView } from "@/lib/types";
import { BatteryIcon, BenchIcon, BoltIcon, BoxIcon, CarIcon, ClockIcon, HeartIcon, NavigateIcon, PinIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { SolarBadge } from "./solar-badge";
import { OpenBadge, RatingInline, StationPhoto, useTodayHoursLabel } from "./station-look";

/** Link to the full station screen. */
export const stationHref = (id: string) => `/station?id=${encodeURIComponent(id)}`;

/** Heart button that adds or removes a station from the favourites on this device. */
export function FavoriteButton({ stationId, className = "" }: { stationId: string; className?: string }) {
  const { t } = useI18n();
  const favorites = useFavorites();
  const on = favorites.has(stationId);
  // Bumped on every tap so the heart pops once (re-keyed to restart the animation).
  const [bump, setBump] = useState(0);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        favorites.toggle(stationId);
        setBump((n) => n + 1);
      }}
      aria-pressed={on}
      aria-label={on ? t.ui.favorites.remove : t.ui.favorites.add}
      className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors ${
        on ? "text-gp-closed" : "text-gp-muted hover:text-gp-closed dark:text-zinc-400"
      } ${className}`}
    >
      <span key={bump} className={bump ? "animate-gp-bump" : "inline-block"}>
        <HeartIcon size={22} filled={on} />
      </span>
    </button>
  );
}

/** Small "Rest area" label for stations with benches, shade, toilets, water or food. */
export function RestBadge({ station, className = "" }: { station: StationView; className?: string }) {
  const { t } = useI18n();
  if (!hasRestArea(station.amenities)) return null;
  return (
    <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gp-yellow px-2.5 py-0.5 text-xs font-semibold text-gp-forest ${className}`}>
      <BenchIcon size={13} strokeWidth={2.2} />
      {t.stationLook.restArea}
    </span>
  );
}

/** "Electric car" label for stations with at least one electric car charger. */
export function EvBadge({ station, className = "" }: { station: StationView; className?: string }) {
  const { t } = useI18n();
  if (!chargesEvs(station)) return null;
  return (
    <span
      title={t.station.ev.yes}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gp-info px-2.5 py-0.5 text-xs font-semibold text-white ${className}`}
    >
      <CarIcon size={13} strokeWidth={2.2} />
      {t.station.ev.badge}
    </span>
  );
}

/** What is available right now: free charging places, full batteries, parcel point. */
export function StockLine({ station, className = "", withBrands = true }: { station: StationView; className?: string; withBrands?: boolean }) {
  const { t } = useI18n();
  const swap = offersSwap(station.kind);
  const charging = offersCharging(station.kind);
  const brands = swap && withBrands ? stationBrands(station) : [];
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-xs ${className}`}>
      {swap && (
        <span className="flex items-center gap-1">
          <BatteryIcon size={14} />
          <b>{stockBatteries(station)}</b>/{station.batteryCapacity}
          {brands.length > 0 && <span className="truncate opacity-80">· {brands.map((b) => `${b} ${brandFullBatteries(station, b)}`).join(", ")}</span>}
        </span>
      )}
      {charging && (
        <span className="flex items-center gap-1">
          <BoltIcon size={14} />
          <b>{availableSlots(station)}</b>/{station.chargingSlots}
        </span>
      )}
      {offersParcels(station) && (
        <span className="flex items-center gap-1" title={t.filter.parcel}>
          <BoxIcon size={14} />
          {station.parcelPoint!.lockers > 0 ? format(t.station.lockers, { n: station.parcelPoint!.lockers }) : t.filter.parcel}
        </span>
      )}
    </div>
  );
}

/** Opens the route in the maps app. */
function DirectionsButton({ station }: { station: StationView }) {
  const { t } = useI18n();
  return (
    <a
      href={directionsUrl(station)}
      target="_blank"
      rel="noopener noreferrer"
      className="relative z-10 ml-auto flex shrink-0 items-center gap-1.5 rounded-full bg-gp-green-dark px-3.5 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-gp-forest"
    >
      <NavigateIcon size={14} />
      {t.station.directions}
    </a>
  );
}

/**
 * One station in the lists: photo on the left, hours, distance, stars and the route button below.
 * The title link stretches over the whole card; the heart and route buttons sit beside it
 * (not inside it), so screen readers meet three separate controls.
 */
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
  const hours = useTodayHoursLabel();
  const unattended = isUnattended(station);
  return (
    <div
      className={`relative rounded-3xl border border-gp-border bg-gp-surface p-3 shadow-sm transition-shadow hover:shadow-md dark:border-white/10 ${
        unattended ? "opacity-60 grayscale" : ""
      }`}
    >
      <div className="flex gap-3">
        <div className="relative h-24 w-28 shrink-0 overflow-hidden rounded-2xl bg-gp-green/10 sm:w-32">
          <StationPhoto station={station} className="h-full w-full" />
          {chargesEvs(station) && (
            <span
              title={t.station.ev.yes}
              className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-gp-info text-white shadow"
            >
              <CarIcon size={16} strokeWidth={2.2} />
            </span>
          )}
          {nearest && (
            <span className="absolute left-1.5 top-1.5 rounded-full bg-gp-info px-2 py-0.5 text-[10px] font-semibold uppercase text-white shadow">
              {t.map.nearest}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h3 className="min-w-0 flex-1 truncate font-heading text-base font-semibold leading-tight">
              <Link href={stationHref(station.id)} className="after:absolute after:inset-0 after:rounded-3xl after:content-['']">
                {station.name}
              </Link>
            </h3>
            <FavoriteButton stationId={station.id} className="relative z-10 -mr-2 -mt-2" />
          </div>
          <p className="-mt-1 text-xs font-medium text-gp-green-dark dark:text-gp-green">{t.kinds[station.kind]}</p>
          <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-gp-muted dark:text-zinc-400">
            <PinIcon size={13} className="shrink-0" />
            <span className="truncate">{station.address}</span>
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <OpenBadge station={station} />
            <RestBadge station={station} />
            <EvBadge station={station} />
            {station.isSolar && <SolarBadge />}
            {unattended && (
              <span className="inline-flex items-center whitespace-nowrap rounded-full bg-zinc-500/15 px-2.5 py-0.5 text-xs font-semibold text-gp-muted dark:text-zinc-400">
                {t.stationLook.unattended}
              </span>
            )}
          </div>
          <StockLine station={station} className="mt-1.5 text-gp-forest dark:text-zinc-200" />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2.5 whitespace-nowrap border-t border-gp-border pt-2.5 text-xs text-gp-forest dark:border-white/10 dark:text-zinc-200">
        <span className="flex items-center gap-1">
          <ClockIcon size={14} className="text-gp-muted" />
          {hours(station.openingHours)}
        </span>
        {distance !== null && (
          <span className="flex items-center gap-1 border-l border-gp-border pl-2.5 dark:border-white/10">
            <PinIcon size={14} className="text-gp-muted" />
            {formatDistance(distance)}
          </span>
        )}
        {(station.rating?.count ?? 0) > 0 && (
          <span className="border-l border-gp-border pl-2.5 dark:border-white/10">
            <RatingInline station={station} />
          </span>
        )}
        <DirectionsButton station={station} />
      </div>
    </div>
  );
}

/** Large photo card for the "Recommended for you" row on the home screen. */
export function StationPhotoCard({ station, distance }: { station: StationView; distance: number | null }) {
  const { t } = useI18n();
  return (
    <Link
      href={stationHref(station.id)}
      className="group relative block h-48 w-72 shrink-0 snap-start overflow-hidden rounded-3xl bg-gp-forest shadow-md sm:w-80"
    >
      <StationPhoto station={station} className="absolute inset-0 h-full w-full transition-transform duration-500 group-hover:scale-105" />
      <div className="absolute inset-0 bg-gradient-to-t from-gp-forest via-gp-forest/60 via-45% to-transparent" aria-hidden />
      <div className="absolute left-3 right-3 top-3 flex items-center gap-1.5">
        <OpenBadge station={station} />
        <RestBadge station={station} />
        <EvBadge station={station} />
        {station.isSolar && <SolarBadge compact />}
        {(station.rating?.count ?? 0) > 0 && (
          <span className="ml-auto rounded-full bg-white/90 px-2 py-0.5 text-xs text-gp-forest shadow">
            <RatingInline station={station} />
          </span>
        )}
      </div>
      <div className="absolute inset-x-3 bottom-3 text-white">
        <h3 className="truncate font-heading text-lg font-semibold leading-tight drop-shadow">{station.name}</h3>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-white/90">
          <span>{t.kinds[station.kind]}</span>
          {distance !== null && (
            <>
              <span aria-hidden>·</span>
              <span>{formatDistance(distance)}</span>
            </>
          )}
        </div>
        <StockLine station={station} withBrands={false} className="mt-1 text-white" />
      </div>
    </Link>
  );
}
