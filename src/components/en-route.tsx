"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { bearing, compassPoint, directionsUrl, distanceMeters, formatDistance, scooterMinutes, type LatLng } from "@shared/geo";
import { reservationKind } from "@shared/reservations";
import { MAX_UNUSED_RESERVATIONS_PER_DAY, STATION_COOLDOWN_MINUTES, type Reservation, type StationView } from "@shared/types";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { usePosition } from "@/lib/use-position";
import { useApp } from "./app-provider";
import { ConfirmSheet } from "./confirm-sheet";
import { BackIcon, CheckCircleIcon, InfoIcon, NavigateIcon, PhoneIcon, QrIcon } from "./icons";
import { useI18n } from "./i18n-provider";
import { LoadFailed } from "./load-state";
import { effectiveStatus } from "./reservation-list";
import { StationMap } from "./station-map";
import { Button, EmptyState, SkeletonCard, formatRemaining, useCountdown, useWideScreen } from "./ui";

/** A new point is sent at most every half minute, or sooner once the customer moved this far. */
const SHARE_EVERY_MS = 30_000;
const SHARE_MOVED_M = 50;
/** The last minutes of the hold are counted in seconds. */
const URGENT_MS = 5 * 60_000;

/** Whether the customer said "not now" to sharing for this reservation (asked once per reservation). */
function declinedKey(id: string) {
  return `poinderecharge-share-declined-${id}`;
}
function readDeclined(id: string): boolean {
  try {
    return sessionStorage.getItem(declinedKey(id)) === "1";
  } catch {
    return false;
  }
}

/**
 * Sends the customer's position to the station while they agreed to it: at most every half
 * minute, or sooner once they moved 50 m. Nothing is sent without their consent.
 */
function useSharePosition(reservationId: string, on: boolean, position: LatLng | null) {
  const { backend } = useApp();
  const last = useRef<{ at: number; pos: LatLng } | null>(null);
  useEffect(() => {
    if (!on || !position) return;
    const prev = last.current;
    const now = Date.now();
    if (prev && now - prev.at < SHARE_EVERY_MS && distanceMeters(prev.pos, position) < SHARE_MOVED_M) return;
    last.current = { at: now, pos: position };
    backend.shareReservationPosition(reservationId, position).catch(() => {
      // Offline for a moment: the next point tries again.
      last.current = null;
    });
  }, [backend, reservationId, on, position]);
}

