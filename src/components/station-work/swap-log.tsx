"use client";

import { useState } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { SWAP_CUSTOMER_TYPES, type SwapCustomerType } from "@shared/station-work";
import type { StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { Badge, EmptyState, SkeletonCard } from "../ui";
import { RoleBadge, WorkShell } from "./work-shell";

function SwapList({ station, mine }: { station: StationView; mine: boolean }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const l = t.work.log;
  const s = t.work.swap;
  const [filter, setFilter] = useState<SwapCustomerType | null>(null);
  const { data, error, reload } = useLiveQuery(() => backend.stationSwaps(station.id, { customerType: filter }), `${station.id}:${filter ?? ""}`);
  const time = (iso: string) => new Date(iso).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
  const chip = (active: boolean) =>
    `min-h-11 rounded-full border px-4 text-sm font-semibold ${active ? "border-gp-green-dark bg-gp-green-dark text-white" : "border-gp-border bg-gp-surface"}`;

  return (
    <>
      <p className="text-sm text-gp-muted">{mine ? l.introMine : l.intro}</p>
      <div className="flex flex-wrap gap-2" role="group" aria-label={s.customer}>
        <button type="button" aria-pressed={filter === null} className={chip(filter === null)} onClick={() => setFilter(null)}>
          {l.all}
        </button>
        {SWAP_CUSTOMER_TYPES.map((type) => (
          <button key={type} type="button" aria-pressed={filter === type} className={chip(filter === type)} onClick={() => setFilter(type)}>
            {s.customerTypes[type]}
          </button>
        ))}
      </div>
      {!data ? (
        error ? (
          <LoadFailed error={error} onRetry={reload} />
        ) : (
          <SkeletonCard />
        )
      ) : data.length === 0 ? (
        <EmptyState text={l.empty} />
      ) : (
        <ul className="divide-y divide-gp-border rounded-2xl border border-gp-border bg-gp-surface">
          {data.map((x) => (
            <li key={x.id} className="space-y-1 px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums text-gp-muted">{time(x.createdAt)}</span>
                <Badge tone={x.customerType === "fleet" ? "blue" : x.customerType === "app" ? "green" : "neutral"}>{s.customerTypes[x.customerType]}</Badge>
                {x.batteryTypeLabel && <span className="font-medium">{x.batteryTypeLabel}</span>}
                <span className="ml-auto font-semibold tabular-nums">
                  {x.payment === "fleet" || x.payment === "none" ? s.payments[x.payment] : `${formatXof(x.amountXof, locale)} · ${s.payments[x.payment]}`}
                </span>
              </div>
              <div className="text-gp-muted">
                {l.in} {x.batteryIn ?? "–"} · {l.out} {x.batteryOut ?? "–"}
                {(x.customer ?? x.driver) && ` · ${x.customer ?? x.driver}`}
              </div>
              <div className="text-xs text-gp-muted">
                {format(l.by, { person: x.person })} <RoleBadge role={x.role} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** /operator/journal: today's swaps at the station, filtered by customer type. */
export function SwapLogPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.log.title} services={["swap"]}>
      {({ station, role }) => <SwapList key={station.id} station={station} mine={role === "staff"} />}
    </WorkShell>
  );
}
