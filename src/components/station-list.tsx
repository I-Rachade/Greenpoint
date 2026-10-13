"use client";

import Link from "next/link";
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
import { PageTitle } from "./page-title";
import { StationCard } from "./station-card";

/** Folds accents and case so "lome" finds "Lomé". */
const fold = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type Chip = "all" | "available" | "charging" | "swap" | "parcel" | "favorites";

/** Station list screen: search, filter chips, nearest first. */
export function StationList({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { position, state } = usePosition();
  const favorites = useFavorites();
  const { data: stations } = useLiveQuery(() => backend.listStations());
  const [query, setQuery] = useState("");
  const [chip, setChip] = useState<Chip>("all");
  const [brand, setBrand] = useState("all");
  const brands = useMemo(() => allBrands(stations ?? []), [stations]);

  const filter: StationFilter = {
    ...DEFAULT_FILTER,
    service: chip === "charging" || chip === "swap" || chip === "parcel" ? chip : "all",
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

      <p className="mt-3 text-xs text-gp-muted">
        {stations === null ? t.loading : state === "locating" ? t.map.locating : format(t.map.stations, { count: shown.length })}
      </p>

      {stations !== null && shown.length === 0 &&
        (favoritesOnly ? (
          <div className="mt-10 flex flex-col items-center gap-3 text-center">
            <span className="flex h-20 w-20 items-center justify-center rounded-full bg-gp-green/15 text-gp-green-dark">
              <HeartIcon size={36} />
            </span>
            <p className="font-semibold">{t.ui.favorites.empty}</p>
            <p className="max-w-xs text-sm text-gp-muted">{t.ui.favorites.emptyHint}</p>
            <Link href="/stations" className="mt-2 rounded-full bg-gp-green-dark px-5 py-2.5 text-sm font-semibold text-white">
              {t.ui.favorites.browse}
            </Link>
          </div>
        ) : (
          <p className="mt-8 text-center text-sm text-gp-muted">{t.map.noResults}</p>
        ))}

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
