"use client";

import { offersCharging } from "@/lib/availability";
import { useErrorMessage } from "@/lib/hooks";
import { format } from "@/lib/i18n/format";
import type { StationView } from "@/lib/types";
import { useApp } from "../app-provider";
import { StaffCharging } from "../charging/charging";
import { GreenpointStaff } from "../greenpoint/greenpoint-staff";
import { useI18n } from "../i18n-provider";
import { Card, useToast } from "../ui";
import { WorkShell } from "./work-shell";

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
          {offersCharging(station.kind) && <FreeSlots station={station} />}
          <StaffCharging station={station} />
          <GreenpointStaff station={station} only={["charge"]} />
        </>
      )}
    </WorkShell>
  );
}
