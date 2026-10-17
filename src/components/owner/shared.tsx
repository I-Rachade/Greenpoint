"use client";

import type { ReactNode } from "react";
import { useI18n } from "@/components/i18n-provider";
import { LoadFailed, StaleNotice } from "@/components/load-state";
import { Card, SkeletonCard } from "@/components/ui";
import { formatXof } from "@/lib/i18n/format";
import type { ReportPeriod } from "@/lib/owner-backoffice";
import { REPORT_PERIODS } from "@/lib/owner-backoffice";

/** "25 000 FCFA" in the viewer's language. */
export function useXof() {
  const { locale } = useI18n();
  return (n: number) => formatXof(n, locale);
}

/** Day, month and time, as on the station screens. */
export function useWhen() {
  const { locale } = useI18n();
  const fmt = new Intl.DateTimeFormat(locale === "fr" ? "fr-TG" : "en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return (iso: string) => fmt.format(new Date(iso));
}

/** A titled block of the backoffice. */
export function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <Card className="space-y-3 p-4 shadow-none sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-heading text-base font-semibold">{title}</h2>
        {aside}
      </div>
      {children}
    </Card>
  );
}

/** Before the first answer: placeholders or what went wrong; afterwards a notice when a refresh fails. */
export function Loaded<T>({ data, error, reload, children }: { data: T | null; error: unknown; reload: () => void; children: (data: T) => ReactNode }) {
  if (!data) {
    return error ? (
      <LoadFailed error={error} onRetry={reload} />
    ) : (
      <div className="space-y-3" aria-busy>
        <SkeletonCard />
        <SkeletonCard />
      </div>
    );
  }
  return (
    <>
      <StaleNotice error={error} onRetry={reload} />
      {children(data)}
    </>
  );
}

/** Rows as cards on phones and as a table from md up ("tables become cards on phones"). */
export function ResponsiveRows<T>({
  rows,
  columns,
  card,
  rowKey,
}: {
  rows: T[];
  columns: { label: string; cell: (row: T) => ReactNode; className?: string }[];
  card: (row: T) => ReactNode;
  rowKey: (row: T) => string;
}) {
  return (
    <>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li key={rowKey(r)} className="rounded-xl border border-gp-border p-3 text-sm">
            {card(r)}
          </li>
        ))}
      </ul>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gp-border text-left text-xs uppercase tracking-wide text-gp-muted">
              {columns.map((c) => (
                <th key={c.label} className={`px-2 py-2 font-medium ${c.className ?? ""}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5 dark:divide-white/10">
            {rows.map((r) => (
              <tr key={rowKey(r)}>
                {columns.map((c) => (
                  <td key={c.label} className={`px-2 py-2 align-top ${c.className ?? ""}`}>
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** Today, 7 days, 30 days, 12 months. */
export function PeriodPicker({ value, onChange }: { value: ReportPeriod; onChange: (days: ReportPeriod) => void }) {
  const { t } = useI18n();
  const names: Record<ReportPeriod, string> = { 1: t.owner.periods.today, 7: t.owner.periods.week, 30: t.owner.periods.month, 365: t.owner.periods.year };
  return (
    <div role="radiogroup" aria-label={t.owner.period} className="inline-flex flex-wrap gap-1 rounded-full bg-black/5 p-1 dark:bg-white/10">
      {REPORT_PERIODS.map((d) => (
        <button
          key={d}
          type="button"
          role="radio"
          aria-checked={value === d}
          onClick={() => onChange(d)}
          className={`min-h-10 rounded-full px-4 text-sm font-semibold ${
            value === d ? "bg-gp-surface text-gp-forest shadow-sm dark:text-white" : "text-gp-muted hover:text-gp-forest dark:hover:text-white"
          }`}
        >
          {names[d]}
        </button>
      ))}
    </div>
  );
}
