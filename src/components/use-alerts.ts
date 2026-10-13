"use client";

import { useMemo } from "react";
import { buildAlerts, type Alert } from "@/lib/alerts";
import { useLiveQuery, useNow } from "@/lib/hooks";
import { useReadAlerts } from "@/lib/prefs";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

/**
 * The signed-in customer's notifications (reservations, parcels, current offer) and
 * which are unread on this device. `alerts` is null while loading.
 */
export function useAlerts(): { alerts: Alert[] | null; unread: number; isRead: (id: string) => boolean; markAllRead: () => void } {
  const { t } = useI18n();
  const { backend, profile, features } = useApp();
  const now = useNow(60_000);
  const [readIds, markRead] = useReadAlerts();
  const { data } = useLiveQuery(async () => {
    if (!profile) return null;
    const [reservations, parcels, stations, promotion] = await Promise.all([
      backend.myReservations().catch(() => []),
      features.parcels ? backend.myParcels().catch(() => []) : [],
      backend.listStations().catch(() => []),
      backend.currentPromotion().catch(() => null),
    ]);
    return { reservations, parcels, stations, promotion };
  }, `${profile?.id ?? ""}:${features.parcels}`);

  const alerts = useMemo(() => {
    if (!data) return null;
    const stationNames = new Map(data.stations.map((s) => [s.id, s.name]));
    return buildAlerts({ ...data, stationNames }, t, now);
  }, [data, t, now]);

  const read = new Set(readIds);
  const unread = alerts?.filter((a) => !read.has(a.id)).length ?? 0;
  return {
    alerts: profile ? alerts : [],
    unread,
    isRead: (id) => read.has(id),
    markAllRead: () => alerts && markRead(alerts.map((a) => a.id)),
  };
}
