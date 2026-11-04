"use client";

import Link from "next/link";
import type { ComponentType } from "react";
import { useLiveQuery, useNow } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { hourly, latest, peak, type ActivityItem, type ActivityKind } from "@shared/station-activity";
import type { StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { BoltIcon, BoxIcon, ScooterIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { EmptyState, SkeletonCard } from "../ui";
import { useStationDay } from "./use-station-day";
import { WorkShell } from "./work-shell";

const KIND_ICON: Record<ActivityKind, ComponentType<{ size?: number }>> = {
  swap: ScooterIcon,
  charge: BoltIcon,
  parcel_in: BoxIcon,
  parcel_out: BoxIcon,
};

/** Bars per hour of the day so far, the busiest one in full green (mockup B5). */
function HourChart({ items, now }: { items: ActivityItem[]; now: Date }) {
  const { t } = useI18n();
  const D = t.work.day;
  const buckets = hourly(
    items.map((i) => i.at),
    now,
  );
  const top = peak(buckets);
  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <figure className="mt-4">
      <div className="flex h-32 items-end gap-1.5" aria-hidden>
        {buckets.map((b) => (
          <div key={b.hour} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div
              className={`w-full rounded-t-[8px] ${top && b.hour === top.hour ? "bg-gp-green" : "bg-gp-green/25"}`}
              style={{ height: `${b.n === 0 ? 4 : Math.max(10, (b.n / max) * 100)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1.5 text-center text-[11px] text-gp-muted dark:text-zinc-400" aria-hidden>
        {buckets.map((b) => (
          <span key={b.hour} className="min-w-0 flex-1 truncate">
            {b.hour % (buckets.length > 12 ? 2 : 1) === 0 ? `${b.hour}h` : ""}
          </span>
        ))}
      </div>
      <figcaption className="mt-2 text-sm text-gp-muted dark:text-zinc-400">{top ? format(D.peak, { hour: top.hour, n: top.n }) : D.quiet}</figcaption>
    </figure>
  );
}

function Day({ station }: { station: StationView }) {
  const { t, locale } = useI18n();
  const D = t.work.day;
  const { backend } = useApp();
  const now = useNow(60_000);
  const { data, error, reload } = useStationDay(station);
  // Own stations: the cash this staff member took since their last closing (shared/station-cash.ts).
  const { data: cash } = useLiveQuery(() => backend.myStationCash(station.id).catch(() => null), station.id);
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const ops = latest(data.items, 6);
  const swap = (station.activeServices ?? []).includes("swap");
  const charging = (station.activeServices ?? []).some((s) => s === "charging" || s === "ev");
  const parcels = (station.activeServices ?? []).includes("parcels");
  const totals = [
    swap && { label: D.swaps, n: data.swaps },
    charging && { label: D.charges, n: data.charges },
    parcels && { label: D.parcels, n: data.parcels },
  ].filter(Boolean) as { label: string; n: number }[];

  return (
    <>
      <p className="-mt-2 text-sm text-gp-muted first-letter:uppercase dark:text-zinc-400">
        {now.toLocaleDateString(locale, { weekday: "long", day: "numeric", month: "long" })}
      </p>
      <section className="rounded-[20px] border border-gp-border bg-gp-surface p-4 dark:border-white/10">
        <dl className="flex justify-between gap-3">
          {totals.map((x) => (
            <div key={x.label} className="min-w-0">
              <dt className="text-sm text-gp-muted dark:text-zinc-400">{x.label}</dt>
              <dd className="font-heading text-3xl font-bold tabular-nums">{x.n}</dd>
            </div>
          ))}
        </dl>
        <HourChart items={data.items} now={now} />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-heading text-lg font-semibold">{D.latest}</h2>
          {swap && (
            <Link href="/operator/journal" className="text-sm font-semibold text-gp-green-dark dark:text-gp-green">
              {D.seeAll}
            </Link>
          )}
        </div>
        {ops.length === 0 ? (
          <EmptyState text={D.quiet} />
        ) : (
          <ul className="divide-y divide-gp-border dark:divide-white/10">
            {ops.map((op) => {
              const Icon = KIND_ICON[op.kind];
              const sub = [op.who, op.payment ? D.payments[op.payment] : null].filter(Boolean).join(" · ");
              return (
                <li key={op.id} className="flex items-center gap-3 py-3">
                  <span className="shrink-0 text-gp-green-dark dark:text-gp-green">
                    <Icon size={22} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{[D.kinds[op.kind], op.what].filter(Boolean).join(" · ")}</span>
                    {sub && <span className="block truncate text-sm text-gp-muted dark:text-zinc-400">{sub}</span>}
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block font-semibold tabular-nums">{op.amountXof !== null ? formatXof(op.amountXof, locale) : "—"}</span>
                    <span className="block text-sm tabular-nums text-gp-muted dark:text-zinc-400">{time(op.at)}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {cash && (
        <section className="flex flex-wrap items-center gap-3 rounded-[20px] bg-gp-forest p-4 text-white">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-white/70">{D.cashDue}</p>
            <p className="font-heading text-2xl font-bold tabular-nums">{formatXof(cash.dueXof, locale)}</p>
          </div>
          <Link
            href="/operator/green-credit"
            className="inline-flex min-h-12 items-center rounded-[14px] bg-gp-green px-5 font-heading font-bold text-gp-forest"
          >
            {D.closeDay}
          </Link>
        </section>
      )}
    </>
  );
}

/** /operator/activite (mockup B5): today's totals, operations per hour, the latest ones, and the cash to hand over. */
export function ActivityPage() {
  const { t } = useI18n();
  return <WorkShell title={t.work.day.activityTitle}>{({ station }) => <Day key={station.id} station={station} />}</WorkShell>;
}
