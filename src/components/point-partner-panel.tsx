"use client";

import Link from "next/link";
import { useState } from "react";
import { useI18n } from "@/components/i18n-provider";
import { Loaded, PeriodPicker, Section, useXof } from "@/components/owner/shared";
import { Pill } from "@/components/backoffice/shared";
import { stationHref } from "@/components/station-card";
import { CountUp } from "@/components/ui";
import { formatKwh } from "@/lib/charging";
import { useLiveQuery, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { displayStatus } from "@/lib/iot/charging-points";
import type { ReportPeriod } from "@/lib/owner-backoffice";
import { pointsByStation, type PartnerPoint, type PointPartnerDashboard } from "@/lib/point-partners";
import { useApp } from "./app-provider";

const TONE = { free: "green", reserved: "blue", charging: "blue", done: "gray", fault: "red", offline: "red" } as const;

/** The point partner's dashboard (/proprietaire): their sockets, where they are and what they earned. */
export function PointPartnerPanel() {
  const { t } = useI18n();
  const { backend } = useApp();
  const [days, setDays] = useState<ReportPeriod>(30);
  const { data, error, reload } = useLiveQuery(() => backend.pointPartnerDashboard(days), String(days));
  const d = t.pointPartners.dashboard;
  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4 sm:p-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">{d.title}</h1>
        {data && <p className="text-sm font-medium text-gp-forest dark:text-gp-green">{data.partner.name}</p>}
        <p className="mt-1 text-sm text-gp-muted">{d.intro}</p>
      </div>
      <PeriodPicker value={days} onChange={setDays} />
      <Loaded data={data} error={error} reload={reload}>
        {(dash) => <Dashboard dash={dash} />}
      </Loaded>
    </div>
  );
}

function Tile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-black/5 p-3 dark:bg-white/5">
      <dt className="text-xs text-gp-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums sm:text-2xl">{children}</dd>
    </div>
  );
}

function Dashboard({ dash }: { dash: PointPartnerDashboard }) {
  const { t, locale } = useI18n();
  const xof = useXof();
  const d = t.pointPartners.dashboard;
  const now = useNow(30_000);
  const charging = dash.points.filter((p) => displayStatus(p, now) === "charging").length;
  if (!dash.points.length && !dash.totals.charges) {
    return <p className="rounded-2xl border border-dashed border-black/15 p-6 text-center text-sm text-gp-muted dark:border-white/20">{d.empty}</p>;
  }
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={d.points}>
          <CountUp value={dash.points.length} />
        </Tile>
        <Tile label={d.chargingNow}>
          <CountUp value={charging} />
        </Tile>
        <Tile label={d.charges}>
          <CountUp value={dash.totals.charges} />
        </Tile>
        <Tile label={d.energy}>{formatKwh(dash.totals.energyWh, locale)}</Tile>
      </dl>

      <Section title={d.amount}>
        <dl className="divide-y divide-black/5 text-sm dark:divide-white/10">
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-gp-muted">{d.cash}</dt>
            <dd className="tabular-nums">{xof(dash.totals.cashXof)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-gp-muted">{d.app}</dt>
            <dd className="tabular-nums">{xof(dash.totals.appXof)}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3 py-1.5 font-semibold">
            <dt>{t.owner.report.total}</dt>
            <dd className="tabular-nums">
              <CountUp value={dash.totals.amountXof} format={xof} />
            </dd>
          </div>
        </dl>
        <p className="text-xs text-gp-muted">{d.moneyNote}</p>
      </Section>

      <Section title={d.byStation}>
        <div className="space-y-4">
          {pointsByStation(dash.points).map((g) => (
            <div key={g.stationId} className="space-y-2">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-medium">{g.stationName}</h3>
                  {g.stationAddress && <p className="text-xs text-gp-muted">{g.stationAddress}</p>}
                </div>
                <Link href={stationHref(g.stationId)} className="text-sm font-medium text-gp-green-dark hover:underline dark:text-gp-green">
                  {d.onMap}
                </Link>
              </div>
              <ul className="grid gap-2 sm:grid-cols-2">
                {g.points.map((p) => (
                  <PointRow key={p.id} point={p} now={now} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>
      <p className="text-center text-xs text-gp-muted">
        {d.contact}{" "}
        <Link href="/contact" className="underline">
          {t.ui.account.help}
        </Link>
      </p>
    </div>
  );
}

function PointRow({ point, now }: { point: PartnerPoint; now: Date }) {
  const { t, locale } = useI18n();
  const xof = useXof();
  const relativeTime = useRelativeTime();
  const d = t.pointPartners.dashboard;
  const b = t.backoffice.devices;
  const status = displayStatus(point, now);
  return (
    <li className="space-y-1 rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium">
          {b.outlet} {point.outlet} · {point.label}
        </span>
        <Pill tone={TONE[status]}>{b.status[status]}</Pill>
      </div>
      <div className="flex flex-wrap justify-between gap-x-3 text-xs text-gp-muted">
        <span>
          {point.charges === 1 ? d.chargeOne : format(d.chargesCount, { n: point.charges })} · {formatKwh(point.energyWh, locale)}
          {status === "charging" && point.powerWatts ? ` · ${format(d.power, { w: point.powerWatts })}` : ""}
        </span>
        <span className="font-medium text-gp-forest dark:text-zinc-100">{xof(point.amountXof)}</span>
      </div>
      <div className="text-xs text-gp-muted">
        {d.lastSeen} : {point.lastSeenAt ? relativeTime(point.lastSeenAt, now) : d.never}
      </div>
    </li>
  );
}
