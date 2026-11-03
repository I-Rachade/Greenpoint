"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useLiveQuery } from "@/lib/hooks";
import type { StationService } from "@shared/station-services";
import type { StationRole } from "@shared/station-work";
import type { StationView } from "@shared/types";
import { useApp } from "../app-provider";
import { BackIcon, ChevronIcon, StoreIcon } from "../icons";
import { useI18n } from "../i18n-provider";
import { LoadFailed, StaleNotice } from "../load-state";
import { Badge, EmptyState, SkeletonCard } from "../ui";
import { useActiveStation } from "./use-active-station";

export interface WorkContext {
  station: StationView;
  role: StationRole;
  /** Every station the person works at (several: owners, admins). */
  stations: StationView[];
  reload: () => void;
}

/** The person's stations and the one chosen on this device; a single station is chosen by itself. */
export function useWorkStation() {
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.staffStations());
  const [activeId, setActive] = useActiveStation();
  const only = data?.length === 1 ? data[0].id : null;
  useEffect(() => {
    if (only && activeId !== only) setActive(only);
  }, [only, activeId, setActive]);
  const station = data?.find((s) => s.id === activeId) ?? null;
  return { stations: data, station, error, reload, setActive };
}

export function RoleBadge({ role }: { role: StationRole }) {
  const { t } = useI18n();
  return <Badge tone={role === "admin" ? "blue" : role === "owner" ? "amber" : "neutral"}>{t.work.roles[role]}</Badge>;
}

/** Owners and admins pick the station they work at before any station action (W3, W4). */
export function StationPicker({ stations, onPick }: { stations: StationView[]; onPick: (id: string) => void }) {
  const { t } = useI18n();
  return (
    <section className="space-y-3">
      <h1 className="font-heading text-2xl font-semibold">{t.work.pickTitle}</h1>
      <p className="text-sm text-gp-muted">{t.work.pickIntro}</p>
      <ul className="space-y-2">
        {stations.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onPick(s.id)}
              className="flex min-h-16 w-full items-center gap-3 rounded-2xl border border-gp-border bg-gp-surface p-4 text-left shadow-sm active:scale-[0.99]"
            >
              <StoreIcon size={28} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{s.name}</span>
                {s.address && <span className="block truncate text-sm text-gp-muted">{s.address}</span>}
              </span>
              {s.myRole && <RoleBadge role={s.myRole} />}
              <ChevronIcon size={20} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Frame of every station page (/operator and its service pages): loads the person's
 * stations, asks for the active station first, shows it with the person's role and,
 * on a service page, only renders while that service is active at the station.
 */
export function WorkShell({
  title,
  services,
  home = false,
  children,
}: {
  title?: string;
  /** The page needs one of these services active at the station. */
  services?: StationService[];
  /** The station home has no back link. */
  home?: boolean;
  children: (ctx: WorkContext) => ReactNode;
}) {
  const { t } = useI18n();
  const { stations, station, error, reload, setActive } = useWorkStation();

  let body: ReactNode;
  if (!stations) {
    body = error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  } else if (stations.length === 0) {
    body = <EmptyState icon={<StoreIcon size={32} />} text={t.operator.noStations} />;
  } else if (!station) {
    body = <StationPicker stations={stations} onPick={setActive} />;
  } else {
    const role = station.myRole ?? "staff";
    const active = station.activeServices ?? [];
    body = (
      <>
        <StaleNotice error={error} onRetry={reload} />
        <div className="flex flex-wrap items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-gp-muted">{station.name}</span>
          <RoleBadge role={role} />
          {stations.length > 1 && (
            <button type="button" onClick={() => setActive(null)} className="min-h-11 rounded-full px-3 text-sm font-semibold text-gp-green-dark dark:text-gp-green">
              {t.work.change}
            </button>
          )}
        </div>
        {title && <h1 className="font-heading text-2xl font-semibold">{title}</h1>}
        {services && !services.some((s) => active.includes(s)) ? (
          <EmptyState text={t.work.serviceOff} />
        ) : (
          children({ station, role, stations, reload })
        )}
      </>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-4 sm:p-6">
      {!home && (
        <Link href="/operator" className="-ml-1 inline-flex min-h-11 items-center gap-1 text-sm text-gp-green-dark dark:text-gp-green">
          <BackIcon size={18} />
          {t.operator.back}
        </Link>
      )}
      {body}
    </div>
  );
}
