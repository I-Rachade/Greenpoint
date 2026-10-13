"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { distanceMeters } from "@/lib/geo";
import { useLiveQuery } from "@/lib/hooks";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { PageTitle } from "./page-title";
import { StationDetail } from "./station-detail";

const StationMap = dynamic(() => import("./station-map").then((m) => m.StationMap), { ssr: false });

/** Full station screen (/station?id=…): map at the top, details below. */
export function StationScreen() {
  const { t } = useI18n();
  const { backend } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const { position } = usePosition();
  const { data: stations, reload } = useLiveQuery(() => backend.listStations());
  const station = stations?.find((s) => s.id === id) ?? null;
  const single = useMemo(() => (station ? [station] : []), [station]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl">
        <div className="px-4 pt-4">
          <PageTitle title={station?.name ?? t.ui.detail.title} back={true} />
        </div>
        {stations === null ? (
          <p className="p-4 text-sm text-gp-muted">{t.loading}</p>
        ) : !station ? (
          <p className="p-4 text-sm text-gp-muted">{t.ui.detail.notFound}</p>
        ) : (
          <>
            <div className="mx-4 h-48 overflow-hidden rounded-2xl border border-gp-border dark:border-white/10">
              <StationMap stations={single} position={position} selectedId={station.id} onSelect={() => {}} />
            </div>
            <StationDetail
              station={station}
              distance={position ? distanceMeters(position, station) : null}
              onChanged={reload}
            />
          </>
        )}
      </div>
    </div>
  );
}
