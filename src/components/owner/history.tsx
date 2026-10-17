"use client";

import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { EmptyState } from "@/components/ui";
import { useLiveQuery } from "@/lib/hooks";
import type { ReportPeriod } from "@/lib/owner-backoffice";
import type { BatteryEventView, SwapEntry } from "@/lib/station-work";
import { Loaded, ResponsiveRows, Section, useWhen, useXof } from "./shared";

/** Swap log and counter history of one station over the period (owners and admins only). */
export function HistoryView({ stationId, days }: { stationId: string | null; days: ReportPeriod }) {
  const { t } = useI18n();
  if (!stationId) return <EmptyState text={t.owner.history.pickStation} />;
  return (
    <div className="space-y-4">
      <Swaps stationId={stationId} days={days} />
      <CounterHistory stationId={stationId} days={days} />
    </div>
  );
}

function Swaps({ stationId, days }: { stationId: string; days: ReportPeriod }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useWhen();
  const xof = useXof();
  const h = t.owner.history;
  const w = t.work.swap;
  const { data, error, reload } = useLiveQuery(() => backend.stationSwaps(stationId, { days }), `${stationId}:${days}`);
  return (
    <Section title={h.swaps}>
      <Loaded data={data} error={error} reload={reload}>
        {(swaps) =>
          swaps.length === 0 ? (
            <p className="text-sm text-gp-muted">{h.noSwaps}</p>
          ) : (
            <ResponsiveRows<SwapEntry>
              rows={swaps}
              rowKey={(s) => s.id}
              card={(s) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{w.customerTypes[s.customerType]}</span>
                    <span className="tabular-nums">{xof(s.amountXof)}</span>
                  </div>
                  <div className="text-gp-muted">
                    {[s.customer ?? s.driver, w.payments[s.payment], s.batteryTypeLabel].filter(Boolean).join(" · ")}
                  </div>
                  <div className="text-xs tabular-nums text-gp-muted">
                    {when(s.createdAt)} · {s.person}
                  </div>
                </div>
              )}
              columns={[
                { label: h.when, cell: (s) => <span className="whitespace-nowrap tabular-nums">{when(s.createdAt)}</span> },
                { label: h.type, cell: (s) => w.customerTypes[s.customerType] },
                { label: h.customer, cell: (s) => s.customer ?? s.driver ?? "–" },
                { label: h.payment, cell: (s) => w.payments[s.payment] },
                { label: h.amount, cell: (s) => xof(s.amountXof), className: "text-right tabular-nums whitespace-nowrap" },
                { label: h.person, cell: (s) => s.person },
              ]}
            />
          )
        }
      </Loaded>
    </Section>
  );
}

function CounterHistory({ stationId, days }: { stationId: string; days: ReportPeriod }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const when = useWhen();
  const h = t.owner.history;
  const events = t.work.counter.events;
  const { data, error, reload } = useLiveQuery(() => backend.stationBatteryEvents(stationId, days), `${stationId}:${days}`);
  const delta = (e: BatteryEventView) => (e.delta > 0 ? `+${e.delta}` : String(e.delta));
  return (
    <Section title={h.counter}>
      <Loaded data={data} error={error} reload={reload}>
        {(rows) =>
          rows.length === 0 ? (
            <p className="text-sm text-gp-muted">{h.noEvents}</p>
          ) : (
            <ResponsiveRows<BatteryEventView>
              rows={rows}
              rowKey={(e) => e.id}
              card={(e) => (
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{events[e.type]}</span>
                    <span className="tabular-nums">{delta(e)}</span>
                  </div>
                  {e.reason && <div className="text-gp-muted">{e.reason}</div>}
                  <div className="text-xs tabular-nums text-gp-muted">
                    {when(e.createdAt)} · {e.person} · {h.after} {e.fullAfter}
                  </div>
                </div>
              )}
              columns={[
                { label: h.when, cell: (e) => <span className="whitespace-nowrap tabular-nums">{when(e.createdAt)}</span> },
                { label: h.type, cell: (e) => events[e.type] },
                { label: h.change, cell: delta, className: "text-right tabular-nums" },
                { label: h.after, cell: (e) => e.fullAfter, className: "text-right tabular-nums" },
                { label: h.reason, cell: (e) => e.reason ?? "–" },
                { label: h.person, cell: (e) => e.person },
              ]}
            />
          )
        }
      </Loaded>
    </Section>
  );
}
