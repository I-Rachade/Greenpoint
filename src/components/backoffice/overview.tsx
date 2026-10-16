"use client";

import Link from "next/link";
import type { ComponentType, SVGProps } from "react";
import { useI18n } from "@/components/i18n-provider";
import {
  BoltIcon,
  CalendarCheckIcon,
  CalendarIcon,
  CheckCircleIcon,
  ChevronIcon,
  HelpIcon,
  PlugIcon,
  UsersIcon,
  XCircleIcon,
} from "@/components/icons";
import { computeKpis, findAnomalies, reservationsPerDay, STALE_STATUS_HOURS, type Finding } from "@/lib/admin/insights";
import type { AdminSnapshot } from "@/lib/admin/types";
import { useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { LiteSwitch } from "./lite-switch";
import { indexSnapshot, Loading, Pill, StaleNotice, useAdminSnapshot, userLabel } from "./shared";

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
type Tone = "green" | "amber" | "blue" | "gray" | "red";

/** Background and colour of the small icon tile on each card. */
const ICON_TONE: Record<Tone, string> = {
  green: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  gray: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  red: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
};

const panel = "rounded-gp border border-gp-border bg-white dark:border-white/10 dark:bg-zinc-900";

function Kpi({
  label,
  value,
  detail,
  icon: Icon,
  tone,
  warn,
}: {
  label: string;
  value: string | number;
  detail?: string;
  icon: Icon;
  tone: Tone;
  warn?: boolean;
}) {
  return (
    <div className={`${panel} p-4 ${warn ? "border-amber-300 shadow-[inset_3px_0_0_var(--gp-low)] dark:border-amber-700" : ""}`}>
      <div className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${ICON_TONE[warn ? "amber" : tone]}`}>
          <Icon size={18} />
        </span>
        <span className="text-sm font-medium text-gp-muted">{label}</span>
      </div>
      <div className={`mt-3 font-heading text-3xl font-semibold tabular-nums ${warn ? "text-amber-600 dark:text-amber-400" : ""}`}>{value}</div>
      {detail && <div className="mt-0.5 text-xs text-gp-muted">{detail}</div>}
    </div>
  );
}

const percent = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);

function DayChart({ snap, now }: { snap: AdminSnapshot; now: Date }) {
  const { t, locale } = useI18n();
  const days = reservationsPerDay(snap.reservations, now, 14);
  const max = Math.max(1, ...days.map((d) => d.total));
  const total = days.reduce((sum, d) => sum + d.total, 0);
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return (
    <section className={`${panel} p-5`}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-heading text-base font-semibold">{t.backoffice.chart.title}</h2>
        <span className="font-heading text-2xl font-semibold tabular-nums">{total}</span>
      </div>
      <div className="mt-4 flex h-40 items-end gap-1.5" role="img" aria-label={t.backoffice.chart.title}>
        {days.map((d) => {
          const other = d.total - d.completed - d.noShows;
          const title = `${d.day}: ${d.total} (${t.backoffice.chart.completed} ${d.completed}, ${t.backoffice.chart.noShows} ${d.noShows})`;
          return (
            <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={title}>
              {d.total > 0 ? (
                <div className="flex w-full flex-col justify-end overflow-hidden rounded-md" style={{ height: `${(d.total / max) * 100}%` }}>
                  <div className="bg-red-400" style={{ flexGrow: d.noShows }} />
                  <div className="bg-zinc-300 dark:bg-zinc-600" style={{ flexGrow: other }} />
                  <div className="bg-gp-green" style={{ flexGrow: d.completed }} />
                </div>
              ) : (
                <div className="h-1 w-full rounded-full bg-zinc-200 dark:bg-zinc-700" />
              )}
              <span className="text-[10px] text-gp-muted">{weekday.format(new Date(`${d.day}T12:00:00`))}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-gp-muted">
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-gp-green" />{t.backoffice.chart.completed}</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />{t.backoffice.chart.other}</span>
        <span><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-red-400" />{t.backoffice.chart.noShows}</span>
      </div>
    </section>
  );
}

const SEVERITY_TONE = { high: "red", medium: "amber", low: "blue" } as const;
const SEVERITY_DOT = { high: "bg-gp-closed", medium: "bg-gp-low", low: "bg-gp-info" } as const;

function FindingRow({ finding, snap }: { finding: Finding; snap: AdminSnapshot }) {
  const { t } = useI18n();
  const idx = indexSnapshot(snap);
  const text = format(t.backoffice.findings[finding.kind], {
    station: idx.stationName(finding.stationId),
    user: userLabel(idx.user(finding.userId), finding.userId?.slice(0, 8)),
    n: finding.count ?? 0,
  });
  const href = finding.userId ? "/admin/users" : finding.stationId ? "/admin/stations" : "/admin/reservations";
  return (
    <li>
      <Link href={href} className="group flex items-center gap-3 rounded-lg px-2 py-3 hover:bg-gp-green/5">
        <span className={`h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[finding.severity]}`} aria-hidden />
        <span className="flex-1 text-sm">{text}</span>
        <Pill tone={SEVERITY_TONE[finding.severity]}>{t.backoffice.findings.severity[finding.severity]}</Pill>
        <ChevronIcon size={16} className="shrink-0 text-zinc-400 group-hover:text-gp-green-dark" />
      </Link>
    </li>
  );
}

function Findings({ findings, snap }: { findings: Finding[]; snap: AdminSnapshot }) {
  const { t } = useI18n();
  const f = t.backoffice.findings;
  const counts = (["high", "medium", "low"] as const)
    .map((s) => ({ s, n: findings.filter((x) => x.severity === s).length }))
    .filter((c) => c.n > 0);
  return (
    <section className={`${panel} p-5`}>
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-1 font-heading text-base font-semibold">{f.title}</h2>
        {counts.map(({ s, n }) => (
          <Pill key={s} tone={SEVERITY_TONE[s]}>
            {n} {f.severity[s]}
          </Pill>
        ))}
      </div>
      {findings.length === 0 ? (
        <p className="flex items-center gap-2 py-3 text-sm text-gp-muted">
          <CheckCircleIcon size={18} className="text-gp-green-dark dark:text-gp-green" />
          {f.none}
        </p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/5">
          {findings.map((x, i) => (
            <FindingRow key={`${x.kind}-${x.stationId}-${x.userId}-${i}`} finding={x} snap={snap} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function AdminOverview() {
  const { t } = useI18n();
  const now = useNow(30_000);
  const { data: snap, error, reload } = useAdminSnapshot();
  if (!snap) return <Loading error={error} onRetry={reload} />;

  const k = computeKpis(snap, now);
  const findings = findAnomalies(snap, now);
  const b = t.backoffice;

  return (
    <div className="space-y-5">
      <StaleNotice error={error} onRetry={reload} />
      <div>
        <div className="text-xs font-medium text-gp-muted">
          {b.navGroups.operations} / {b.nav.overview}
        </div>
        <h1 className="font-heading text-2xl font-semibold">{b.title}</h1>
      </div>
      <LiteSwitch />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Kpi
          label={b.kpi.stations}
          value={k.stationsActive}
          detail={format(b.kpi.stationsDetail, { open: k.stationsOpen, inactive: k.stationsInactive })}
          icon={BoltIcon}
          tone="green"
        />
        <Kpi
          label={b.kpi.stale}
          value={k.stationsStale}
          detail={format(b.kpi.staleDetail, { h: STALE_STATUS_HOURS })}
          icon={HelpIcon}
          tone="gray"
          warn={k.stationsStale > 0}
        />
        <Kpi label={b.kpi.holding} value={k.holdingNow} icon={CalendarIcon} tone="blue" />
        <Kpi
          label={b.kpi.reservations}
          value={k.reservations7d}
          detail={format(b.kpi.reservationsDetail, { today: k.reservations24h })}
          icon={CalendarCheckIcon}
          tone="blue"
        />
        <Kpi label={b.kpi.completion} value={percent(k.completionRate7d)} icon={CheckCircleIcon} tone="green" />
        <Kpi
          label={b.kpi.noShow}
          value={percent(k.noShowRate7d)}
          icon={XCircleIcon}
          tone="gray"
          warn={(k.noShowRate7d ?? 0) > 0.2}
        />
        <Kpi
          label={b.kpi.users}
          value={k.usersTotal}
          detail={format(b.kpi.usersDetail, { new: k.usersNew7d, active: k.usersActive7d })}
          icon={UsersIcon}
          tone="green"
        />
        <Kpi
          label={b.kpi.devices}
          value={k.connectedPoints}
          detail={format(b.kpi.devicesDetail, { silent: k.silentPoints })}
          icon={PlugIcon}
          tone="green"
          warn={k.silentPoints > 0}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Findings findings={findings} snap={snap} />
        <div className="space-y-4">
          <DayChart snap={snap} now={now} />
          <section className={`${panel} p-5`}>
            <h2 className="mb-3 font-heading text-base font-semibold">{b.kpi.users}</h2>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(k.usersByRole) as (keyof typeof k.usersByRole)[]).map((role) => (
                <Pill key={role} tone="gray">
                  {t.roles[role]} : {k.usersByRole[role]}
                </Pill>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
