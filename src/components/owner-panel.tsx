"use client";

import Link from "next/link";
import { useState } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { ReportPeriod } from "@/lib/owner-backoffice";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { LoadFailed, StaleNotice } from "./load-state";
import { HistoryView } from "./owner/history";
import { LiveView } from "./owner/live";
import { ReportView } from "./owner/report";
import { PeriodPicker } from "./owner/shared";
import { StaffView } from "./owner/staff";
import { StationsView } from "./owner/stations";
import { EmptyState, SkeletonCard } from "./ui";

export { SERVICE_TONE } from "./owner/stations";

const TABS = ["live", "report", "history", "staff", "stations"] as const;
type Tab = (typeof TABS)[number];

/**
 * /exploitant: the owner's backoffice (plan phase 8) for the stations of the operators the
 * account runs; an admin sees every station. Staff get none (the server answers 403).
 * Live queue and handovers, settlement (W12) and statistics, swap and counter history,
 * staff with the list to re-staff, services, hours and prices.
 */
export function OwnerPanel() {
  const { t } = useI18n();
  const { backend, profile } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.ownerView());
  // Shown when it loads; the rest of the page does not wait for it.
  const { data: services, reload: reloadServices } = useLiveQuery(() => backend.stationServices());
  const [tab, setTab] = useState<Tab>("live");
  const [stationId, setStationId] = useState<string>("");
  const [days, setDays] = useState<ReportPeriod>(7);
  const o = t.owner;

  // A failed refresh keeps the last data on screen; only nothing at all is an error page.
  if (!data) {
    return error ? (
      <LoadFailed error={error} onRetry={reload} />
    ) : (
      <div className="mx-auto w-full max-w-3xl space-y-3 p-4" aria-busy>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }

  const selected = data.stations.find((s) => s.id === stationId) ?? null;
  const shown = selected ? [selected] : data.stations;
  const stationName = (id: string) => data.stations.find((s) => s.id === id)?.name ?? "–";
  const changed = () => {
    reload();
    reloadServices();
  };

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-4 sm:p-6">
      <h1 className="font-heading text-2xl font-semibold">{o.title}</h1>
      <StaleNotice error={error} onRetry={reload} />
      <p className="text-sm text-gp-muted">
        {profile?.role === "admin" ? o.introAdmin : format(o.intro, { operators: data.operators.map((x) => x.name).join(", ") })}
      </p>
      {data.stations.length === 0 ? (
        <EmptyState text={o.noStations} />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3">
            <label htmlFor="owner-station" className="space-y-1 text-sm">
              <span className="block">{o.station}</span>
              <select
                id="owner-station"
                className="min-h-11 rounded-xl border border-gp-border bg-gp-surface px-3 text-base"
                value={stationId}
                onChange={(e) => setStationId(e.target.value)}
              >
                <option value="">{format(o.allStations, { n: data.stations.length })}</option>
                {data.stations.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <Link href="/operator" className="inline-flex min-h-11 items-center text-sm text-gp-green-dark underline dark:text-gp-green">
              {o.statusLink}
            </Link>
          </div>

          <div role="tablist" aria-label={o.title} className="flex gap-1 overflow-x-auto border-b border-gp-border pb-2">
            {TABS.map((k) => (
              <button
                key={k}
                id={`owner-tab-${k}`}
                type="button"
                role="tab"
                aria-selected={tab === k}
                aria-controls="owner-tabpanel"
                onClick={() => setTab(k)}
                className={`inline-flex min-h-11 items-center whitespace-nowrap rounded-full px-4 text-sm font-semibold ${
                  tab === k ? "bg-gp-forest text-white" : "text-zinc-700 hover:bg-black/5 dark:text-zinc-300 dark:hover:bg-white/10"
                }`}
              >
                {o.tabs[k]}
                {k === "staff" && data.reassignments.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 text-xs text-black" aria-label={format(o.reassign.title, { n: data.reassignments.length })}>
                    {data.reassignments.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div id="owner-tabpanel" role="tabpanel" aria-labelledby={`owner-tab-${tab}`} className="space-y-4">
            {(tab === "report" || tab === "history") && <PeriodPicker value={days} onChange={setDays} />}
            {tab === "live" && <LiveView stationId={selected?.id ?? null} stationName={stationName} />}
            {tab === "report" && <ReportView stationId={selected?.id ?? null} days={days} />}
            {tab === "history" && <HistoryView stationId={selected?.id ?? null} days={days} />}
            {tab === "staff" && <StaffView view={data} stations={shown} onChanged={changed} />}
            {tab === "stations" && <StationsView stations={shown} prices={data.prices} services={services ?? []} onChanged={changed} />}
          </div>
        </>
      )}
    </div>
  );
}
