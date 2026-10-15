"use client";

import { useState, type ReactNode } from "react";
import { useDateTime } from "@/components/backoffice/shared";
import { BUSY_JOB_STATUSES, jobFits, type DeliveryJob } from "@/lib/drivers";
import type { FleetDriver, FleetDriverStats, FleetView } from "@/lib/fleet";
import { useErrorMessage, useLiveQuery } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { input, JobStatusPill, Notice, primary, secondary, useFcfa, useJobRoute } from "./shared";

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-black/10 p-4 dark:border-white/10">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="text-xs text-zinc-500">{hint}</p>}
      {children}
    </section>
  );
}

function DriverCard({ d, stations }: { d: FleetDriver; stations: StationView[] }) {
  const { t } = useI18n();
  const f = t.fleet;
  const fcfa = useFcfa();
  const route = useJobRoute();
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  const where = d.queue ? format(f.inQueue, { station: name(d.queue.stationId), pos: d.queue.position }) : f.notQueued;
  return (
    <li className="space-y-1 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{d.fullName}</span>
        {d.phone && (
          <a href={`tel:${d.phone}`} className="text-gp-green-dark underline">
            {d.phone}
          </a>
        )}
        <span className="flex-1" />
        <span className="text-xs text-zinc-500">
          {d.vehicle ? `${t.drivers.vehicle[d.vehicle.type]} · ${d.vehicle.plate}` : f.noVehicle}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
        {d.status === "suspended" ? <span className="text-red-600">{f.suspended}</span> : !d.job && <span>{`${f.free} · ${where}`}</span>}
        {d.balanceFcfa !== 0 && (
          <span>{d.balanceFcfa > 0 ? format(f.owes, { n: d.balanceFcfa.toLocaleString("fr-FR") }) : format(f.owed, { n: (-d.balanceFcfa).toLocaleString("fr-FR") })}</span>
        )}
      </div>
      {d.job && (
        <div className="flex flex-wrap items-center gap-2">
          <JobStatusPill status={d.job.status} kind={d.job.kind} />
          <span>
            {d.job.trackingNo ? `${d.job.trackingNo} · ` : ""}
            {route(d.job, name)}
          </span>
          <span className="text-xs text-zinc-500">{fcfa(d.job.fareFcfa)}</span>
        </div>
      )}
    </li>
  );
}

