"use client";

import { useMemo, useState } from "react";
import { DEFAULT_FILTER, rankStations, type StationFilter } from "@/lib/availability";
import { allBrands } from "@/lib/battery-types";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { useFavorites } from "@/lib/prefs";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { HeartIcon, SearchIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { LoadFailed, OfflineNotice } from "./load-state";
import { PageTitle } from "./page-title";
import { StationCard } from "./station-card";
import { Button, EmptyState, SkeletonCard } from "./ui";

/** Folds accents and case so "lome" finds "Lomé". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type Chip = "all" | "available" | "charging" | "swap" | "parcel" | "ev" | "favorites";

/** Station list screen: search, filter chips, nearest first. */
export function StationList({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { position, state } = usePosition();
  const favorites = useFavorites();
  const { data: stations, error, reload } = useLiveQuery(() => backend.listStations());
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [brand, setBrand] = useState("all");
  const brands = useMemo(() => allBrands(stations ?? []), [stations]);

  const filter: StationFilter = {
    ...DEFAULT_FILTER,
    service: chip === "charging" || chip === "swap" || chip === "parcel" || chip === "ev" ? chip : "all",
    onlyAvailable: chip === "available",
    brand,
  };
  const ranked = useMemo(() => rankStations(stations ?? [], position, filter), [stations, position, filter.service, filter.onlyAvailable, filter.brand]); // eslint-disable-line react-hooks/exhaustive-deps
  const q = fold(query.trim());
  const shown = ranked.filter(
    ({ station }) =>
      (!q || fold(`${station.name} ${station.address} ${station.operatorName}`).includes(q)) &&
      (!(favoritesOnly || chip === "favorites") || favorites.has(station.id)),
  );

  const chips: { id: Chip; label: string }[] = [
    { id: "all", label: t.ui.stations.all },
    { id: "available", label: t.ui.stations.available },
    { id: "charging", label: t.filter.charging },
    { id: "swap", label: t.filter.swap },
    ...(features.parcels ? [{ id: "parcel" as const, label: t.filter.parcel }] : []),
    ...(features.evChargers ? [{ id: "ev" as const, label: t.filter.ev }] : []),
    { id: "favorites", label: t.ui.stations.favorites },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl flex-1 overflow-y-auto px-4 pb-6 pt-4">
      <PageTitle title={favoritesOnly ? t.ui.favorites.title : t.ui.stations.title} />

      <label className="flex items-center gap-2 rounded-full border border-gp-border bg-gp-surface px-4 py-2.5 shadow-sm focus-within:border-gp-green-dark dark:border-white/15">
        <SearchIcon size={20} className="text-gp-muted" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.ui.stations.search}
          aria-label={t.ui.stations.search}
          className="min-w-0 flex-1 bg-transparent text-base outline-none"
        />
      </label>

      {!favoritesOnly && (
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {chips.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setChip(c.id)}
              aria-pressed={chip === c.id}
              className={`whitespace-nowrap rounded-full border px-4 py-1.5 text-sm font-medium ${
                chip === c.id
                  ? "border-gp-green-dark bg-gp-green-dark text-white"
                  : "border-gp-border bg-gp-surface text-gp-forest dark:border-white/15 dark:text-zinc-200"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      {!favoritesOnly && brands.length > 0 && (
        <select
          value={brand}
          onChange={(e) => setBrand(e.target.value)}
          aria-label={t.filter.brand}
          className="mt-2 rounded-full border border-gp-border bg-gp-surface px-4 py-1.5 text-sm dark:border-white/15"
        >
          <option value="all">{t.filter.allBrands}</option>
          {brands.map((b) => (
            <option key={b} value={b}>
              🔋 {b}
            </option>
          ))}
        </select>
      )}

      {stations === null && error ? (
        <LoadFailed error={error} onRetry={reload} className="mt-6" />
      ) : (
        <p className="mt-3 text-xs text-gp-muted">
          {stations === null ? <span className="sr-only">{t.loading}</span> : state === "locating" ? t.map.locating : format(t.map.stations, { count: shown.length })}
        </p>
      )}
      {stations !== null && !!error && <OfflineNotice className="mt-2" />}

      {stations !== null && shown.length === 0 &&
        (favoritesOnly ? (
          <EmptyState
            icon={<HeartIcon size={36} />}
            title={t.ui.favorites.empty}
            text={t.ui.favorites.emptyHint}
            action={<Button href="/stations">{t.ui.favorites.browse}</Button>}
          />
        ) : (
          <p className="mt-8 text-center text-sm text-gp-muted">{t.map.noResults}</p>
        ))}

      {stations === null && !error && (
        <div className="mt-2 space-y-3">
          {Array.from({ length: 4 }, (_, i) => (
            <SkeletonCard key={i} className="h-36 rounded-3xl" />
          ))}
        </div>
      )}

      <ul className="mt-2 space-y-3">
        {shown.map(({ station, distance }) => (
          <li key={station.id}>
            <StationCard station={station} distance={distance} nearest={!!position && ranked[0]?.station.id === station.id} />
          </li>
        ))}
      </ul>

      {favoritesOnly && shown.length > 0 && <p className="mt-4 text-center text-xs text-gp-muted">{t.ui.favorites.deviceOnly}</p>}
    </div>
  );
}