function SquareIcon({ children, tone = "green" }: { children: React.ReactNode; tone?: "green" | "red" }) {
  return (
    <span
      aria-hidden
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-[14px] ${tone === "green" ? "bg-gp-green text-gp-forest" : "bg-gp-closed text-white"}`}
    >
      {children}
    </span>
  );
}

function CloseGlyph() {
  return (
    <svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** The trip once reserved (mockup A5): way to the station, time left of the hold, code, and arrival. */
function Trip({ reservation: r, station, onChanged }: { reservation: Reservation; station: StationView; onChanged: () => void }) {
  const { t, locale } = useI18n();
  const E = t.enRoute;
  const router = useRouter();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { position, state } = usePosition();
  const now = useNow(15_000);
  const left = useCountdown(r.expiresAt) ?? 0;
  const total = Math.max(1, Date.parse(r.expiresAt) - Date.parse(r.createdAt));
  const [sharingLocal, setSharingLocal] = useState<boolean | null>(null);
  const [declined, setDeclined] = useState(() => readDeclined(r.id));
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sharing = sharingLocal ?? !!r.sharing;
  useSharePosition(r.id, sharing, position);
  const single = useMemo(() => [station], [station]);
  // On computers the route is framed to the right of the floating sheet.
  const wide = useWideScreen();
  const padding = useMemo(() => (wide ? { top: 60, bottom: 60, left: 480, right: 60 } : { top: 110, bottom: 50, left: 50, right: 50 }), [wide]);

  const distance = position ? distanceMeters(position, station) : null;
  const minutes = distance !== null ? scooterMinutes(distance) : null;
  const arrival =
    minutes !== null
      ? new Date(now.getTime() + minutes * 60_000).toLocaleTimeString(locale, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : null;
  const direction = position ? E.directions[compassPoint(bearing(position, station))] : null;
  const kind = r.targetKind ?? (reservationKind(r) === "swap" ? "battery_type" : "place");
  const what = [t.reserveFlow.targetKinds[kind], r.targetLabel].filter(Boolean).join(" ");
  const code = r.pickupCode ? `${r.pickupCode.slice(0, 2)} ${r.pickupCode.slice(2)}` : "";

  function decline() {
    setDeclined(true);
    try {
      sessionStorage.setItem(declinedKey(r.id), "1");
    } catch {
      // Private mode: the question comes back next time, which is fine.
    }
  }

  async function stopSharing() {
    setSharingLocal(false);
    try {
      await backend.shareReservationPosition(r.id, null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      await backend.cancelReservation(r.id);
      onChanged();
      router.push("/reservations");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      setCancelling(false);
    }
  }

  return (
    // Phones: the map, then the sheet below it. Computers: the map fills the page and the sheet
    // floats on its left, like a navigation app.
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:relative md:overflow-hidden">
      <div className="relative min-h-[220px] flex-1">
        <div className="absolute inset-0">
          <StationMap
            stations={single}
            position={position}
            selectedId={station.id}
            onSelect={() => undefined}
            route
            controls={false}
            padding={padding}
          />
        </div>

        <div className="absolute inset-x-0 top-0 flex items-start gap-2 p-3 md:right-auto md:w-[452px] md:p-4">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? router.back() : router.push("/reservations"))}
            aria-label={t.ui.back}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gp-surface shadow-md"
          >
            <BackIcon size={20} />
          </button>
          <div className="flex min-w-0 flex-1 items-center gap-3 rounded-[20px] bg-gp-forest p-3 text-white shadow-lg">
            <SquareIcon>
              <NavigateIcon
                size={22}
                style={{
                  transform: `rotate(${position ? bearing(position, station) - 45 : 0}deg)`,
                }}
              />
            </SquareIcon>
            <div className="min-w-0 flex-1">
              <div className="truncate font-heading text-lg font-bold leading-tight">
                {distance !== null && direction
                  ? format(E.heading, {
                      distance: formatDistance(distance),
                      direction,
                    })
                  : format(E.toStation, { station: station.name })}
              </div>
              <a href={directionsUrl(station)} target="_blank" rel="noopener noreferrer" className="text-sm text-white/80 underline-offset-2 hover:underline">
                {E.openMaps} ›
              </a>
            </div>
          </div>
        </div>
      </div>

      <section
        aria-label={E.title}
        className="relative -mt-5 rounded-t-[20px] bg-gp-surface px-4 pb-10 pt-3 shadow-[0_-8px_24px_rgba(0,0,0,.12)] md:absolute md:bottom-4 md:left-4 md:mt-0 md:max-h-[calc(100%-7rem)] md:w-[420px] md:overflow-y-auto md:rounded-[20px] md:pb-4 md:pt-4 md:shadow-xl"
      >
        <span aria-hidden className="mx-auto mb-3 block h-1 w-10 rounded-full bg-gp-border md:hidden dark:bg-white/20" />
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            {minutes !== null && distance !== null ? (
              <p className="font-heading">
                <span className="text-4xl font-bold">{format(t.work.reservations.minutes, { n: minutes })}</span>
                <span className="text-lg text-gp-muted dark:text-zinc-400"> · {formatDistance(distance)}</span>
              </p>
            ) : (
              <p className="text-sm text-gp-muted dark:text-zinc-400">{state === "denied" ? E.noPosition : t.enRoute.loading}</p>
            )}
            <p className="mt-0.5 truncate text-sm text-gp-muted dark:text-zinc-400">
              {arrival ? format(E.eta, { time: arrival, station: station.name }) : station.name}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCancelling(true)}
            aria-label={E.cancel}
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-gp-border text-gp-closed hover:bg-gp-closed/10 dark:border-white/15"
          >
            <CloseGlyph />
          </button>
        </div>

        {r.redirectedAt ? (
          <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-gp-closed/10 p-3">
            <SquareIcon tone="red">
              <InfoIcon size={22} />
            </SquareIcon>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gp-forest dark:text-zinc-100">{E.redirected}</p>
              <Link href="/carte" className="text-sm font-semibold text-gp-closed underline-offset-2 hover:underline">
                {E.otherStations} ›
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex items-center gap-3 rounded-[14px] bg-gp-green/15 p-3">
            <SquareIcon>
              <CheckCircleIcon size={22} />
            </SquareIcon>
            <div className="min-w-0 flex-1">
              <p className="font-semibold text-gp-forest dark:text-zinc-100">{format(E.reservedFor, { what })}</p>
              <p role="timer" className="text-sm text-gp-green-dark dark:text-gp-green">
                {format(E.keptFor, {
                  time:
                    left > URGENT_MS
                      ? format(t.work.reservations.minutes, {
                          n: Math.ceil(left / 60_000),
                        })
                      : formatRemaining(left),
                  code,
                })}
              </p>
              {r.readyAt && <p className="text-sm font-semibold text-gp-green-dark dark:text-gp-green">{E.ready}</p>}
            </div>
          </div>
        )}
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gp-border dark:bg-white/10" aria-hidden>
          <div className="h-full rounded-full bg-gp-green transition-[width] duration-1000" style={{ width: `${Math.round((left / total) * 100)}%` }} />
        </div>

        {!sharing && !declined ? (
          <div className="mt-3 rounded-[14px] border border-gp-border p-3 dark:border-white/15">
            <p className="font-semibold">{E.share.title}</p>
            <p className="mt-0.5 text-sm text-gp-muted dark:text-zinc-400">{E.share.body}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" onClick={() => setSharingLocal(true)}>
                {E.share.yes}
              </Button>
              <Button size="sm" variant="ghost" onClick={decline}>
                {E.share.no}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-3 flex items-center gap-2 text-sm text-gp-muted dark:text-zinc-400">
            <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${sharing ? "bg-gp-info" : "bg-gp-border"}`} />
            <span className="min-w-0 flex-1">{sharing ? E.share.on : E.share.off}</span>
            <button
              type="button"
              onClick={() => (sharing ? void stopSharing() : setSharingLocal(true))}
              className="font-semibold text-gp-green-dark underline-offset-2 hover:underline dark:text-gp-green"
            >
              {sharing ? E.share.stop : E.share.start}
            </button>
          </p>
        )}

        {error && (
          <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
            {error}
          </p>
        )}

        <div className="mt-3 flex gap-3">
          {station.phone && (
            <a
              href={`tel:${station.phone}`}
              aria-label={E.call}
              className="flex h-14 w-16 shrink-0 items-center justify-center rounded-[14px] border-2 border-gp-green-dark text-gp-green-dark dark:border-gp-green dark:text-gp-green"
            >
              <PhoneIcon size={22} />
            </a>
          )}
          <Link
            href="/scanner"
            className="flex h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] bg-gp-green px-4 font-heading text-base font-bold text-gp-forest hover:brightness-95"
          >
            <QrIcon size={22} />
            <span className="truncate">{E.arrived}</span>
          </Link>
        </div>
      </section>

      <ConfirmSheet
        open={cancelling}
        title={t.reservations.confirmCancelTitle}
        confirmLabel={t.reservations.confirmCancelAction}
        cancelLabel={t.reservations.keep}
        danger
        busy={busy}
        onConfirm={() => void cancel()}
        onCancel={() => setCancelling(false)}
      >
        <p>
          {format(t.reservations.confirmCancelBody, {
            minutes: STATION_COOLDOWN_MINUTES,
            max: MAX_UNUSED_RESERVATIONS_PER_DAY,
          })}
        </p>
      </ConfirmSheet>
    </div>
  );
}

/** /en-route?id=…: the customer's live trip to the station of their active reservation. */
export function EnRoute() {
  const { t } = useI18n();
  const { backend } = useApp();
  const id = useSearchParams().get("id") ?? "";
  const now = useNow(15_000);
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.myReservations(), backend.listStations()]), id);
  if (!data) {
    return error ? (
      <LoadFailed error={error} onRetry={reload} />
    ) : (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4">
        <span className="sr-only" role="status">
          {t.enRoute.loading}
        </span>
        <SkeletonCard />
      </div>
    );
  }
  const [reservations, stations] = data;
  const r = reservations.find((x) => x.id === id) ?? null;
  const station = r ? stations.find((s) => s.id === r.stationId) : undefined;
  if (!r || !station || effectiveStatus(r, now) !== "active") {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-6">
        <EmptyState text={t.enRoute.gone} action={<Button href="/reservations">{t.enRoute.back}</Button>} />
      </div>
    );
  }
  return <Trip reservation={r} station={station} onChanged={reload} />;
}
