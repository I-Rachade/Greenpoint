import { OPEN_JOB_STATUSES, type DeliveryJob } from "@shared/drivers";
import { sortHistory, type Parcel, type ParcelHistoryEntry } from "@shared/parcels";

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
  /** Every recorded event and scan, oldest first (empty when the server sent none). */
  events: ParcelHistoryEntry[];
}

/** Which recorded events stand for each step; the first one found gives the step its time. */
const STEP_EVENTS: Record<TrackStepKey, ParcelHistoryEntry["kind"][]> = {
  deposited: ["deposited"],
  in_transit: ["handover_to_driver", "in_transit"],
  arrived: ["received_at_station", "arrived"],
  picked_up: ["picked_up"],
  delivered: ["delivered"],
};

/**
 * The tracking steps of a parcel. Step times come from the real events and scans the
 * server recorded (plan phase 7: handed to the driver, scanned in at the station, …)
 * and fall back to the times stored on the parcel. Null for a cancelled parcel.
 * Stored, released or auctioned parcels stop at "arrived"; their status pill says the rest.
 */
export function parcelTracking(p: Parcel): Tracking | null {
  if (p.status === "cancelled") return null;
  const events = sortHistory(p.history ?? []);
  const delivered = p.deliveryStatus === "delivered";
  const at = (key: TrackStepKey, stored: string | null): string | null =>
    events.find((e) => STEP_EVENTS[key].includes(e.kind))?.at ?? stored;
  const last: TrackStepKey = delivered ? "delivered" : "picked_up";
  const steps: TrackStep[] = [
    { key: "deposited", at: at("deposited", p.createdAt) },
    { key: "in_transit", at: at("in_transit", p.inTransitAt) },
    { key: "arrived", at: at("arrived", p.arrivedAt) },
    { key: last, at: at(last, p.pickedUpAt) },
  ];
  const current =
    p.status === "picked_up" || delivered ? 3 : p.status === "deposited" ? 0 : p.status === "in_transit" ? 1 : 2;
  return { steps, current, events };
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
