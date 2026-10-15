"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useMemo, useState } from "react";
import { DEFAULT_FILTER, isOpenNow, rankStations, stationAvailability, type StationFilter } from "@/lib/availability";
import { formatDistance } from "@/lib/geo";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { allBrands } from "@/lib/battery-types";
import { hasRestArea } from "@/lib/station-extras";
import { VEHICLE_TYPES, type StationView, type VehicleType } from "@/lib/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { BellIcon, ChevronIcon, FilterIcon, SearchIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { LoadFailed, OfflineNotice } from "./load-state";
import { StationCard, StationPhotoCard, stationHref } from "./station-card";
import { OpenBadge, RatingInline, StationPhoto } from "./station-look";

// MapLibre needs the browser (WebGL), so it is never rendered on the server.
const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

/** Folds accents and case so "lome" finds "Lomé". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/** Stations shown under "Recommended for you". */
const RECOMMENDED = 5;

/**
 * Open stations with something available, best first: good reviews, a rest area and
 * a short way count; an unrated station counts as 3.5 stars.
 */
function recommend(ranked: { station: StationView; distance: number | null }[]) {
  const score = ({ station, distance }: { station: StationView; distance: number | null }) =>
    (station.rating?.count ? station.rating.average : 3.5) + (hasRestArea(station.amenities) ? 0.4 : 0) - (distance ?? 0) / 4000;
  return ranked
    .filter(({ station }) => isOpenNow(station) && ["available", "limited"].includes(stationAvailability(station)))
    .sort((a, b) => score(b) - score(a))
    .slice(0, RECOMMENDED);
}

