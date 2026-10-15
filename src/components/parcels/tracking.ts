import { OPEN_JOB_STATUSES, type DeliveryJob } from "@/lib/drivers";
import type { Parcel } from "@/lib/parcels";

/** The four steps a customer follows: handed in, on the way, at the station, collected (or delivered home). */
export type TrackStepKey = "deposited" | "in_transit" | "arrived" | "picked_up" | "delivered";

export interface TrackStep {
  key: TrackStepKey;
  /** When the parcel reached this step, if known. */
  at: string | null;
}

export interface Tracking {
  steps: TrackStep[];
  /** Index of the step the parcel is at now. */
  current: number;
}

/**
 * The tracking steps of a parcel, from its status and the times stored on it
 * (the event log itself stays on the server). Null for a cancelled parcel.
 * Stored, released or auctioned parcels stop at "arrived"; their status pill says the rest.
 */
export function parcelTracking(p: Parcel): Tracking | null {
  if (p.status === "cancelled") return null;
  const delivered = p.deliveryStatus === "delivered";
  const steps: TrackStep[] = [
    { key: "deposited", at: p.createdAt },
    { key: "in_transit", at: p.inTransitAt },
    { key: "arrived", at: p.arrivedAt },
    { key: delivered ? "delivered" : "picked_up", at: p.pickedUpAt },
  ];
  const current =
    p.status === "picked_up" || delivered ? 3 : p.status === "deposited" ? 0 : p.status === "in_transit" ? 1 : 2;
  return { steps, current };
}

/** Whether a driver trip belongs to this parcel (express, pickup that created it, or home delivery). */
export function jobBelongsTo(job: DeliveryJob, parcel: Parcel): boolean {
  return job.parcelId === parcel.id || parcel.jobId === job.id;
}

/**
 * One card per shipment: trips linked to a listed parcel are shown on that parcel's card
 * (only the one still running, newest first), the others stay in the list of trips.
 */
export function splitJobs(jobs: DeliveryJob[], parcels: Parcel[]): { alone: DeliveryJob[]; byParcel: Map<string, DeliveryJob> } {
  const alone: DeliveryJob[] = [];
  const byParcel = new Map<string, DeliveryJob>();
  const newestFirst = [...jobs].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  for (const job of newestFirst) {
    const parcel = parcels.find((p) => jobBelongsTo(job, p));
    if (!parcel) alone.push(job);
    else if (OPEN_JOB_STATUSES.includes(job.status) && !byParcel.has(parcel.id)) byParcel.set(parcel.id, job);
  }
  // Keep the order the server gave for the trips shown on their own.
  return { alone: jobs.filter((j) => alone.includes(j)), byParcel };
}
