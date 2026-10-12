"use client";

import Link from "next/link";
import { useI18n } from "@/components/i18n-provider";
import { computeKpis, findAnomalies, reservationsPerDay, STALE_STATUS_HOURS, type Finding } from "@/lib/admin/insights";
import type { AdminSnapshot } from "@/lib/admin/types";
import { useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { card, indexSnapshot, Loading, Pill, useAdminSnapshot, userLabel } from "./shared";

function Kpi({ label, value, detail, tone }: { label: string; value: string | number; detail?: string; tone?: "warn" }) {
  return (
    <div className={card}>
      <div className="text-xs text-zinc-500">{label}</div>
      <div className={`mt-1 text-3xl font-semibold tabular-nums ${tone === "warn" ? "text-amber-600" : ""}`}>{value}</div>
      {detail && <div className="mt-1 text-xs text-zinc-500">{detail}</div>}
    </div>
  );
}

const percent = (x: number | null) => (x === null ? "–" : `${Math.round(x * 100)} %`);

function DayChart({ snap, now }: { snap: AdminSnapshot; now: Date }) {
  const { t, locale } = useI18n();
  const days = reservationsPerDay(snap.reservations, now, 14);
  const max = Math.max(1, ...days.map((d) => d.total));
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "narrow" });
  return (
    <section className={card}>
      <h2 className="mb-3 text-sm font-semibold">{t.backoffice.chart.title}</h2>
      <div className="flex h-32 items-end gap-1" role="img" aria-label={t.backoffice.chart.title}>
        {days.map((d) => {
          const other = d.total - d.completed - d.noShows;
          const title = `${d.day}: ${d.total} (${t.backoffice.chart.completed} ${d.completed}, ${t.backoffice.chart.noShows} ${d.noShows})`;
          return (
            <div key={d.day} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={title}>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-t" style={{ height: `${(d.total / max) * 100}%` }}>
                <div className="bg-red-400" style={{ flexGrow: d.noShows }} />
                <div className="bg-zinc-300 dark:bg-zinc-600" style={{ flexGrow: other }} />
                <div className="bg-gp-green-dark" style={{ flexGrow: d.completed }} />
              </div>
              <span className="text-[10px] text-zinc-500">{weekday.format(new Date(`${d.day}T12:00:00`))}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-gp-green-dark" />{t.backoffice.chart.completed}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-zinc-300 dark:bg-zinc-600" />{t.backoffice.chart.other}</span>
        <span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-red-400" />{t.backoffice.chart.noShows}</span>
      </div>
    </section>
  );
}

const TONE = { high: "red", medium: "amber", low: "gray" } as const;

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
    <li className="flex items-start gap-3 py-2">
      <Pill tone={TONE[finding.severity]}>{t.backoffice.findings.severity[finding.severity]}</Pill>
      <Link href={href} className="flex-1 text-sm hover:underline">
        {text}
      </Link>
    </li>
  );
}

export function AdminOverview() {
  const { t } = useI18n();
  const now = useNow(30_000);
  const { data: snap, error } = useAdminSnapshot();
  if (!snap) return <Loading error={error} />;

  const k = computeKpis(snap, now);
  const findings = findAnomalies(snap, now);
  const b = t.backoffice;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{b.title}</h1>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi
          label={b.kpi.stations}
          value={k.stationsActive}
          detail={format(b.kpi.stationsDetail, { open: k.stationsOpen, inactive: k.stationsInactive })}
        />
        <Kpi
          label={b.kpi.stale}
          value={k.stationsStale}
          detail={format(b.kpi.staleDetail, { h: STALE_STATUS_HOURS })}
          tone={k.stationsStale ? "warn" : undefined}
        />
        <Kpi label={b.kpi.holding} value={k.holdingNow} />
        <Kpi
          label={b.kpi.reservations}
          value={k.reservations7d}
          detail={format(b.kpi.reservationsDetail, { today: k.reservations24h })}
        />
        <Kpi label={b.kpi.completion} value={percent(k.completionRate7d)} />
        <Kpi label={b.kpi.noShow} value={percent(k.noShowRate7d)} tone={(k.noShowRate7d ?? 0) > 0.2 ? "warn" : undefined} />
        <Kpi
          label={b.kpi.users}
          value={k.usersTotal}
          detail={format(b.kpi.usersDetail, { new: k.usersNew7d, active: k.usersActive7d })}
        />
        <Kpi
          label={b.kpi.devices}
          value={k.connectedPoints}
          detail={format(b.kpi.devicesDetail, { silent: k.silentPoints })}
          tone={k.silentPoints ? "warn" : undefined}
        />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={card}>
          <h2 className="mb-1 text-sm font-semibold">
            {b.findings.title} {findings.length > 0 && <span className="text-zinc-500">({findings.length})</span>}
          </h2>
          {findings.length === 0 ? (
            <p className="py-2 text-sm text-zinc-500">{b.findings.none}</p>
          ) : (
            <ul className="divide-y divide-black/5 dark:divide-white/5">
              {findings.map((f, i) => (
                <FindingRow key={`${f.kind}-${f.stationId}-${f.userId}-${i}`} finding={f} snap={snap} />
              ))}
            </ul>
          )}
        </section>
        <div className="space-y-4">
          <DayChart snap={snap} now={now} />
          <section className={card}>
            <h2 className="mb-2 text-sm font-semibold">{b.kpi.users}</h2>
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
