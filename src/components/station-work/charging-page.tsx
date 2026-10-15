"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { isHolding, offersCharging } from "@/lib/availability";
import { useErrorMessage, useLiveQuery, useNow } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import { displayStatus, isConnected } from "@/lib/iot/charging-points";
import { reservationKind } from "@/lib/reservations";
import type { Reservation, StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { StaffCharging } from "../charging/charging";
import { GreenpointStaff } from "../greenpoint/greenpoint-staff";
import { useI18n } from "../i18n-provider";
import { LoadFailed } from "../load-state";
import { useReservationWhat } from "../reservation-list";
import { Button, Card, EmptyState, Input, SkeletonCard, SuccessCheck, useToast } from "../ui";
import { WorkShell } from "./work-shell";

/**
 * A charging reservation opened from the reservation list (/operator/recharge?reservation=…):
 * the customer's code, then the outlet (the reserved one chosen, another free one possible)
 * and "start here", which starts the charge for the customer and completes the reservation.
 * A car charger or a counted place is completed with the code ("confirm arrival").
 */
function ReservationCharge({ station, reservation: r, onDone }: { station: StationView; reservation: Reservation; onDone: () => void }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const what = useReservationWhat();
  const now = useNow();
  const R = t.work.reservations;
  const [code, setCode] = useState("");
  const outlets = (station.chargingPoints ?? [])
    .filter((p) => isConnected(p) && displayStatus(p, now) === "free" && (!p.reserved || p.id === r.target))
    .sort((a, b) => a.label.localeCompare(b.label));
  const [pointId, setPointId] = useState<string | null>(outlets.some((p) => p.id === r.target) ? (r.target ?? null) : (outlets[0]?.id ?? null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOutlet = r.targetKind === "outlet";

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      toast(R.done);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const codeOk = /^\d{4}$/.test(code);
  return (
    <Card className="space-y-4 p-4">
      <div>
        <p className="font-semibold">{format(R.fromReservation, { customer: r.customer ?? R.customer })}</p>
        <p className="text-sm text-gp-muted">{what(r)}</p>
      </div>
      <label className="block space-y-1">
        <span className="text-sm font-medium">{R.code}</span>
        <Input
          inputMode="numeric"
          pattern="[0-9]{4}"
          maxLength={4}
          autoFocus
          autoComplete="off"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          placeholder="0000"
          className="w-32 text-center font-mono tracking-widest"
        />
      </label>
      {isOutlet && (
        <>
          <p className="text-sm text-gp-muted">{format(R.outlet, { outlet: r.targetLabel ?? "" })}</p>
          <div role="radiogroup" aria-label={t.station.outlets} className="grid grid-cols-3 gap-2 sm:grid-cols-5">
            {outlets.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={pointId === p.id}
                onClick={() => setPointId(p.id)}
                className={`min-h-12 rounded-xl border-2 px-2 text-sm font-semibold ${
                  pointId === p.id ? "border-gp-green-dark bg-gp-green-dark text-white" : "border-gp-border bg-gp-surface dark:border-white/10"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            size="lg"
            className="w-full"
            busy={busy}
            disabled={!codeOk || !pointId}
            onClick={() => void run(() => backend.startCharge(station.id, { pointId: pointId!, reservationId: r.id, pickupCode: code }))}
          >
            {R.startHere}
          </Button>
          <p className="text-xs text-gp-muted">{R.offlineHint}</p>
        </>
      )}
      {r.targetKind === "ev" && <p className="text-sm text-gp-muted">{format(R.evHint, { name: r.targetLabel ?? "" })}</p>}
      {r.targetKind === "place" && <p className="text-sm text-gp-muted">{R.placeHint}</p>}
      <Button
        variant={isOutlet ? "secondary" : "primary"}
        size={isOutlet ? undefined : "lg"}
        className="w-full"
        busy={busy}
        disabled={!codeOk}
        onClick={() => void run(() => backend.completeReservation(r.id, code))}
      >
        {R.complete}
      </Button>
      {error && (
        <p role="alert" className="animate-gp-shake text-sm text-red-600">
          {error}
        </p>
      )}
    </Card>
  );
}

/** The reservation named in the address, if any, above the charging page. */
function FromReservation({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const id = useSearchParams().get("reservation");
  const [finished, setFinished] = useState(false);
  const { data, error, reload } = useLiveQuery(() => (id ? backend.stationReservations(station.id) : Promise.resolve([])), `${station.id}:${id ?? ""}`);
  if (!id) return null;
  if (finished) {
    return (
      <Card className="flex flex-col items-center gap-3 p-6 text-center">
        <SuccessCheck />
        <p className="font-semibold">{t.work.reservations.done}</p>
        <Button href="/operator/reservations">{t.work.reservations.back}</Button>
      </Card>
    );
  }
  if (!data) return error ? <LoadFailed error={error} onRetry={reload} /> : <SkeletonCard />;
  const r = data.find((x) => x.id === id && reservationKind(x) === "charging_point");
  if (!r || !isHolding(r)) return <EmptyState text={t.work.reservations.gone} action={<Button href="/operator/reservations">{t.work.reservations.back}</Button>} />;
  return <ReservationCharge station={station} reservation={r} onDone={() => setFinished(true)} />;
}

/** Free charging places, counted by staff (as on the station page before). */
function FreeSlots({ station }: { station: StationView }) {
  const { t } = useI18n();
  const { backend } = useApp();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const value = station.status.freeSlots;
  const max = station.chargingSlots;
  const set = (n: number) =>
    backend.updateStatus(station.id, { freeSlots: n }).then(
      () => toast(t.work.saved),
      (err) => toast(errorMessage(err), { tone: "error" }),
    );
  const button = "grid h-14 w-14 place-items-center rounded-full bg-gp-green-dark text-3xl font-bold text-white active:scale-95 disabled:opacity-30";
  return (
    <Card className="p-4">
      <div className="mb-2 text-sm text-gp-muted">{t.work.charging.freeSlots}</div>
      <div className="flex items-center justify-between gap-4">
        <button type="button" className={button} onClick={() => void set(value - 1)} disabled={value <= 0} aria-label="-1">
          −
        </button>
        <div className="text-center">
          <div key={value} className="animate-gp-bump text-4xl font-bold tabular-nums">
            {value}
          </div>
          <div className="text-xs text-gp-muted">{format(t.operator.capacity, { n: max })}</div>
        </div>
        <button type="button" className={button} onClick={() => void set(value + 1)} disabled={value >= max} aria-label="+1">
          +
        </button>
      </div>
    </Card>
  );
}

/** /operator/recharge: motorbike outlets and car chargers: start, stop, take payment; greenpoints for a charge. */
export function ChargingPage() {
  const { t } = useI18n();
  return (
    <WorkShell title={t.work.charging.title} services={["charging", "ev"]}>
      {({ station }) => (
        <>
          <FromReservation key={station.id} station={station} />
          {offersCharging(station.kind) && <FreeSlots station={station} />}
          <StaffCharging station={station} />
          <GreenpointStaff station={station} only={["charge"]} />
        </>
      )}
    </WorkShell>
  );
}
