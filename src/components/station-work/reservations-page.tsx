"use client";

import Link from "next/link";
import { useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { reservationKind, staffFlowHref } from "@shared/reservations";
import type { Reservation, StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { BatteryIcon, BoltIcon, CarIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { effectiveStatus, minutesLeft, useReservationWhat } from "../reservation-list";
import { EmptyState, SkeletonCard } from "../ui";
import { WorkShell } from "./work-shell";

/**
 * One active reservation: a tap opens the right flow already filled in (plan: the
 * reservation list jumps straight into the flow): a swap reservation the swap form, a
 * charging one the outlet choice. The customer's code is typed there.
 */
function ReservationRow({ reservation: r, now }: { reservation: Reservation; now: Date }) {
  const { t } = useI18n();
  const what = useReservationWhat();
  const Icon = reservationKind(r) === "swap" ? BatteryIcon : r.targetKind === "ev" ? CarIcon : BoltIcon;
  return (
    <li>
      <Link
        href={staffFlowHref(r)}
        className="flex min-h-16 items-center gap-3 rounded-2xl border border-gp-border bg-gp-surface p-4 hover:border-gp-green-dark dark:border-white/10"
      >
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gp-green/15 text-gp-green-dark dark:text-gp-green">
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {r.customer ?? t.work.reservations.customer} · {format(t.time.minutesLeft, { n: minutesLeft(r, now) })}
          </span>
          <span className="block truncate text-sm text-gp-muted">{what(r)}</span>
        </span>
        <span className="shrink-0 text-sm font-semibold text-gp-green-dark dark:text-gp-green">{t.work.reservations.open} ›</span>
      </Link>
    </li>
  );
}

function ReservationList({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const now = useNow(15_000);
  const { data, error, reload } = useLiveQuery(() => backend.stationReservations(station.id), station.id);
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const active = data.filter((r) => effectiveStatus(r, now) === "active").sort((a, b) => a.expiresAt.localeCompare(b.expiresAt));
  return (
    <>
      <p className="text-sm text-gp-muted">{t.work.reservations.intro}</p>
      {active.length === 0 ? (
        <EmptyState text={t.operator.noReservations} />
      ) : (
        <ul className="space-y-3">
          {active.map((r) => (
            <ReservationRow key={r.id} reservation={r} now={now} />
          ))}
        </ul>
      )}
    </>
  );
}

/** /operator/reservations: the station's active reservations, soonest to lapse first; each opens its flow. */
export function ReservationsPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.reservations.title} services={["swap", "charging", "ev"]}>
      {({ station }) => <ReservationList key={station.id} station={station} />}
    </WorkShell>
  );
}
