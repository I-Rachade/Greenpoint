"use client";

import { useState } from "react";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format, formatXof } from "@/lib/i18n/format";
import { STAFF_VEHICLE_STATUSES, type ShareRide, type ShareVehicleStatus } from "@/lib/share";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { ConfirmSheet } from "../confirm-sheet";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { Card, EmptyState, SkeletonCard } from "../ui";
import { WorkShell } from "./work-shell";

const button = "min-h-11 rounded-full bg-gp-green-dark px-4 text-sm font-semibold text-white disabled:opacity-50";
const ghost = "min-h-11 rounded-full border border-black/15 px-3 text-sm dark:border-white/20 disabled:opacity-50";

/**
 * /operator/share: the Share vehicles parked at the station (staff put one on charge or out of
 * service), the rides heading here, the loan helmets, and the rides that ended here to take
 * cash for (worker/share.ts stationShare).
 */
export function SharePage() {
  const { t } = useI18n();
  return <WorkShell title={t.share.staff.title}>{({ station }) => <StationShareView key={station.id} station={station} />}</WorkShell>;
}

function StationShareView({ station }: { station: StationView }) {
  const { t, locale } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const s = t.share;
  const { data, error, reload } = useLiveQuery(() => backend.stationShare(station.id), station.id);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [collect, setCollect] = useState<(ShareRide & { customer: string }) | null>(null);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ ok: true, text: done });
      reload();
    } catch (err) {
      setMessage({ ok: false, text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const xof = (n: number) => formatXof(n, locale);

  return (
    <div className="space-y-4">
      {data.helmets > 0 && <p className="text-sm text-gp-muted">{format(s.staff.helmets, { n: data.helmets })}</p>}
      {message && <p className={`text-sm ${message.ok ? "text-gp-green-dark dark:text-gp-green" : "text-red-600"}`}>{message.text}</p>}

      {data.unpaid.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{s.staff.toCollect}</h2>
          {data.unpaid.map((r) => (
            <Card key={r.id} className="p-4 flex items-center justify-between gap-3">
              <div className="min-w-0 text-sm">
                <div className="font-medium">{r.customer}</div>
                <div className="text-gp-muted">
                  {r.vehicle.name} · {r.fromStationName} → {r.endStationName}
                </div>
              </div>
              <button type="button" className={button} disabled={busy} onClick={() => setCollect(r)}>
                {format(s.staff.collect, { amount: xof(r.amountXof) })}
              </button>
            </Card>
          ))}
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">{s.staff.vehicles}</h2>
        {data.vehicles.length === 0 ? (
          <EmptyState text={s.staff.noVehicles} />
        ) : (
          data.vehicles.map((v) => (
            <Card key={v.id} className="p-4 space-y-2">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">
                  {v.name}
                  {v.plate && <span className="ml-2 text-sm text-gp-muted">{v.plate}</span>}
                </span>
                <span className="text-sm text-gp-muted">
                  {s.vehicleStatus[v.status]}
                  {v.batteryPercent !== null && ` · ${format(s.battery, { n: v.batteryPercent })}`}
                </span>
              </div>
              {STAFF_VEHICLE_STATUSES.includes(v.status) && (
                <div className="flex flex-wrap gap-2">
                  {STAFF_VEHICLE_STATUSES.filter((x) => x !== v.status).map((status: ShareVehicleStatus) => (
                    <button key={status} type="button" className={ghost} disabled={busy} onClick={() => void run(() => backend.setStationShareVehicle(station.id, v.id, status))}>
                      {s.staff.setStatus[status as "available" | "charging" | "maintenance"]}
                    </button>
                  ))}
                </div>
              )}
            </Card>
          ))
        )}
      </section>

      {data.incoming.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-semibold">{s.staff.incoming}</h2>
          {data.incoming.map((r) => (
            <Card key={r.id} className="p-4 text-sm">
              <span className="font-medium">{r.vehicle.name}</span> · {s.status[r.status]}
              {r.status !== "reserved" && ` · ${r.fromStationName}`}
              {r.helmet && " · 🪖"}
            </Card>
          ))}
        </section>
      )}

      <ConfirmSheet
        open={!!collect}
        title={collect ? format(s.staff.collect, { amount: xof(collect.amountXof) }) : ""}
        confirmLabel={collect ? format(s.staff.collect, { amount: xof(collect.amountXof) }) : ""}
        busy={busy}
        onCancel={() => setCollect(null)}
        onConfirm={() => {
          const r = collect!;
          setCollect(null);
          void run(() => backend.payShareCash(station.id, r.id), s.staff.collected);
        }}
      >
        {collect && (
          <p className="text-sm">
            {collect.customer} · {collect.vehicle.name}
          </p>
        )}
      </ConfirmSheet>
    </div>
  );
}