/** Home screen: greeting and search, the live map, recommended stations and the nearest ones. */
export function StationFinder() {
  const { t } = useI18n();
  const L = t.stationLook.home;
  const { backend, features, profile } = useApp();
  const { position, state } = usePosition();
  const { data: stations, error, reload } = useLiveQuery(() => backend.listStations());
  const [filter, setFilter] = useState<StationFilter>(DEFAULT_FILTER);
  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranked = useMemo(() => rankStations(stations ?? [], position, filter), [stations, position, filter]);
  const brands = useMemo(() => allBrands(stations ?? []), [stations]);
  const q = fold(query.trim());
  const shown = q ? ranked.filter(({ station }) => fold(`${station.name} ${station.address} ${station.operatorName}`).includes(q)) : ranked;
  const recommended = useMemo(() => recommend(shown), [shown]);
  const selected = shown.find((r) => r.station.id === selectedId) ?? null;
  const firstName = profile?.fullName?.trim().split(/\s+/)[0];
  const activeFilters =
    (filter.vehicle !== "all" ? 1 : 0) + (filter.service !== "all" ? 1 : 0) + (filter.brand && filter.brand !== "all" ? 1 : 0) + (filter.onlyAvailable ? 1 : 0);

  const selectClass = "rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-sm font-medium text-white [&>option]:text-gp-forest";

  return (
    <div className="min-h-0 flex-1 overflow-y-auto md:grid md:grid-cols-[minmax(360px,420px)_1fr] md:grid-rows-[auto_1fr] md:overflow-hidden">
      <header className="relative bg-gp-forest px-4 pb-5 pt-4 text-white md:col-start-1 md:row-start-1">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gp-green font-heading text-lg font-bold text-gp-forest">
            {firstName ? firstName[0].toUpperCase() : "⚡"}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-base font-semibold">{firstName ? format(L.hello, { name: firstName }) : L.helloGuest}</p>
            <p className="truncate text-sm text-white/75">{L.subtitle}</p>
          </div>
          {profile && (
            <Link href="/notifications" aria-label={t.ui.alerts.title} className="flex h-10 w-10 items-center justify-center rounded-full text-gp-yellow hover:bg-white/10">
              <BellIcon size={22} />
            </Link>
          )}
        </div>
        <div className="mt-4 flex gap-2">
          <label className="flex min-w-0 flex-1 items-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-gp-forest shadow-sm">
            <SearchIcon size={20} className="shrink-0 text-gp-muted" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.ui.stations.search}
              aria-label={t.ui.stations.search}
              className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-gp-muted"
            />
          </label>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            aria-expanded={showFilters}
            aria-label={L.filters}
            className="relative flex w-12 shrink-0 items-center justify-center rounded-2xl bg-gp-green text-gp-forest shadow-sm"
          >
            <FilterIcon size={22} strokeWidth={2.2} />
            {activeFilters > 0 && (
              <span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-gp-yellow px-1 text-center text-xs font-bold leading-5 text-gp-forest">
                {activeFilters}
              </span>
            )}
          </button>
        </div>
        {showFilters && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <select
              className={selectClass}
              value={filter.vehicle}
              onChange={(e) => setFilter({ ...filter, vehicle: e.target.value as VehicleType | "all" })}
              aria-label={t.vehicles.all}
            >
              <option value="all">{t.vehicles.all}</option>
              {VEHICLE_TYPES.map((v) => (
                <option key={v} value={v}>
                  {t.vehicles[v]}
                </option>
              ))}
            </select>
            <select
              className={selectClass}
              value={filter.service}
              onChange={(e) => setFilter({ ...filter, service: e.target.value as StationFilter["service"] })}
              aria-label={t.filter.service}
            >
              <option value="all">{t.filter.allServices}</option>
              <option value="charging">{t.filter.charging}</option>
              <option value="swap">{t.filter.swap}</option>
              {features.parcels && <option value="parcel">{t.filter.parcel}</option>}
              {features.evChargers && <option value="ev">🚗 {t.filter.ev}</option>}
            </select>
            {brands.length > 0 && (
              <select
                className={selectClass}
                value={filter.brand ?? "all"}
                onChange={(e) => setFilter({ ...filter, brand: e.target.value })}
                aria-label={t.filter.brand}
              >
                <option value="all">{t.filter.allBrands}</option>
                {brands.map((b) => (
                  <option key={b} value={b}>
                    🔋 {b}
                  </option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={filter.onlyAvailable}
                onChange={(e) => setFilter({ ...filter, onlyAvailable: e.target.checked })}
                className="accent-gp-green"
              />
              {t.filter.onlyAvailable}
            </label>
          </div>
        )}
      </header>

      <div className="relative mx-4 mt-4 h-56 overflow-hidden rounded-3xl border border-gp-border shadow-sm md:col-start-2 md:row-span-2 md:row-start-1 md:m-0 md:h-auto md:rounded-none md:border-0 md:shadow-none dark:border-white/10">
        <StationMap stations={shown.map((r) => r.station)} position={position} selectedId={selectedId} onSelect={setSelectedId} />
        {state === "denied" && !selected && (
          <p className="absolute bottom-2 left-2 right-2 rounded-lg bg-white/90 px-3 py-2 text-xs shadow dark:bg-zinc-900/90">{t.map.locationDenied}</p>
        )}
        {selected && (
          <div className="absolute inset-x-2 bottom-2 md:left-auto md:right-4 md:bottom-4 md:w-96">
            <Link
              href={stationHref(selected.station.id)}
              className="flex items-center gap-3 rounded-2xl bg-gp-surface p-2 pr-3 shadow-lg ring-1 ring-black/5 dark:ring-white/10"
            >
              <StationPhoto station={selected.station} className="h-16 w-20 shrink-0 rounded-xl" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-heading text-sm font-semibold">{selected.station.name}</span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                  <OpenBadge station={selected.station} />
                  {selected.distance !== null && <span className="font-medium">{formatDistance(selected.distance)}</span>}
                  <RatingInline station={selected.station} />
                </span>
              </span>
              <ChevronIcon size={20} className="shrink-0 text-gp-muted" />
            </Link>
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              aria-label={t.station.close}
              className="absolute -right-1 -top-3 flex h-7 w-7 items-center justify-center rounded-full bg-gp-forest text-lg leading-none text-white shadow"
            >
              ×
            </button>
          </div>
        )}
      </div>

      <div className="space-y-6 pb-6 pt-5 md:col-start-1 md:row-start-2 md:overflow-y-auto md:border-r md:border-gp-border md:dark:border-white/10">
        {recommended.length > 0 && (
          <section>
            <h2 className="px-4 font-heading text-lg font-semibold">{L.recommended}</h2>
            <div className="mt-2 flex snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {recommended.map(({ station, distance }) => (
                <StationPhotoCard key={station.id} station={station} distance={distance} />
              ))}
            </div>
          </section>
        )}

        <section className="px-4">
          <div className="flex items-baseline justify-between">
            <h2 className="font-heading text-lg font-semibold">{L.nearby}</h2>
            <Link href="/stations" className="text-sm font-semibold text-gp-green-dark hover:underline dark:text-gp-green">
              {L.viewAll}
            </Link>
          </div>
          {stations === null && error ? (
            <LoadFailed error={error} onRetry={reload} />
          ) : (
            <p className="mt-0.5 text-xs text-gp-muted">
              {stations === null ? t.loading : state === "locating" ? t.map.locating : format(t.map.stations, { count: shown.length })}
            </p>
          )}
          {stations !== null && !!error && <OfflineNotice className="mt-2" />}
          {stations !== null && shown.length === 0 && <p className="p-6 text-center text-sm text-gp-muted">{t.map.noResults}</p>}
          <ul className="mt-2 space-y-3">
            {shown.map(({ station, distance }, index) => (
              <li key={station.id}>
                <StationCard station={station} distance={distance} nearest={index === 0 && !!position} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
