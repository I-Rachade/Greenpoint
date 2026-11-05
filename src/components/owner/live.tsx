"use client";

import type { ComponentType, SVGProps } from "react";
import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { BoxInIcon, BoxOutIcon, ScooterIcon, TicketIcon, TruckIcon } from "@/components/icons";
import { Badge, Countdown, EmptyState } from "@/components/ui";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Handover, OwnerLive } from "@shared/owner-backoffice";
import { Loaded, ResponsiveRows, Section, useWhen, useXof } from "./shared";

/** What goes on now: reservations holding, drivers in line, runs, parcels waiting, recent handovers. */
export function LiveView({ stationId, stationName }: { stationId: string | null; stationName: (id: string) => string }) {
  const { backend } = useApp();
  const { data, error, reload } = useLiveQuery(() => backend.ownerLive(stationId), stationId ?? "");
  return (
    <Loaded data={data} error={error} reload={reload}>
      {(live) => <LiveContent live={live} stationName={stationName} many={!stationId} />}
    </Loaded>
  );
}

type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;

const ICON_TONE = {
  green: "bg-gp-green/15 text-gp-green-dark dark:text-gp-green",
  amber: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  blue: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  gray: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
} as const;

/** One live counter: icon tile, number, label (and what it counts, for the parcel ones). */
function Counter({ icon: Icon, tone, value, label, of }: { icon: Icon; tone: keyof typeof ICON_TONE; value: number; label: string; of?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-gp-border bg-gp-surface p-3 sm:p-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${ICON_TONE[tone]}`}>
        <Icon size={20} />
      </span>
      <div className="min-w-0">
        <div className="font-heading text-2xl font-semibold leading-none tabular-nums">{value}</div>
        <div className="mt-1 text-xs leading-tight text-gp-muted">
          {of && <span className="block">{of}</span>}
          {label}
        </div>
      </div>
    </div>
  );
}

function LiveContent({ live, stationName, many }: { live: OwnerLive; stationName: (id: string) => string; many: boolean }) {
  const { t } = useI18n();
  const l = t.owner.live;
  const when = useWhen();
  const xof = useXof();
  const at = (id: string) => (many ? ` · ${stationName(id)}` : "");

  const sum = (k: "toSend" | "incoming" | "toPickUp") => live.parcels.reduce((n, p) => n + p[k], 0);
  const busy = (p: (typeof live.parcels)[number]) => p.toSend + p.incoming + p.toPickUp;
  // Stations with parcels first; the order of the rest stays as the server sends it.
  const parcels = [...live.parcels].sort((a, b) => Number(busy(b) > 0) - Number(busy(a) > 0));
  const count = (n: number) => <span className={n ? "font-semibold" : "text-zinc-300 dark:text-zinc-600"}>{n}</span>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Counter icon={TicketIcon} tone="blue" value={live.reservations.length} label={l.reservations} />
        <Counter icon={ScooterIcon} tone="amber" value={live.drivers.length} label={l.drivers} />
        <Counter icon={TruckIcon} tone="blue" value={live.runs.length} label={l.runs} />
        <Counter icon={BoxOutIcon} tone="green" value={sum("toSend")} of={l.parcels} label={l.toSend} />
        <Counter icon={TruckIcon} tone="gray" value={sum("incoming")} of={l.parcels} label={l.incoming} />
        <Counter icon={BoxInIcon} tone="green" value={sum("toPickUp")} of={l.parcels} label={l.toPickUp} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <div className="min-w-0 space-y-4">
          <Section title={l.parcels}>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gp-border text-left text-xs uppercase tracking-wide text-gp-muted">
                    {many && <th className="px-2 py-2 font-medium">{t.owner.station}</th>}
                    <th className="px-2 py-2 text-right font-medium">{l.toSend}</th>
                    <th className="px-2 py-2 text-right font-medium">{l.incoming}</th>
                    <th className="px-2 py-2 text-right font-medium">{l.toPickUp}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-black/5 dark:divide-white/10">
                  {parcels.map((p) => (
                    <tr key={p.stationId}>
                      {many && <td className="px-2 py-2.5">{stationName(p.stationId)}</td>}
                      <td className="px-2 py-2.5 text-right tabular-nums">{count(p.toSend)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{count(p.incoming)}</td>
                      <td className="px-2 py-2.5 text-right tabular-nums">{count(p.toPickUp)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
          <Section title={l.handovers}>
            {live.handovers.length === 0 ? (
              <EmptyState className="mt-2" text={l.noHandovers} />
            ) : (
              <ResponsiveRows<Handover>
                rows={live.handovers}
                rowKey={(h) => `${h.at}-${h.kind}-${h.parcel ?? h.driver ?? ""}`}
                card={(h) => (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{l.kinds[h.kind]}</span>
                      <span className="text-xs tabular-nums text-gp-muted">{when(h.at)}</span>
                    </div>
                    <div className="text-gp-muted">
                      {[h.parcel, h.driver, h.amountXof !== null ? xof(h.amountXof) : null, many ? stationName(h.stationId) : null].filter(Boolean).join(" · ")}
                    </div>
                    {h.by && <div className="text-xs text-gp-muted">{format(l.by, { person: h.by })}</div>}
                  </div>
                )}
                columns={[
                  { label: t.owner.history.when, cell: (h) => <span className="whitespace-nowrap tabular-nums">{when(h.at)}</span> },
                  { label: t.owner.history.type, cell: (h) => l.kinds[h.kind] },
                  ...(many ? [{ label: t.owner.station, cell: (h: Handover) => stationName(h.stationId) }] : []),
                  { label: l.driver, cell: (h) => h.driver ?? "–" },
                  { label: l.parcel, cell: (h) => h.parcel ?? (h.amountXof !== null ? xof(h.amountXof) : "–") },
                  { label: t.owner.history.person, cell: (h) => h.by ?? "–" },
                ]}
              />
            )}
          </Section>
        </div>
        <div className="min-w-0 space-y-4">
          <Section title={l.reservations} aside={<Badge tone="blue">{live.reservations.length}</Badge>}>
            {live.reservations.length === 0 ? (
              <p className="text-sm text-gp-muted">{l.noReservations}</p>
            ) : (
              <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
                {live.reservations.map((r) => (
                  <li key={r.id} className="flex min-h-11 flex-wrap items-center gap-2 py-2">
                    <span className="flex-1">
                      <span className="font-medium">{r.customer ?? "?"}</span>
                      <span className="text-gp-muted">
                        {" "}
                        · {r.type === "battery" ? t.reservations.battery : t.reservations.slot}
                        {at(r.stationId)}
                      </span>
                    </span>
                    <span className="text-xs text-gp-muted">
                      {l.expires} <Countdown expiresAt={r.expiresAt} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title={l.drivers} aside={<Badge tone="amber">{live.drivers.length}</Badge>}>
            {live.drivers.length === 0 ? (
              <p className="text-sm text-gp-muted">{l.noDrivers}</p>
            ) : (
              <ol className="divide-y divide-black/5 text-sm dark:divide-white/10">
                {live.drivers.map((d, i) => (
                  <li key={`${d.stationId}-${d.since}-${i}`} className="flex min-h-11 items-center gap-2 py-2">
                    <span className="w-6 tabular-nums text-gp-muted">{i + 1}.</span>
                    <span className="flex-1">
                      <span className="font-medium">{d.name}</span>
                      {d.plate && <span className="text-gp-muted"> · {d.plate}</span>}
                      <span className="text-gp-muted">{at(d.stationId)}</span>
                    </span>
                    <span className="text-xs text-gp-muted">{format(l.since, { time: when(d.since) })}</span>
                  </li>
                ))}
              </ol>
            )}
          </Section>

          <Section title={l.runs} aside={<Badge tone="neutral">{live.runs.length}</Badge>}>
            {live.runs.length === 0 ? (
              <p className="text-sm text-gp-muted">{l.noRuns}</p>
            ) : (
              <ul className="divide-y divide-black/5 text-sm dark:divide-white/10">
                {live.runs.map((r) => (
                  <li key={r.id} className="flex min-h-11 flex-wrap items-center gap-2 py-2">
                    <Badge tone={r.status === "under_way" ? "blue" : "amber"}>{l.runStatus[r.status]}</Badge>
                    <span className="flex-1">
                      <span className="font-medium">{r.driver}</span>
                      <span className="text-gp-muted"> · {stationName(r.stationId)}</span>
                    </span>
                    <span className="text-xs text-gp-muted">{format(l.runParcels, { n: r.parcels, incoming: r.incoming })}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}
