"use client";

import Link from "next/link";
import { MyCharges } from "./charging/charging";
import { isHolding } from "@shared/availability";
import { directionsUrl } from "@shared/geo";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { MAX_UNUSED_RESERVATIONS_PER_DAY, STATION_COOLDOWN_MINUTES, type Reservation, type ReservationStatus } from "@shared/types";
import { useState } from "react";
import { useApp } from "./app-provider";
import { ConfirmSheet } from "./confirm-sheet";
import { BatteryIcon, BoltIcon, CarIcon, ListIcon, NavigateIcon } from "./icons";
import { reservationKind } from "@shared/reservations";
import { useI18n } from "./i18n-provider";
import { LoadFailed, OfflineNotice } from "./load-state";
import { PageTitle } from "./page-title";
import { stationHref } from "./station-card";
import { Button, Card, EmptyState, ProgressRing, SkeletonCard, formatRemaining, useCountdown } from "./ui";

/** An active reservation past its expiry is shown as expired. */
export function effectiveStatus(r: Reservation, now: Date): ReservationStatus {
  return r.status === "active" && !isHolding(r, now) ? "expired" : r.status;
}

/** What the reservation holds, e.g. "Batterie · Spiro 72 V" or "Borne VE · Borne 1". */
export function useReservationWhat() {
  const { t } = useI18n();
  return (r: Reservation) => {
    const kind = r.targetKind ?? (reservationKind(r) === "swap" ? "battery_type" : "place");
    return [t.reserveFlow.targetKinds[kind], r.targetLabel].filter(Boolean).join(" · ");
  };
}

export function minutesLeft(r: Reservation, now: Date): number {
  return Math.max(0, Math.ceil((new Date(r.expiresAt).getTime() - now.getTime()) / 60_000));
}

/** The last minutes are counted in seconds, in orange. */
const URGENT_MS = 5 * 60_000;

/** Ring that empties as the reservation runs out; minutes, then m:ss for the last five minutes. */
function TimeLeftRing({ reservation }: { reservation: Reservation }) {
  const { t } = useI18n();
  const left = useCountdown(reservation.expiresAt) ?? 0;
  const total = Math.max(1, Date.parse(reservation.expiresAt) - Date.parse(reservation.createdAt));
  const urgent = left <= URGENT_MS;
  return (
    <ProgressRing
      value={left / total}
      size={60}
      label={t.phase1a.timeLeft}
      className={urgent ? "text-gp-low motion-safe:animate-pulse" : "text-gp-green"}
    >
      <span role="timer" className={urgent ? "text-amber-700 dark:text-amber-300" : undefined}>
        {urgent ? formatRemaining(left) : format(t.phase1a.minutes, { n: Math.ceil(left / 60_000) })}
      </span>
    </ProgressRing>
  );
}

export function ReservationList() {
  const { t } = useI18n();
  const { backend } = useApp();
  const now = useNow(15_000);
  const errorMessage = useErrorMessage();
  const what = useReservationWhat();
  const [error, setError] = useState<string | null>(null);
  /** Reservation the person asked to cancel; the sheet explains the consequence first. */
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data, error: loadError, reload } = useLiveQuery(
    () => Promise.all([backend.myReservations(), backend.listStations()]),
  );

  if (!data) {
    return loadError ? (
      <LoadFailed error={loadError} onRetry={reload} />
    ) : (
      <div className="mx-auto w-full max-w-2xl space-y-3 px-4 pb-6 pt-4">
        <span className="sr-only" role="status">
          {t.loading}
        </span>
        {Array.from({ length: 3 }, (_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>
    );
  }
  const [reservations, stations] = data;
  const byId = new Map(stations.map((s) => [s.id, s]));

  async function cancel(id: string) {
    setError(null);
    setBusy(true);
    try {
      await backend.cancelReservation(id);
      reload();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setCancelling(null);
    }
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 px-4 pb-6 pt-4">
      <MyCharges />
      <PageTitle title={t.reservations.title} />
      {!!loadError && <OfflineNotice />}
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {reservations.length === 0 && (
        <EmptyState
          icon={<ListIcon size={36} />}
          title={t.reservations.empty}
          text={t.phase1a.emptyText}
          action={<Button href="/stations">{t.phase1a.seeStations}</Button>}
        />
      )}
      <ul className="space-y-3">
        {reservations.map((r) => {
          const status = effectiveStatus(r, now);
          const station = byId.get(r.stationId);
          const TypeIcon = reservationKind(r) === "swap" ? BatteryIcon : r.targetKind === "ev" ? CarIcon : BoltIcon;
          return (
            <li key={r.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                {status === "active" ? (
                  <TimeLeftRing reservation={r} />
                ) : (
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/5 text-gp-muted dark:bg-white/10">
                    <TypeIcon size={20} />
                  </span>
                )}
                <div className="min-w-0 flex-1">
                  {station ? (
                    <Link href={stationHref(station.id)} className="block truncate font-semibold hover:underline">
                      {station.name}
                    </Link>
                  ) : (
                    <div className="font-semibold">–</div>
                  )}
                  <div className="text-sm text-gp-muted">
                    {what(r)} · {new Date(r.createdAt).toLocaleString()}
                  </div>
                  <div className={`text-sm ${status === "active" ? "font-semibold text-gp-green-dark dark:text-gp-green" : "text-gp-muted"}`}>
                    {t.reservations.status[status]}
                  </div>
                  {status === "cancelled" && r.cancelReason && (
                    <div className="text-sm text-red-700 dark:text-red-400">{t.reservations.cancelReasons[r.cancelReason] ?? r.cancelReason}</div>
                  )}
                </div>
                {status === "active" && r.pickupCode && (
                  <div className="w-full rounded-xl bg-gp-green/10 p-3 text-center dark:bg-gp-green/15">
                    <div className="text-xs text-gp-muted">{t.reservations.pickupCode}</div>
                    <div className="font-mono text-4xl font-bold tracking-[0.3em] text-gp-green-dark dark:text-gp-green">{r.pickupCode}</div>
                    <div className="text-xs text-gp-muted">{t.reservations.pickupHint}</div>
                  </div>
                )}
                {status === "active" && (
                  <div className="flex w-full gap-2">
                    {station && (
                      <a
                        href={directionsUrl(station)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-gp-green-dark px-4 text-sm font-semibold text-white hover:bg-gp-forest"
                      >
                        <NavigateIcon size={16} />
                        {t.station.directions}
                      </a>
                    )}
                    <Button variant="ghost" onClick={() => setCancelling(r.id)} disabled={busy} className="text-red-600 hover:bg-red-500/10 dark:text-red-400">
                      {t.reservations.cancel}
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
      <ConfirmSheet
        open={cancelling !== null}
        title={t.reservations.confirmCancelTitle}
        confirmLabel={t.reservations.confirmCancelAction}
        cancelLabel={t.reservations.keep}
        danger
        busy={busy}
        onConfirm={() => cancelling && void cancel(cancelling)}
        onCancel={() => setCancelling(null)}
      >
        <p>{format(t.reservations.confirmCancelBody, { minutes: STATION_COOLDOWN_MINUTES, max: MAX_UNUSED_RESERVATIONS_PER_DAY })}</p>
      </ConfirmSheet>
    </div>
  );
}
