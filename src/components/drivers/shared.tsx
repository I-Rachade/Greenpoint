"use client";

import { useRef, useState } from "react";
import { Pill } from "@/components/backoffice/shared";
import { MAX_DRIVER_IMAGE_BYTES, type DeliveryJob, type JobKind, type JobStatus } from "@/lib/drivers";
import { format } from "@/lib/i18n/format";
import { useI18n } from "../i18n-provider";

export const input = "min-h-11 w-full rounded-lg border border-black/15 bg-white px-3 py-2 text-base dark:border-white/20 dark:bg-zinc-900";
export const primary = "min-h-11 rounded-full bg-gp-green-dark px-4 py-2 text-sm font-medium text-white disabled:opacity-40";
export const secondary = "min-h-11 rounded-full border border-black/15 px-4 py-2 text-sm disabled:opacity-40 dark:border-white/20";
export const small = "rounded-full border border-black/15 px-2 py-0.5 text-xs dark:border-white/20";

const TONE: Record<JobStatus, "green" | "amber" | "red" | "gray" | "blue"> = {
  open: "amber",
  assigned: "amber",
  accepted: "blue",
  picked_up: "blue",
  at_door: "blue",
  returning: "red",
  done: "green",
  failed: "red",
  cancelled: "gray",
};

/** noDriver: a trip the server called off because no driver took it in time. */
export function JobStatusPill({ status, kind, noDriver = false }: { status: JobStatus; kind?: JobKind; noDriver?: boolean }) {
  const { t } = useI18n();
  const label = noDriver && status === "cancelled" ? t.drivers.noDriver : kind === "ride" && status === "picked_up" ? t.drivers.rideOnBoard : t.drivers.status[status];
  return <Pill tone={TONE[status]}>{label}</Pill>;
}

/** "Station A → Station B", "Home → Station B", "Station A → Home" or "A → B" for a ride or courier. */
export function useJobRoute() {
  const { t } = useI18n();
  return (job: DeliveryJob, stationName: (id: string | null) => string) => {
    if (job.kind === "ride") return `${job.home?.note || t.drivers.customer.rideFrom} → ${job.dropoff?.note || t.drivers.customer.rideTo}`;
    if (job.kind === "courier") return `${job.home?.note || t.drivers.customer.courierFrom} → ${job.dropoff?.note || t.drivers.customer.courierTo}`;
    const home = job.home?.note || t.drivers.kind[job.kind];
    if (job.kind === "pickup") return `${home} → ${stationName(job.toStationId)}`;
    if (job.kind === "delivery") return `${stationName(job.fromStationId)} → ${home}`;
    return `${stationName(job.fromStationId)} → ${stationName(job.toStationId)}`;
  };
}

export function useFcfa() {
  const { t } = useI18n();
  return (n: number) => format(t.drivers.fcfa, { n: n.toLocaleString("fr-FR") });
}

/** Shrinks a photo to at most 1600 px and JPEG, so uploads stay small on mobile data. */
export async function shrinkImage(file: Blob, maxSide = 1600): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  for (const quality of [0.82, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
    if (blob && blob.size <= MAX_DRIVER_IMAGE_BYTES) return blob;
  }
  throw new Error("image_too_large");
}

/** A button that takes a photo (back camera on phones); shrink it with `shrinkImage` before uploading. */
export function PhotoButton({ label, onPhoto, className = secondary }: { label: string; onPhoto: (file: File) => Promise<unknown>; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => ref.current?.click()}>
        📷 {label}
      </button>
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (!file) return;
          setBusy(true);
          try {
            await onPhoto(file);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export function Notice({ error, notice }: { error: string; notice: string }) {
  return (
    <>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-sm text-gp-green-dark dark:text-gp-green">
          {notice}
        </p>
      )}
    </>
  );
}