function OpenJob({ job, view, stations, onDone }: { job: DeliveryJob; view: FleetView; stations: StationView[]; onDone: (msg: string) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const fcfa = useFcfa();
  const route = useJobRoute();
  const when = useDateTime();
  const [driverId, setDriverId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const name = (id: string | null) => stations.find((s) => s.id === id)?.name ?? "?";
  // Free drivers whose vehicle fits the trip (the asked vehicle type, the seats of a ride, the parcel by size
  // until it is weighed): the same rule as dispatch, and the server checks again.
  const weight = job.weightKg ?? 0;
  const candidates = view.drivers.filter(
    (d) =>
      d.status === "active" &&
      d.vehicle?.isActive &&
      !(d.job && BUSY_JOB_STATUSES.includes(d.job.status)) &&
      jobFits({ ...job, vehicleType: job.vehicleType ?? null, passengers: job.passengers ?? null }, d.vehicle.type, weight, view.settings),
  );

  async function assign() {
    setError("");
    setBusy(true);
    try {
      await backend.fleetAssign(job.id, driverId);
      onDone(t.fleet.assigned);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="space-y-2 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{t.drivers.kind[job.kind]}</span>
        <span>
          {job.size} · {route(job, name)}
        </span>
        <span className="flex-1" />
        <span>{fcfa(job.fareFcfa)}</span>
      </div>
      <div className="text-xs text-zinc-500">{format(t.fleet.since, { time: when(job.createdAt) })}</div>
      {candidates.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <select value={driverId} onChange={(e) => setDriverId(e.target.value)} className={`${input} w-auto`} aria-label={t.fleet.driver}>
            <option value="">{t.fleet.chooseDriver}</option>
            {candidates.map((d) => (
              <option key={d.userId} value={d.userId}>
                {d.fullName} · {t.drivers.vehicle[d.vehicle!.type]}
              </option>
            ))}
          </select>
          <button type="button" className={primary} disabled={!driverId || busy} onClick={() => void assign()}>
            {t.fleet.assign}
          </button>
        </div>
      )}
      <Notice error={error} notice="" />
    </li>
  );
}

function today(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function Stats({ drivers }: { drivers: FleetDriver[] }) {
  const { t } = useI18n();
  const f = t.fleet;
  const { backend } = useApp();
  const fcfa = useFcfa();
  const [from, setFrom] = useState(() => `${today().slice(0, 8)}01`);
  const [to, setTo] = useState(() => today());
  const [period, setPeriod] = useState({ from, to });
  const { data, error } = useLiveQuery(() => backend.fleetStats(period.from, period.to), `${period.from}:${period.to}`);
  const nameOf = (id: string) => drivers.find((d) => d.userId === id)?.fullName ?? "?";
  const rows = data?.drivers ?? [];
  const total = rows.reduce<Omit<FleetDriverStats, "userId">>(
    (s, r) => ({
      tripsDone: s.tripsDone + r.tripsDone,
      tripsFailed: s.tripsFailed + r.tripsFailed,
      fareFcfa: s.fareFcfa + r.fareFcfa,
      earningFcfa: s.earningFcfa + r.earningFcfa,
      collectedFcfa: s.collectedFcfa + r.collectedFcfa,
      settledFcfa: s.settledFcfa + r.settledFcfa,
      batterySwaps: s.batterySwaps + r.batterySwaps,
      chargingSlots: s.chargingSlots + r.chargingSlots,
      chargingPaidFcfa: s.chargingPaidFcfa + r.chargingPaidFcfa,
    }),
    { tripsDone: 0, tripsFailed: 0, fareFcfa: 0, earningFcfa: 0, collectedFcfa: 0, settledFcfa: 0, batterySwaps: 0, chargingSlots: 0, chargingPaidFcfa: 0 },
  );
  const cells = (r: Omit<FleetDriverStats, "userId">) => [
    format(f.tripsValue, { done: r.tripsDone, failed: r.tripsFailed }),
    fcfa(r.fareFcfa),
    fcfa(r.earningFcfa),
    fcfa(r.collectedFcfa),
    fcfa(r.settledFcfa),
    format(f.chargingValue, { swaps: r.batterySwaps, slots: r.chargingSlots }),
    fcfa(r.chargingPaidFcfa),
  ];
  const heads = [f.driver, f.trips, f.fare, f.earning, f.collected, f.settled, f.charging, f.chargingPaid];

  return (
    <Section title={f.stats} hint={f.statsHint}>
      <form
        className="flex flex-wrap items-end gap-2 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          setPeriod({ from, to });
        }}
      >
        <label className="space-y-1">
          <span className="block text-xs text-zinc-500">{f.from}</span>
          <input type="date" required value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={input} />
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-zinc-500">{f.to}</span>
          <input type="date" required value={to} min={from} onChange={(e) => setTo(e.target.value)} className={input} />
        </label>
        <button type="submit" className={secondary}>
          {f.show}
        </button>
      </form>
      {error ? (
        <p className="text-sm text-red-600">{t.errors.unknown}</p>
      ) : !data ? (
        <p className="text-sm text-zinc-500">{t.loading}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                {heads.map((h) => (
                  <th key={h} className="whitespace-nowrap px-2 py-1 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className="border-t border-black/5 dark:border-white/10">
                  <td className="whitespace-nowrap px-2 py-1">{nameOf(r.userId)}</td>
                  {cells(r).map((c, i) => (
                    <td key={i} className="whitespace-nowrap px-2 py-1">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
              {rows.length > 1 && (
                <tr className="border-t border-black/20 font-semibold dark:border-white/20">
                  <td className="px-2 py-1">{f.total}</td>
                  {cells(total).map((c, i) => (
                    <td key={i} className="whitespace-nowrap px-2 py-1">
                      {c}
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}

/** /flotte: a fleet manager's drivers, manual dispatch and figures (src/lib/fleet.ts). */
export function FleetPanel() {
  const { t } = useI18n();
  const { backend } = useApp();
  const errorMessage = useErrorMessage();
  const { data, error, reload } = useLiveQuery(() => Promise.all([backend.fleetView(), backend.listStations()]));
  const [notice, setNotice] = useState("");

  if (error) return <p className="p-6 text-sm text-red-600">{errorMessage(error)}</p>;
  if (!data) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;
  const [view, stations] = data;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.fleet.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.fleet.intro}</p>
      <Section title={t.fleet.drivers}>
        {view.drivers.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.fleet.none}</p>
        ) : (
          <ul className="space-y-2">
            {view.drivers.map((d) => (
              <DriverCard key={d.userId} d={d} stations={stations} />
            ))}
          </ul>
        )}
      </Section>
      <Section title={t.fleet.open} hint={t.fleet.openHint}>
        <Notice error="" notice={notice} />
        {view.openJobs.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.fleet.noOpen}</p>
        ) : (
          <ul className="space-y-2">
            {view.openJobs.map((j) => (
              <OpenJob
                key={j.id}
                job={j}
                view={view}
                stations={stations}
                onDone={(msg) => {
                  setNotice(msg);
                  reload();
                }}
              />
            ))}
          </ul>
        )}
      </Section>
      {view.drivers.length > 0 && <Stats drivers={view.drivers} />}
    </div>
  );
}
