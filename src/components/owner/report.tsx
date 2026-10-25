"use client";

import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { CountUp, useReducedMotion } from "@/components/ui";
import { useLiveQuery } from "@/lib/hooks";
import { byMonth, type DayStats, type OwnerReport, type ReportPeriod, type StaffStats } from "@shared/owner-backoffice";
import { Loaded, ResponsiveRows, Section, useXof } from "./shared";

/** Settlement (W12: cash for poinderecharge apart, never in the revenue) and statistics of the period. */
export function ReportView({ stationId, days }: { stationId: string | null; days: ReportPeriod }) {
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.ownerReport(stationId, days), `${stationId ?? ""}:${days}`);
  return (
    <Loaded data={data} error={error} reload={reload}>
      {(report) => <ReportContent report={report} />}
    </Loaded>
  );
}

function Amount({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) {
  const xof = useXof();
  return (
    <div className={`flex items-baseline justify-between gap-3 py-1.5 ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-gp-muted"}>{label}</dt>
      <dd className="tabular-nums">
        <CountUp value={value} format={xof} />
      </dd>
    </div>
  );
}

function ReportContent({ report }: { report: OwnerReport }) {
  const { t } = useI18n();
  const r = t.owner.report;
  const { revenue, poinderecharge: pdr } = report;
  const rows = report.days === 365 ? byMonth(report.perDay) : report.perDay;
  const totals = report.perDay.reduce((a, d) => ({ swaps: a.swaps + d.swaps, charges: a.charges + d.charges, parcels: a.parcels + d.parcels }), { swaps: 0, charges: 0, parcels: 0 });

  return (
    <div className="space-y-4">
      <Section title={r.revenue}>
        <dl className="divide-y divide-black/5 text-sm dark:divide-white/10">
          <Amount label={r.swapCash} value={revenue.swapCashXof} />
          <Amount label={r.chargeCash} value={revenue.chargeCashXof} />
          <Amount label={r.cash} value={revenue.cashXof} strong />
          <Amount label={r.swapApp} value={revenue.swapAppXof} />
          <Amount label={r.chargeApp} value={revenue.chargeAppXof} />
          <Amount label={r.swapFleet} value={revenue.swapFleetXof} />
          <Amount label={r.total} value={revenue.totalXof} strong />
        </dl>
        <p className="text-xs text-gp-muted">{r.appNote}</p>
      </Section>

      {/* W12: kept apart from the revenue above, settled outside the app. */}
      <section aria-labelledby="w12-title" className="space-y-2 rounded-2xl border-2 border-dashed border-amber-400/70 bg-amber-50 p-4 dark:bg-amber-900/20">
        <h2 id="w12-title" className="font-heading text-lg font-semibold">
          {r.forPoinderecharge}
        </h2>
        <dl className="divide-y divide-black/5 text-sm dark:divide-white/10">
          <Amount label={r.parcels} value={pdr.parcelsXof} />
          <Amount label={r.drivers} value={pdr.driversXof} />
          {pdr.thirdParty && <Amount label={r.chargesHosted} value={pdr.chargesXof} />}
          {pdr.thirdParty && pdr.swapsXof > 0 && <Amount label={r.swapsHosted} value={pdr.swapsXof} />}
          {pdr.thirdParty && pdr.cardsXof > 0 && <Amount label={r.cardsTopped} value={pdr.cardsXof} />}
          {pdr.thirdParty && pdr.creditXof > 0 && <Amount label={r.creditTopped} value={pdr.creditXof} />}
          <Amount label={r.total} value={pdr.totalXof} strong />
        </dl>
        <p className="text-xs text-amber-900 dark:text-amber-100">{pdr.thirdParty ? r.forNoteThirdParty : r.forNote}</p>
      </section>

      <Section title={r.stats}>
        <dl className="grid grid-cols-3 gap-2 text-center">
          {(
            [
              [r.swaps, totals.swaps],
              [r.charges, totals.charges],
              [r.parcelsCount, totals.parcels],
            ] as const
          ).map(([label, n]) => (
            <div key={label} className="rounded-xl bg-black/5 p-2 dark:bg-white/5">
              <dt className="text-xs text-gp-muted">{label}</dt>
              <dd className="text-2xl font-semibold">
                <CountUp value={n} />
              </dd>
            </div>
          ))}
        </dl>
        <h3 className="text-sm font-medium">{report.days === 365 ? r.perMonth : r.perDay}</h3>
        <DayChart rows={rows} monthly={report.days === 365} />
        <h3 className="text-sm font-medium">{r.peak}</h3>
        <p className="text-xs text-gp-muted">{r.peakHint}</p>
        <HourChart hours={report.hours} />
      </Section>

      <Section title={r.staff}>
        {report.staff.length === 0 ? (
          <p className="text-sm text-gp-muted">{r.noActivity}</p>
        ) : (
          <ResponsiveRows<StaffStats>
            rows={report.staff}
            rowKey={(p) => p.personId}
            card={(p) => (
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{p.person}</span>
                  <span className="text-xs text-gp-muted">{r.roles[p.role]}</span>
                </div>
                <div className="text-gp-muted tabular-nums">
                  {r.swaps} {p.swaps} · {r.charges} {p.charges} · {r.actions} {p.actions}
                </div>
              </div>
            )}
            columns={[
              { label: t.owner.history.person, cell: (p) => p.person },
              { label: r.role, cell: (p) => r.roles[p.role] },
              { label: r.swaps, cell: (p) => p.swaps, className: "text-right tabular-nums" },
              { label: r.charges, cell: (p) => p.charges, className: "text-right tabular-nums" },
              { label: r.actions, cell: (p) => p.actions, className: "text-right tabular-nums" },
            ]}
          />
        )}
      </Section>
    </div>
  );
}

/** Swaps and charges per day (or month): stacked bars, with the numbers for screen readers. */
function DayChart({ rows, monthly }: { rows: DayStats[]; monthly: boolean }) {
  const { t, locale } = useI18n();
  const reduced = useReducedMotion();
  const max = Math.max(1, ...rows.map((d) => d.swaps + d.charges));
  const label = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", monthly ? { month: "short", timeZone: "UTC" } : { day: "2-digit", month: "2-digit", timeZone: "UTC" });
  const dateOf = (day: string) => new Date(monthly ? `${day}-01T00:00:00Z` : `${day}T00:00:00Z`);
  const every = rows.length > 14 ? Math.ceil(rows.length / 7) : 1;
  return (
    <figure className="space-y-1">
      <div className="flex h-32 items-end gap-px" aria-hidden>
        {rows.map((d) => (
          <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${label.format(dateOf(d.day))}: ${d.swaps} / ${d.charges}`}>
            <div className={`bg-gp-info/70 ${reduced ? "" : "transition-[height] duration-300"}`} style={{ height: `${(d.charges / max) * 100}%` }} />
            <div className={`rounded-t-sm bg-gp-green-dark ${reduced ? "" : "transition-[height] duration-300"}`} style={{ height: `${(d.swaps / max) * 100}%` }} />
          </div>
        ))}
      </div>
      <div className="flex gap-px text-[10px] text-gp-muted" aria-hidden>
        {rows.map((d, i) => (
          <span key={d.day} className="min-w-0 flex-1 truncate text-center">
            {i % every === 0 ? label.format(dateOf(d.day)) : ""}
          </span>
        ))}
      </div>
      <figcaption className="flex gap-4 text-xs text-gp-muted">
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-gp-green-dark" aria-hidden /> {t.owner.report.swaps}
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="h-2.5 w-2.5 rounded-sm bg-gp-info/70" aria-hidden /> {t.owner.report.charges}
        </span>
      </figcaption>
      <table className="sr-only">
        <tbody>
          {rows.map((d) => (
            <tr key={d.day}>
              <th>{label.format(dateOf(d.day))}</th>
              <td>
                {t.owner.report.swaps} {d.swaps}, {t.owner.report.charges} {d.charges}, {t.owner.report.parcelsCount} {d.parcels}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

/** Peak hours: swaps and charges per hour of the day. */
function HourChart({ hours }: { hours: number[] }) {
  const reduced = useReducedMotion();
  const max = Math.max(1, ...hours);
  const peak = hours.indexOf(Math.max(...hours));
  return (
    <figure>
      <div className="flex h-20 items-end gap-px" aria-hidden>
        {hours.map((n, h) => (
          <div
            key={h}
            className={`min-w-0 flex-1 rounded-t-sm ${h === peak && n > 0 ? "bg-gp-green-dark" : "bg-gp-green/40"} ${reduced ? "" : "transition-[height] duration-300"}`}
            style={{ height: `${(n / max) * 100}%` }}
            title={`${h}h: ${n}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gp-muted" aria-hidden>
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
      <table className="sr-only">
        <tbody>
          {hours.map((n, h) => (
            <tr key={h}>
              <th>{h}h</th>
              <td>{n}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
