"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { availableBatteries, availableSlots, DEFAULT_FILTER, isOpenNow, offersCharging, offersSwap, rankStations, stockBatteries } from "@shared/availability";
import { allBrands } from "@shared/battery-types";
import { directionsUrl, formatDistance, scooterMinutes } from "@shared/geo";
import type { StationView } from "@shared/types";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { useBrandPref } from "@/lib/prefs";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { BackIcon, BatteryIcon, BoltIcon, NavigateIcon, PinIcon, StarIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { LoadFailed } from "./load-state";
import { stationHref } from "./station-card";
import { StationPhoto, useTodayHoursLabel } from "./station-look";

// MapLibre needs the browser (WebGL), so it is never rendered on the server.
const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

/** Stations in the swipeable row and with a distance on their marker. */
const SHOWN = 12;

/** One station of the row: photo, name, stock, distance and time, a route button. */
function NearbyCard({ station, distance, selected, label }: { station: StationView; distance: number | null; selected: boolean; label: string }) {
  const { t } = useI18n();
  const today = useTodayHoursLabel();
  const swap = offersSwap(station.kind);
  const charging = offersCharging(station.kind);
  const chip = "inline-flex items-center gap-1 rounded-full bg-gp-green/15 px-2 py-0.5 text-xs font-semibold text-gp-green-dark dark:text-gp-green";
  return (
    <article
      data-id={station.id}
      aria-label={label}
      className={`w-[85%] max-w-sm shrink-0 snap-center rounded-[20px] bg-gp-surface p-3 shadow-lg transition-[border-color] duration-200 ${
        selected ? "border-2 border-gp-green" : "border-2 border-transparent"
      }`}
    >
      <Link href={stationHref(station.id)} className="flex gap-3">
        <StationPhoto station={station} className="h-20 w-20 shrink-0 rounded-[14px]" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-base font-semibold">{station.name}</span>
          <span className="mt-0.5 block truncate text-xs text-gp-muted dark:text-zinc-400">
            {t.kinds[station.kind]} · {today(station.openingHours)}
            {(station.rating?.count ?? 0) > 0 && (
              <>
                {" · "}
                <StarIcon size={12} filled className="inline align-[-1px] text-gp-yellow" /> <b className="text-gp-forest dark:text-zinc-100">{station.rating!.average.toFixed(1)}</b>
              </>
            )}
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {swap && (
              <span className={availableBatteries(station) > 0 ? chip : `${chip} !bg-red-100 !text-red-700`}>
                <BatteryIcon size={13} />
                {station.batteryCapacity > 0 ? `${stockBatteries(station)}/${station.batteryCapacity}` : stockBatteries(station)}
              </span>
            )}
            {charging && (
              <span className={availableSlots(station) > 0 ? chip : `${chip} !bg-red-100 !text-red-700`}>
                <BoltIcon size={13} />
                {station.chargingSlots > 0 ? `${availableSlots(station)}/${station.chargingSlots}` : availableSlots(station)}
              </span>
            )}
          </span>
        </span>
      </Link>
      <div className="mt-3 flex items-center gap-2 border-t border-gp-border pt-3 dark:border-white/10">
        <span className="min-w-0 flex-1">
          {distance !== null ? (
            <>
              <b className="font-heading text-lg">{formatDistance(distance)}</b>
              <span className="text-sm text-gp-muted"> · {format(t.stationLook.summary.minutes, { n: scooterMinutes(distance) })}</span>
            </>
          ) : (
            <span className="text-sm text-gp-muted">{station.address}</span>
          )}
        </span>
        <a
          href={directionsUrl(station)}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-11 shrink-0 items-center gap-2 rounded-[14px] bg-gp-green-dark px-4 text-sm font-semibold text-white hover:bg-gp-forest"
        >
          <NavigateIcon size={17} />
          {t.station.directions}
        </a>
      </div>
    </article>
  );
}

/**
 * /carte: the map over the whole screen (mockup A2). Quick filters at the top, the nearest
 * stations as cards to swipe at the bottom; the card in the middle is the selected station,
 * with its way from the user drawn on the map. A tap on a marker brings its card.
 */
export function NearbyMap() {
  const { t } = useI18n();
  const M = t.map.full;
  const router = useRouter();
  const { backend } = useApp();
  const { position } = usePosition();
  const { data: stations, error, reload } = useLiveQuery(() => backend.listStations());
  const [brandPref, setBrandPref] = useBrandPref();
  const [onlyFull, setOnlyFull] = useState(false);
  const [openNow, setOpenNow] = useState(false);
  const [brand, setBrand] = useState<string>(brandPref || "all");
  /** The chosen station, for the order it was chosen in: a new order starts again from the nearest. */
  const [chosen, setChosen] = useState<{ order: string; id: string } | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);

  const brands = useMemo(() => allBrands(stations ?? []), [stations]);
  const ranked = useMemo(() => {
    const filter = { ...DEFAULT_FILTER, brand, onlyAvailable: onlyFull, service: onlyFull ? ("swap" as const) : ("all" as const) };
    return rankStations(stations ?? [], position, filter)
      .filter(({ station }) => !openNow || isOpenNow(station))
      .slice(0, SHOWN);
  }, [stations, position, brand, onlyFull, openNow]);
  // When the order changes (filters, or the position arrives), start again from the nearest station.
  const order = ranked.map((r) => r.station.id).join("|");
  const selectedId = chosen?.order === order ? chosen.id : null;
  const setSelectedId = (id: string) => setChosen({ order, id });
  const current = ranked.find((r) => r.station.id === selectedId) ?? ranked[0] ?? null;
  const currentId = current?.station.id ?? null;
  const labels = useMemo(
    () => Object.fromEntries(ranked.filter((r) => r.distance !== null).map((r) => [r.station.id, formatDistance(r.distance!)])),
    [ranked],
  );

  /** The card in the middle of the row is the selected station. */
  function onRowScroll() {
    const row = rowRef.current;
    if (!row) return;
    const middle = row.scrollLeft + row.clientWidth / 2;
    let best: { id: string; gap: number } | null = null;
    for (const el of Array.from(row.children) as HTMLElement[]) {
      const gap = Math.abs(el.offsetLeft + el.offsetWidth / 2 - middle);
      const id = el.dataset.id;
      if (id && (!best || gap < best.gap)) best = { id, gap };
    }
    if (best && best.id !== currentId) setSelectedId(best.id);
  }

  // A tap on a marker brings its card to the middle.
  function selectFromMap(id: string) {
    setSelectedId(id);
    const el = rowRef.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"]`);
    el?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }

  useEffect(() => {
    rowRef.current?.scrollTo({ left: 0 });
  }, [order]);

  const chip = (on: boolean) =>
    `inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold shadow-md ${
      on ? "bg-gp-forest text-white" : "bg-gp-surface text-gp-forest dark:text-zinc-100"
    }`;

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden">
      <div className="absolute inset-0">
        <StationMap
          stations={ranked.map((r) => r.station)}
          position={position}
          selectedId={currentId}
          onSelect={selectFromMap}
          labels={labels}
          route
          controls={false}
          padding={{ top: 150, bottom: 250, left: 50, right: 50 }}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 top-0 space-y-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/"))}
            aria-label={t.ui.back}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gp-surface shadow-md"
          >
            <BackIcon size={20} />
          </button>
          <h1 className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-full bg-gp-surface px-4 font-heading text-base font-semibold shadow-md">
            <PinIcon size={18} className="shrink-0 text-gp-green-dark dark:text-gp-green" />
            <span className="truncate">{M.title}</span>
          </h1>
        </div>
        <div className="pointer-events-auto -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button type="button" aria-pressed={onlyFull} onClick={() => setOnlyFull(!onlyFull)} className={chip(onlyFull)}>
            <BatteryIcon size={16} />
            {M.fullBatteries}
          </button>
          <button type="button" aria-pressed={openNow} onClick={() => setOpenNow(!openNow)} className={chip(openNow)}>
            {M.openNow}
          </button>
          {brands.map((b) => (
            <button
              key={b}
              type="button"
              aria-pressed={brand === b}
              onClick={() => {
                const next = brand === b ? "all" : b;
                setBrand(next);
                setBrandPref(next);
              }}
              className={chip(brand === b)}
            >
              {b}
            </button>
          ))}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 pb-3">
        {stations === null && error ? (
          <div className="mx-3 rounded-2xl bg-gp-surface p-3 shadow-lg">
            <LoadFailed error={error} onRetry={reload} />
          </div>
        ) : stations !== null && ranked.length === 0 ? (
          <p className="mx-3 rounded-2xl bg-gp-surface p-4 text-center text-sm text-gp-muted shadow-lg">{t.map.noResults}</p>
        ) : (
          <>
            {position && current && <p className="mb-2 px-4 text-[11px] font-medium text-gp-forest/80 drop-shadow-sm dark:text-white/80">{M.straight}</p>}
            <div
              ref={rowRef}
              onScroll={onRowScroll}
              className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-[7.5%] pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            >
              {ranked.map(({ station, distance }, i) => (
                <NearbyCard
                  key={station.id}
                  station={station}
                  distance={distance}
                  selected={station.id === currentId}
                  label={format(M.card, { n: i + 1, total: ranked.length })}
                />
              ))}
            </div>
            {ranked.length > 1 && (
              <div className="flex justify-center gap-1.5" aria-hidden>
                {ranked.map(({ station }) => (
                  <span key={station.id} className={`h-1.5 rounded-full transition-all ${station.id === currentId ? "w-5 bg-gp-green-dark" : "w-1.5 bg-gp-forest/25 dark:bg-white/30"}`} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
