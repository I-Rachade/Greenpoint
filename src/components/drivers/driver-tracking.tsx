"use client";

import dynamic from "next/dynamic";
import { freshPosition, type DeliveryJob } from "@shared/drivers";
import { distanceMeters, formatDistance, type LatLng } from "@shared/geo";
import { useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { StationView } from "@shared/types";
import { useI18n } from "../i18n-provider";
import { useClock } from "../merchants/shared";
import type { TrackPoint } from "./track-map";

const TrackMap = dynamic(() => import("./track-map").then((m) => m.TrackMap), {
  ssr: false,
});

/** Where the driver of a trip heads now: the start, the destination, or back. */
export function nextStop(
  job: DeliveryJob,
  stations: StationView[],
): LatLng | null {
  const station = (id: string | null) => {
    const s = stations.find((x) => x.id === id);
    return s ? { lat: s.lat, lng: s.lng } : null;
  };
  if (job.status === "accepted")
    return job.kind === "express" || job.kind === "delivery"
      ? station(job.fromStationId)
      : job.home;
  if (job.status === "returning")
    return job.kind === "courier" ? job.home : station(job.fromStationId);
  if (job.kind === "ride" || job.kind === "courier") return job.dropoff;
  if (job.kind === "delivery") return job.home;
  return station(job.toStationId);
}

/**
 * Driver phase 2: the driver of a running trip on a small map, with how far they are from
 * where they head next. Shown only while the server sends a fresh position.
 */
export function DriverTracking({
  job,
  stations,
}: {
  job: DeliveryJob;
  stations: StationView[];
}) {
  const { t } = useI18n();
  const clock = useClock();
  const now = useNow(30_000);
  const position = freshPosition(job.driver?.position, now.getTime());
  if (!job.driver || !position) return null;
  const stop = nextStop(job, stations);
  const points: TrackPoint[] = [
    {
      id: "driver",
      kind: "driver",
      lat: position.lat,
      lng: position.lng,
      label: job.driver.name,
    },
  ];
  if (stop)
    points.push({
      id: "stop",
      kind: job.status === "accepted" ? "start" : "end",
      ...stop,
    });
  return (
    <div className="space-y-1">
      <TrackMap points={points} className="h-48" />
      <p className="text-xs text-gp-muted">
        {stop
          ? format(t.drivers.tracking.away, {
              name: job.driver.name,
              distance: formatDistance(distanceMeters(position, stop)),
              time: clock(position.at),
            })
          : format(t.drivers.tracking.seen, {
              name: job.driver.name,
              time: clock(position.at),
            })}
      </p>
    </div>
  );
}
