"use client";

import { isHolding } from "@/lib/availability";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Reservation, ReservationStatus } from "@/lib/types";
import { useState } from "react";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";

/** An active reservation past its expiry is shown as expired. */
export function effectiveStatus(r: Reservation, now: Date): ReservationStatus {
  return r.status === "active" && !isHolding(r, now) ? "expired" : r.status;
}

export function minutesLeft(r: Reservation, now: Date): number {
  return Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - now.getTime()) / 60_000));
}

export function ReservationList() {
  const { t } = useI18n();
  const { backend } = useApp();
  const now = useNow(15_000);
  const errorMessage = useErrorMessage();
  const [error, setError] = useState<string | null>(null);
  const { data, reload } = useLiveQuery(
    () => Promise.all([backend.myReservations(), backend.listStations()]),
  );

  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [reservations, stations] = data;
  const names = new Map(stations.map((s) => [s.id, s.name]));

  async function cancel(id: string) {
    setError(null);
    try {
      await backend.cancelReservation(id);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 p-6">
      <h1 className="text-2xl font-semibold">{t.reservations.title}</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {reservations.length === 0 && <p className="text-sm text-zinc-500">{t.reservations.empty}</p>}
      <ul className="space-y-2">
        {reservations.map((r) => {
          const status = effectiveStatus(r, now);
          return (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
              <div className="min-w-0 flex-1">
                <div className="font-medium">{names.get(r.stationId) ?? "–"}</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">
                  {r.type === "battery" ? t.reservations.battery : t.reservations.slot} ·{" "}
                  {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className={status === "active" ? "font-semibold text-gp-green-dark dark:text-gp-green" : "text-zinc-500"}>
                  {t.reservations.status[status]}
                </div>
                {status === "active" && (
                  <div className="text-xs text-zinc-500">{format(t.time.minutesLeft, { n: minutesLeft(r, now) })}</div>
                )}
              </div>
              {status === "active" && (
                <button type="button" onClick={() => cancel(r.id)} className="text-sm text-red-600 hover:underline">
                  {t.reservations.cancel}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
