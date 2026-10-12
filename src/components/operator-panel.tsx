"use client";

import { useState } from "react";
import { offersCharging, offersSwap } from "@/lib/availability";
import { useErrorMessage, useLiveQuery, useNow, useRelativeTime } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Reservation, StationView } from "@/lib/types";
import { useApp } from "./app-provider";
import { useI18n } from "./i18n-provider";
import { effectiveStatus, minutesLeft } from "./reservation-list";

function Counter({
  label,
  value,
  max,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const { t } = useI18n();
  const button =
    "grid h-14 w-14 place-items-center rounded-full bg-gp-green-dark text-3xl font-bold text-white active:scale-95 disabled:opacity-30";
  return (
    <div className="rounded-xl border border-black/10 p-4 dark:border-white/10">
      <div className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">{label}</div>
      <div className="flex items-center justify-between gap-4">
        <button type="button" className={button} onClick={() => onChange(value - 1)} disabled={value <= 0} aria-label="-1">
          −
        </button>
        <div className="text-center">
          <div className="text-4xl font-bold tabular-nums">{value}</div>
          <div className="text-xs text-zinc-500">{format(t.operator.capacity, { n: max })}</div>
        </div>
        <button type="button" className={button} onClick={() => onChange(value + 1)} disabled={value >= max} aria-label="+1">
          +
        </button>
      </div>
    </div>
  );
}

/** One active reservation: staff type the rider's pickup code to complete it. */
function ReservationRow({
  reservation: r,
  now,
  onComplete,
}: {
  reservation: Reservation;
  now: Date;
  onComplete: (code: string) => Promise<boolean>;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState("");
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg bg-zinc-100 p-3 text-sm dark:bg-zinc-900">
      <span className="flex-1">
        {r.type === "battery" ? t.reservations.battery : t.reservations.slot} ·{" "}
        {format(t.time.minutesLeft, { n: minutesLeft(r, now) })}
      </span>
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void onComplete(code).then((ok) => ok && setCode(""));
        }}
      >
        <input
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="0000"
          aria-label={t.operator.pickupCode}
          className="w-20 rounded-lg border border-black/20 bg-white px-2 py-1 text-center font-mono tracking-widest dark:border-white/20 dark:bg-zinc-950"
        />
        <button type="submit" className="rounded-full bg-gp-green-dark px-3 py-1 text-white">
          {t.operator.complete}
        </button>
      </form>
    </li>
  );
}

function StationControls({ station, onError }: { station: StationView; onError: (msg: string) => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const now = useNow(15_000);
  const relativeTime = useRelativeTime();
  const errorMessage = useErrorMessage();
  const { data: reservations, reload } = useLiveQuery(
    () => backend.stationReservations(station.id),
    station.id,
  );

  async function run(action: () => Promise<void>): Promise<boolean> {
    onError("");
    try {
      await action();
      reload();
      return true;
    } catch (err) {
      onError(errorMessage(err));
      return false;
    }
  }

  const active = (reservations ?? []).filter((r) => effectiveStatus(r, now) === "active");

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{station.name}</h2>
          <p className="text-xs text-zinc-500">
            {format(t.station.updated, { time: relativeTime(station.status.updatedAt, now) })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => run(() => backend.updateStatus(station.id, { isOpen: !station.status.isOpen }))}
          className={`rounded-full px-4 py-2 text-sm font-semibold text-white ${
            station.status.isOpen ? "bg-gp-green-dark" : "bg-zinc-500"
          }`}
          aria-pressed={station.status.isOpen}
        >
          {station.status.isOpen ? t.operator.open : t.operator.closed}
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {offersSwap(station.kind) && (
          <Counter
            label={t.station.fullBatteries}
            value={station.status.fullBatteries}
            max={station.batteryCapacity}
            onChange={(n) => run(() => backend.updateStatus(station.id, { fullBatteries: n }))}
          />
        )}
        {offersCharging(station.kind) && (
          <Counter
            label={t.station.freeSlots}
            value={station.status.freeSlots}
            max={station.chargingSlots}
            onChange={(n) => run(() => backend.updateStatus(station.id, { freeSlots: n }))}
          />
        )}
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">{t.operator.reservations}</h3>
        {active.length === 0 ? (
          <p className="text-sm text-zinc-500">{t.operator.noReservations}</p>
        ) : (
          <ul className="space-y-2">
            {active.map((r) => (
              <ReservationRow
                key={r.id}
                reservation={r}
                now={now}
                onComplete={(code) => run(() => backend.completeReservation(r.id, code))}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function OperatorPanel() {
  const { t } = useI18n();
  const { backend } = useApp();
  const [error, setError] = useState<string | null>(null);
  const { data: stations, error: loadError } = useLiveQuery(() => backend.staffStations());
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (loadError) return <p className="p-6 text-sm text-red-600">{t.errors.forbidden}</p>;
  if (!stations) return <p className="p-6 text-sm text-zinc-500">{t.loading}</p>;

  const station = stations.find((s) => s.id === selectedId) ?? stations[0];

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 overflow-y-auto p-6">
      <h1 className="text-2xl font-semibold">{t.operator.title}</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{t.operator.intro}</p>
      {stations.length === 0 && <p className="text-sm">{t.operator.noStations}</p>}
      {stations.length > 1 && (
        <select
          className="w-full rounded-lg border border-black/15 bg-white px-3 py-2 dark:border-white/20 dark:bg-zinc-900"
          value={station?.id}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {stations.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {station && <StationControls key={station.id} station={station} onError={setError} />}
    </div>
  );
}
