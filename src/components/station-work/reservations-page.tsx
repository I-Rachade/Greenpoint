"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { distanceMeters, formatDistance, scooterMinutes } from "@shared/geo";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { reservationKind, staffFlowHref } from "@shared/reservations";
import { initials, tripStatus, type TripStatus } from "./trip-status";
import type { Reservation, StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { CheckCircleIcon, PhoneIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { effectiveStatus, minutesLeft, useReservationWhat } from "../reservation-list";
import { StationMap } from "../station-map";
import { EmptyState, SkeletonCard, useToast } from "../ui";
import { WorkShell } from "./work-shell";

const STATUS_CHIP: Record<TripStatus, string> = {
  ready: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  prepare: "bg-gp-yellow/30 text-amber-800 dark:text-amber-300",
  out: "bg-gp-closed/10 text-gp-closed",
  redirected: "bg-gp-closed/10 text-gp-closed",
};
const STATUS_DOT: Record<TripStatus, string> = {
  ready: "bg-gp-green-dark",
  prepare: "bg-amber-700",
  out: "bg-gp-closed",
  redirected: "bg-gp-closed",
};
const AVATAR: Record<TripStatus, string> = {
  ready: "bg-gp-green/15",
  prepare: "bg-gp-yellow/30",
  out: "bg-gp-closed/10",
  redirected: "bg-gp-closed/10",
};

/** Distance and riding time of a customer who shares their position, else null. */
function tripOf(r: Reservation, station: StationView) {
  if (!r.customerPosition) return null;
  const meters = distanceMeters(r.customerPosition, station);
  return { meters, minutes: scooterMinutes(meters) };
}

const actionBase = "flex min-h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-[14px] px-4 text-sm font-semibold";

/** One customer on their way: who, what, how far, its status and the one action that fits it. */
function TripCard({
  reservation: r,
  station,
  now,
  busy,
  onReady,
  onRedirect,
}: {
  reservation: Reservation;
  station: StationView;
  now: Date;
  busy: boolean;
  onReady: () => void;
  onRedirect: () => void;
}) {
  const { t } = useI18n();
  const R = t.work.reservations;
  const what = useReservationWhat();
  const status = tripStatus(r, station);
  const trip = tripOf(r, station);
  const statusLabel = status === "ready" && reservationKind(r) !== "swap" ? R.status.readyPlace : R.status[status];
  const call = r.customerPhone ? (
    <a href={`tel:${r.customerPhone}`} className={`${actionBase} border-2 border-gp-green-dark text-gp-green-dark dark:border-gp-green dark:text-gp-green`}>
      <PhoneIcon size={18} />
      {R.call}
    </a>
  ) : null;
  const open = (
    <Link href={staffFlowHref(r)} className={`${actionBase} border border-gp-border text-gp-forest dark:border-white/15 dark:text-zinc-100`}>
      {R.open} ›
    </Link>
  );
  let action = call ?? open;
  if (status === "prepare") {
    action = (
      <button type="button" onClick={onReady} disabled={busy} className={`${actionBase} bg-gp-green-dark text-white hover:bg-gp-forest disabled:opacity-60`}>
        <CheckCircleIcon size={18} />
        {R.markReady}
      </button>
    );
  } else if (status === "out") {
    action = (
      <button
        type="button"
        onClick={onRedirect}
        disabled={busy}
        className={`${actionBase} border-2 border-gp-closed text-gp-closed hover:bg-gp-closed/10 disabled:opacity-60`}
      >
        {R.redirect}
      </button>
    );
  }
  return (
    <li className="rounded-[20px] border border-gp-border bg-gp-surface p-4 dark:border-white/10">
      <Link href={staffFlowHref(r)} className="flex items-start gap-3">
        <span
          aria-hidden
          className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-full font-heading text-base font-bold text-gp-forest dark:text-zinc-100 ${AVATAR[status]}`}
        >
          {initials(r.customer)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-heading text-base font-semibold">{r.customer ?? R.customer}</span>
          <span className="block truncate text-sm text-gp-muted dark:text-zinc-400">
            {r.targetLabel ?? what(r)} · {format(t.time.minutesLeft, { n: minutesLeft(r, now) })}
          </span>
        </span>
        <span className="shrink-0 text-right">
          {trip ? (
            <>
              <span className="block font-heading text-xl font-bold leading-tight">{format(R.minutes, { n: trip.minutes })}</span>
              <span className="block text-sm text-gp-muted dark:text-zinc-400">{formatDistance(trip.meters)}</span>
            </>
          ) : (
            <span className="block max-w-24 text-xs text-gp-muted dark:text-zinc-400">{R.noPosition}</span>
          )}
        </span>
      </Link>
      <div className="mt-3 flex items-center gap-2">
        <span className={`inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-semibold ${STATUS_CHIP[status]}`}>
          <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
          {statusLabel}
        </span>
        {action}
      </div>
    </li>
  );
}

function EnRouteList({ station }: { station: StationView }) {
  const { t } = useI18n();
  const R = t.work.reservations;
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const now = useNow(15_000);
  const [filter, setFilter] = useState<"all" | "prepare">("all");
  const [busy, setBusy] = useState(false);
  const [redirecting, setRedirecting] = useState<string | null>(null);
  const { data, error, reload } = useLiveQuery(() => backend.stationReservations(station.id), station.id);

  const active = useMemo(
    () =>
      (data ?? [])
        .filter((r) => effectiveStatus(r, now) === "active")
        // The nearest first; those without a shared position by the time their hold runs out.
        .sort((a, b) => (tripOf(a, station)?.meters ?? Infinity) - (tripOf(b, station)?.meters ?? Infinity) || a.expiresAt.localeCompare(b.expiresAt)),
    [data, now, station],
  );
  const others = useMemo(
    () =>
      active
        .filter((r) => r.customerPosition)
        .map((r) => ({
          id: r.id,
          lat: r.customerPosition!.lat,
          lng: r.customerPosition!.lng,
          label: initials(r.customer),
        })),
    [active],
  );
  const single = useMemo(() => [station], [station]);

  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const toPrepare = active.filter((r) => tripStatus(r, station) === "prepare");
  const shown = filter === "prepare" ? toPrepare : active;

  async function act(id: string, what: "ready" | "redirect") {
    setBusy(true);
    try {
      if (what === "ready") await backend.markReservationReady(id);
      else await backend.redirectReservation(id);
      toast(what === "ready" ? R.readyDone : R.redirectDone);
      reload();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
      setRedirecting(null);
    }
  }

  const chip = (on: boolean) =>
    `inline-flex min-h-10 shrink-0 items-center rounded-full px-4 text-sm font-semibold ${
      on ? "bg-gp-forest text-white" : "border border-gp-border bg-gp-surface text-gp-forest dark:border-white/15 dark:text-zinc-100"
    }`;

  return (
    <>
      <p className="-mt-2 text-sm text-gp-muted dark:text-zinc-400">{R.live}</p>
      {others.length > 0 && (
        <div className="relative h-48 overflow-hidden rounded-[20px] border border-gp-border dark:border-white/10">
          <StationMap
            stations={single}
            position={null}
            selectedId={station.id}
            onSelect={() => undefined}
            controls={false}
            others={others}
            padding={{ top: 40, bottom: 30, left: 40, right: 40 }}
          />
        </div>
      )}
      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group">
        <button type="button" aria-pressed={filter === "all"} onClick={() => setFilter("all")} className={chip(filter === "all")}>
          {format(R.all, { n: active.length })}
        </button>
        <button type="button" aria-pressed={filter === "prepare"} onClick={() => setFilter("prepare")} className={chip(filter === "prepare")}>
          {format(R.toPrepare, { n: toPrepare.length })}
        </button>
      </div>
      {shown.length === 0 ? (
        <EmptyState text={active.length === 0 ? R.empty : t.operator.noReservations} />
      ) : (
        <ul className="space-y-3">
          {shown.map((r) => (
            <TripCard
              key={r.id}
              reservation={r}
              station={station}
              now={now}
              busy={busy}
              onReady={() => void act(r.id, "ready")}
              onRedirect={() => setRedirecting(r.id)}
            />
          ))}
        </ul>
      )}
      <p className="text-xs text-gp-muted dark:text-zinc-400">{R.intro}</p>
      <ConfirmSheet
        open={redirecting !== null}
        title={R.redirectTitle}
        confirmLabel={R.redirect}
        cancelLabel={t.reservations.keep}
        busy={busy}
        onConfirm={() => redirecting && void act(redirecting, "redirect")}
        onCancel={() => setRedirecting(null)}
      >
        <p>{R.redirectBody}</p>
      </ConfirmSheet>
    </>
  );
}

/**
 * /operator/reservations, "Clients en route" (mockup B2): the station's active reservations,
 * nearest first, with the customers who share their position on a small map. Each card marks
 * the battery ready, offers another station when the stock ran out, or calls the customer;
 * a tap on the customer opens the right flow already filled in.
 */
export function ReservationsPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.reservations.enRoute} services={["swap", "charging", "ev"]}>
      {({ station }) => <EnRouteList key={station.id} station={station} />}
    </WorkShell>
  );
}
