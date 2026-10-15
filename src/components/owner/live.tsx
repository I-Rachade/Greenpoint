"use client";

import { useApp } from "@/components/app-provider";
import { useI18n } from "@/components/i18n-provider";
import { Badge, Countdown, EmptyState } from "@/components/ui";
import { useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Handover, OwnerLive } from "@/lib/owner-backoffice";
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

function LiveContent({ live, stationName, many }: { live: OwnerLive; stationName: (id: string) => string; many: boolean }) {
  const { t } = useI18n();
  const l = t.owner.live;
  const when = useWhen();
  const xof = useXof();
  const at = (id: string) => (many ? ` · ${stationName(id)}` : "");

  return (
    <div className="space-y-4">
      <Section title={l.parcels}>
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {live.parcels.map((p) => (
            <li key={p.stationId} className="rounded-xl border border-gp-border p-3 text-sm">
              {many && <div className="mb-1 font-medium">{stationName(p.stationId)}</div>}
              <dl className="grid grid-cols-3 gap-2 text-center">
                {(
                  [
                    [l.toSend, p.toSend],
                    [l.incoming, p.incoming],
                    [l.toPickUp, p.toPickUp],
                  ] as const
                ).map(([label, n]) => (
                  <div key={label}>
                    <dt className="text-xs text-gp-muted">{label}</dt>
                    <dd className="text-xl font-semibold tabular-nums">{n}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </Section>

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

      <Section title={l.drivers} aside={<Badge tone="neutral">{live.drivers.length}</Badge>}>
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

      <Section title={l.runs}>
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
  );
}
