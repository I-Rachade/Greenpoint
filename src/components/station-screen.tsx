"use client";

import { useSearchParams } from "next/navigation";
import { distanceMeters } from "@shared/geo";
import { useLiveQuery } from "@/lib/hooks";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { LoadFailed, OfflineNotice } from "./load-state";
import { PageTitle } from "./page-title";
import { StationDetail } from "./station-detail";

/** Full station screen (/station?id=…): photos at the top, services, availability and reviews below. */
export function StationScreen() {
  const { t } = useI18n();
  const { backend } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const { position } = usePosition();
  const { data: stations, error, reload } = useLiveQuery(() => backend.listStations());
  const station = stations?.find((s) => s.id === id) ?? null;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl">
        {!station ? (
          <div className="px-4 pt-4">
            <PageTitle title={t.ui.detail.title} back={true} />
            {stations === null && error ? (
              <LoadFailed error={error} onRetry={reload} />
            ) : (
              <p className="text-sm text-gp-muted">{stations === null ? t.loading : t.ui.detail.notFound}</p>
            )}
          </div>
        ) : (
          <>
            {!!error && <OfflineNotice className="mx-4 mt-3" />}
            <StationDetail station={station} distance={position ? distanceMeters(position, station) : null} onChanged={reload} />
          </>
        )}
      </div>
    </div>
  );
}
