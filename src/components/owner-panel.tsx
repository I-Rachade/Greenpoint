"use client";

import Link from "next/link";
import { useState, type ComponentType, type SVGProps } from "react";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { ReportPeriod } from "@/lib/owner-backoffice";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { BatteryIcon, CheckCircleIcon, HistoryIcon, PulseIcon, StoreIcon, UsersIcon, WalletIcon } from "./icons";
import { LoadFailed, StaleNotice } from "./load-state";
import { BatteryRegistry } from "./batteries/battery-registry";
import { HistoryView } from "./owner/history";
import { LiveView } from "./owner/live";
import { ReportView } from "./owner/report";
import { PeriodPicker } from "./owner/shared";
import { StaffView } from "./owner/staff";
import { StationsView } from "./owner/stations";
import { EmptyState, SkeletonCard } from "./ui";

export { SERVICE_TONE } from "./owner/stations";

const TABS = ["live", "report", "history", "batteries", "staff", "stations"] as const;
type Tab = (typeof TABS)[number];

const TAB_ICON: Record<Tab, ComponentType<SVGProps<SVGSVGElement> & { size?: number }>> = {
  live: PulseIcon,
  report: WalletIcon,
  history: HistoryIcon,
  batteries: BatteryIcon,
  staff: UsersIcon,
  stations: StoreIcon,
};

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

  const intro = profile?.role === "admin" ? o.introAdmin : format(o.intro, { operators: data.operators.map((x) => x.name).join(", ") });
  const none = data.stations.length === 0;
  const stationOptions = (
    <>
      <option value="">{format(o.allStations, { n: data.stations.length })}</option>
      {data.stations.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </>
  );
  const reassignBadge = (className: string) =>
    data.reassignments.length > 0 && (
      <span className={`rounded-full bg-gp-yellow px-1.5 text-xs font-semibold text-gp-forest ${className}`} aria-label={format(o.reassign.title, { n: data.reassignments.length })}>
        {data.reassignments.length}
      </span>
    );

  return (
    <div className="flex min-h-0 flex-1">
      {/* Wide screens: station picker, the tabs as a menu and the status link in a dark sidebar, as in the admin backoffice. */}
      {!none && (
        <aside className="hidden w-60 shrink-0 flex-col gap-1 overflow-y-auto bg-gp-forest px-3 py-5 text-white/80 lg:flex dark:border-r dark:border-white/10 dark:bg-black/30">
          <label htmlFor="owner-station-side" className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">
            {o.station}
          </label>
          <select
            id="owner-station-side"
            className="mb-4 min-h-10 w-full rounded-lg border border-white/15 bg-white/10 px-2 text-sm font-medium text-white [&>option]:text-gp-forest"
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
          >
            {stationOptions}
          </select>
          <div className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/45">{o.title}</div>
          <div role="tablist" aria-label={o.title} aria-orientation="vertical" className="space-y-0.5 text-sm">
            {TABS.map((k) => {
              const Icon = TAB_ICON[k];
              return (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  aria-controls="owner-tabpanel"
                  onClick={() => setTab(k)}
                  className={`flex min-h-10 w-full items-center gap-3 rounded-lg px-3 font-medium transition-colors ${
                    tab === k ? "bg-gp-green text-gp-forest" : "hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <Icon size={18} />
                  {o.tabs[k]}
                  {k === "staff" && reassignBadge("ml-auto")}
                </button>
              );
            })}
          </div>
          <Link
            href="/operator"
            className="mt-auto flex min-h-10 items-center gap-3 rounded-lg border border-white/15 px-3 text-sm font-semibold text-gp-green hover:bg-white/10"
          >
            <CheckCircleIcon size={18} />
            {o.statusLink}
          </Link>
        </aside>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6 lg:px-8">
          <div>
            {!none && (
              <div className="hidden text-xs font-medium text-gp-muted lg:block">
                {o.title} / {o.tabs[tab]}
              </div>
            )}
            <h1 className="font-heading text-2xl font-semibold">
              <span className={none ? "" : "lg:hidden"}>{o.title}</span>
              {!none && <span className="hidden lg:inline">{o.tabs[tab]}</span>}
            </h1>
            <p className="mt-1 text-sm text-gp-muted">{intro}</p>
          </div>
          <StaleNotice error={error} onRetry={reload} />
          {none ? (
            <EmptyState text={o.noStations} />
          ) : (
            <>
              {/* Phones and tablets: picker and tabs on top. */}
              <div className="space-y-4 lg:hidden">
                <div className="flex flex-wrap items-end gap-3">
                  <label htmlFor="owner-station" className="w-full space-y-1 text-sm sm:w-auto">
                    <span className="block">{o.station}</span>
                    <select
                      id="owner-station"
                      className="min-h-11 w-full rounded-xl border border-gp-border bg-gp-surface px-3 text-base sm:w-auto"
                      value={stationId}
                      onChange={(e) => setStationId(e.target.value)}
                    >
                      {stationOptions}
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
                      {k === "staff" && reassignBadge("ml-1.5")}
                    </button>
                  ))}
                </div>
              </div>

              <div id="owner-tabpanel" role="tabpanel" aria-labelledby={`owner-tab-${tab}`} className="space-y-4">
                {(tab === "report" || tab === "history") && <PeriodPicker value={days} onChange={setDays} />}
                {tab === "live" && <LiveView stationId={selected?.id ?? null} stationName={stationName} />}
                {tab === "report" && <ReportView stationId={selected?.id ?? null} days={days} />}
                {tab === "history" && <HistoryView stationId={selected?.id ?? null} days={days} />}
                {tab === "batteries" && <BatteryRegistry stationId={selected?.id ?? null} />}
                {tab === "staff" && <StaffView view={data} stations={shown} onChanged={changed} />}
                {tab === "stations" && <StationsView stations={shown} prices={data.prices} services={services ?? []} onChanged={changed} />}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
