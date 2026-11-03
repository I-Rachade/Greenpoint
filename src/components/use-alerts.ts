"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import { buildAlerts, type Alert } from "@/lib/alerts";
import { isHolding } from "@shared/availability";
import type { Backend } from "@/lib/backend";
import { useNow } from "@/lib/hooks";
import { useReadAlerts } from "@/lib/prefs";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import type { Reservation } from "@shared/types";

type AlertData = {
  reservations: Awaited<ReturnType<Backend["myReservations"]>>;
  parcels: Awaited<ReturnType<Backend["myParcels"]>>;
  stations: Awaited<ReturnType<Backend["listStations"]>>;
  promotion: Awaited<ReturnType<Backend["currentPromotion"]>>;
};

/**
 * One shared load per backend and customer: the header, the tab bar and the account
 * page all read the same answer, so the data behind the alerts is polled once.
 */
interface Entry {
  data: AlertData | null;
  listeners: Set<() => void>;
  stop: (() => void) | null;
  request: number;
}
const entries = new WeakMap<Backend, Map<string, Entry>>();

function entryFor(backend: Backend, key: string): Entry {
  let byKey = entries.get(backend);
  if (!byKey) entries.set(backend, (byKey = new Map()));
  let entry = byKey.get(key);
  if (!entry) byKey.set(key, (entry = { data: null, listeners: new Set(), stop: null, request: 0 }));
  return entry;
}

async function loadAlertData(backend: Backend, parcels: boolean): Promise<AlertData> {
  const [reservations, parcelList, stations, promotion] = await Promise.all([
    backend.myReservations().catch(() => []),
    parcels ? backend.myParcels().catch(() => []) : [],
    backend.listStations().catch(() => []),
    backend.currentPromotion().catch(() => null),
  ]);
  return { reservations, parcels: parcelList, stations, promotion };
}

function useAlertData(): AlertData | null {
  const { backend, profile, features } = useApp();
  // Empty while signed out: nothing is loaded then.
  const key = profile ? `${profile.id}:${features.parcels}` : "";
  const parcels = features.parcels;

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!key) return () => {};
      const entry = entryFor(backend, key);
      entry.listeners.add(onChange);
      if (!entry.stop) {
        const load = () => {
          const request = ++entry.request;
          loadAlertData(backend, parcels).then((data) => {
            // Only the latest request may update: a slow older answer must not overwrite a newer one.
            if (request !== entry.request) return;
            entry.data = data;
            entry.listeners.forEach((fn) => fn());
          });
        };
        load();
        entry.stop = backend.subscribe(load);
      }
      return () => {
        entry.listeners.delete(onChange);
        if (entry.listeners.size === 0) {
          entry.stop?.();
          entry.stop = null;
        }
      };
    },
    [backend, key, parcels],
  );

  return useSyncExternalStore(
    subscribe,
    () => (key ? (entries.get(backend)?.get(key)?.data ?? null) : null),
    () => null,
  );
}

/**
 * The signed-in customer's notifications (reservations, parcels, current offer) and
 * which are unread on this device. `alerts` is null while loading.
 */
export function useAlerts(): { alerts: Alert[] | null; unread: number; isRead: (id: string) => boolean; markAllRead: () => void } {
  const { t } = useI18n();
  const { profile } = useApp();
  const now = useNow(60_000);
  const [readIds, markRead] = useReadAlerts();
  const data = useAlertData();

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

/**
 * The signed-in customer's active reservation that ends first (at `stationId` when given),
 * with its station's name, or null. Reads the same shared data as the alerts, so it adds no request.
 */
export function useActiveReservation(stationId?: string): { reservation: Reservation; stationName: string | null } | null {
  const data = useAlertData();
  const now = useNow(15_000);
  if (!data) return null;
  const active = data.reservations
    .filter((r) => isHolding(r, now) && (!stationId || r.stationId === stationId))
    .sort((a, b) => Date.parse(a.expiresAt) - Date.parse(b.expiresAt))[0];
  if (!active) return null;
  return { reservation: active, stationName: data.stations.find((s) => s.id === active.stationId)?.name ?? null };
}
