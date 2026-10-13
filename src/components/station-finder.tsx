"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import {
  DEFAULT_FILTER,
  availableBatteries,
  availableSlots,
  offersCharging,
  offersSwap,
  rankStations,
  stationAvailability,
  type StationFilter,
} from "@/lib/availability";
import { formatDistance } from "@/lib/geo";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { offersParcels } from "@/lib/station-points";
import { VEHICLE_TYPES, type VehicleType } from "@/lib/types";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { AvailabilityBadge } from "./availability-badge";
import { useI18n } from "./i18n-provider";
import { StationDetail } from "./station-detail";

// MapLibre needs the browser (WebGL), so it is never rendered on the server.
const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

export function StationFinder() {
  const { t } = useI18n();
  const { backend, features } = useApp();
  const { position, state } = usePosition();
  const { data: stations, reload } = useLiveQuery(() => backend.listStations());
  const [filter, setFilter] = useState<StationFilter>(DEFAULT_FILTER);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const ranked = useMemo(() => rankStations(stations ?? [], position, filter), [stations, position, filter]);
  const selected = ranked.find((r) => r.station.id === selectedId) ?? null;

  const selectClass =
    "rounded-full border border-gp-border bg-gp-surface px-3 py-1.5 text-sm font-medium dark:border-white/15";

  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <div className="relative h-[45vh] shrink-0 md:order-2 md:h-auto md:flex-1">
        <StationMap
          stations={ranked.map((r) => r.station)}
          position={position}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        {state === "denied" && (
          <p className="absolute bottom-2 left-2 right-2 rounded-lg bg-white/90 px-3 py-2 text-xs shadow dark:bg-zinc-900/90">
            {t.map.locationDenied}
          </p>
        )}
      </div>

      <aside className="flex min-h-0 flex-1 flex-col border-black/10 md:order-1 md:max-w-sm md:flex-none md:basis-96 md:border-r dark:border-white/10">
        {selected ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <StationDetail
              station={selected.station}
              distance={selected.distance}
              onClose={() => setSelectedId(null)}
              onChanged={reload}
            />
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 border-b border-black/10 p-3 dark:border-white/10">
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
              </select>
              <label className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={filter.onlyAvailable}
                  onChange={(e) => setFilter({ ...filter, onlyAvailable: e.target.checked })}
                  className="accent-gp-green-dark"
                />
                {t.filter.onlyAvailable}
              </label>
            </div>

            <div className="px-3 pt-2 text-xs text-zinc-500">
              {stations === null
                ? t.loading
                : state === "locating"
                  ? t.map.locating
                  : format(t.map.stations, { count: ranked.length })}
            </div>

            <ul className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
              {stations !== null && ranked.length === 0 && (
                <li className="p-4 text-center text-sm text-zinc-500">{t.map.noResults}</li>
              )}
              {ranked.map(({ station, distance }, index) => (
                <li key={station.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(station.id)}
                    className="flex w-full items-start gap-3 rounded-2xl border border-gp-border bg-gp-surface p-3 text-left shadow-sm hover:shadow-md dark:border-white/10"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-medium">{station.name}</span>
                        {index === 0 && position && (
                          <span className="rounded-full bg-gp-info px-2 py-0.5 text-[10px] font-semibold uppercase text-white">
                            {t.map.nearest}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                        <AvailabilityBadge value={stationAvailability(station)} />
                        {offersSwap(station.kind) && (
                          <span>
                            🔋 {availableBatteries(station)} {t.station.fullBatteries.toLowerCase()}
                          </span>
                        )}
                        {offersCharging(station.kind) && (
                          <span>
                            ⚡ {availableSlots(station)} {t.station.freeSlots.toLowerCase()}
                          </span>
                        )}
                        {offersParcels(station) && <span>📦 {t.filter.parcel}</span>}
                      </div>
                    </div>
                    {distance !== null && (
                      <span className="whitespace-nowrap text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        {formatDistance(distance)}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </aside>
    </div>
  );
}
