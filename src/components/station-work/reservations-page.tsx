"use client";

import { useState } from "react";
import { batteryTypeLabel } from "@/lib/battery-types";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { Reservation, StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { effectiveStatus, minutesLeft } from "../reservation-list";
import { Button, EmptyState, Input, SkeletonCard, useToast } from "../ui";
import { WorkShell } from "./work-shell";

/** One active reservation: staff type the customer's code; at a station with several battery types, also the type given. */
function ReservationRow({ station, reservation: r, now, onDone }: { station: StationView; reservation: Reservation; now: Date; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const types = r.type === "battery" ? (station.batteryTypes ?? []) : [];
  const [code, setCode] = useState("");
  const [typeId, setTypeId] = useState(types.length === 1 ? types[0].id : "");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  async function complete() {
    setBusy(true);
    try {
      await backend.completeReservation(r.id, code, typeId || null);
      toast(t.work.saved);
      setCode("");
      onDone();
    } catch (err) {
      setShake((n) => n + 1);
      toast(errorMessage(err), { tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <li key={shake} className={`space-y-3 rounded-2xl border border-gp-border bg-gp-surface p-4 ${shake ? "animate-gp-shake" : ""}`}>
      <div className="text-sm font-semibold">
        {r.type === "battery" ? t.reservations.battery : t.reservations.slot} · {format(t.time.minutesLeft, { n: minutesLeft(r, now) })}
      </div>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void complete();
        }}
      >
        {types.length > 1 && (
          <label className="block min-w-40 flex-1 space-y-1">
            <span className="text-sm font-medium">{t.work.reservations.type}</span>
            <select
              required
              value={typeId}
              onChange={(e) => setTypeId(e.target.value)}
              className="min-h-11 w-full rounded-xl border border-gp-border bg-gp-surface px-3 text-base"
            >
              <option value="" />
              {types.map((bt) => (
                <option key={bt.id} value={bt.id}>
                  {batteryTypeLabel(bt)}
                </option>
              ))}
            </select>
          </label>
        )}
        <Input
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="0000"
          aria-label={t.operator.pickupCode}
          className="w-28 text-center font-mono tracking-widest"
        />
        <Button type="submit" busy={busy}>
          {t.operator.complete}
        </Button>
      </form>
    </li>
  );
}

function ReservationList({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const now = useNow(15_000);
  const { data, error, reload } = useLiveQuery(() => backend.stationReservations(station.id), station.id);
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const active = data.filter((r) => effectiveStatus(r, now) === "active");
  return (
    <>
      <p className="text-sm text-gp-muted">{t.work.reservations.intro}</p>
      {active.length === 0 ? (
        <EmptyState text={t.operator.noReservations} />
      ) : (
        <ul className="space-y-3">
          {active.map((r) => (
            <ReservationRow key={r.id} station={station} reservation={r} now={now} onDone={reload} />
          ))}
        </ul>
      )}
    </>
  );
}

/** /operator/reservations: the station's active reservations, completed with the customer's code. */
export function ReservationsPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.reservations.title} services={["swap", "charging"]}>
      {({ station }) => <ReservationList key={station.id} station={station} />}
    </WorkShell>
  );
}
