import { describe, expect, it } from "vitest";
import type { DeliveryJob } from "@/lib/drivers";
import type { Parcel } from "@/lib/parcels";
import { parcelTracking, splitJobs } from "./tracking";

const parcel = (over: Partial<Parcel> = {}): Parcel =>
  ({
    id: "p1",
    trackingNo: "GP-1",
    status: "deposited",
    createdAt: "2026-10-01T08:00:00Z",
    inTransitAt: null,
    arrivedAt: null,
    pickedUpAt: null,
    deliveryStatus: null,
    jobId: null,
    ...over,
  }) as Parcel;

const job = (over: Partial<DeliveryJob> = {}): DeliveryJob =>
  ({ id: "j1", kind: "pickup", status: "open", parcelId: null, createdAt: "2026-10-01T07:00:00Z", ...over }) as DeliveryJob;

describe("parcelTracking", () => {
  it("follows the status", () => {
    expect(parcelTracking(parcel())?.current).toBe(0);
    expect(parcelTracking(parcel({ status: "in_transit", inTransitAt: "2026-10-01T09:00:00Z" }))?.current).toBe(1);
    expect(parcelTracking(parcel({ status: "arrived" }))?.current).toBe(2);
    expect(parcelTracking(parcel({ status: "stored" }))?.current).toBe(2);
    const done = parcelTracking(parcel({ status: "picked_up", pickedUpAt: "2026-10-02T10:00:00Z" }))!;
    expect(done.current).toBe(3);
    expect(done.steps[3]).toEqual({ key: "picked_up", at: "2026-10-02T10:00:00Z" });
  });

  it("ends with delivered for a home delivery", () => {
    const t = parcelTracking(parcel({ status: "arrived", deliveryStatus: "delivered" }))!;
    expect(t.current).toBe(3);
    expect(t.steps[3].key).toBe("delivered");
  });

  it("has no steps for a cancelled parcel", () => {
    expect(parcelTracking(parcel({ status: "cancelled" }))).toBeNull();
  });
});

describe("splitJobs", () => {
  it("puts a pickup and the parcel it created on one card", () => {
    const parcels = [parcel({ id: "p1", jobId: "j1" })];
    const jobs = [job({ id: "j1", status: "picked_up", parcelId: "p1" }), job({ id: "j2" })];
    const { alone, byParcel } = splitJobs(jobs, parcels);
    expect(alone.map((j) => j.id)).toEqual(["j2"]);
    expect(byParcel.get("p1")?.id).toBe("j1");
  });

  it("links by the job's parcel id too, and hides finished linked trips", () => {
    const parcels = [parcel({ id: "p1" })];
    const jobs = [job({ id: "j1", status: "done", parcelId: "p1" })];
    const { alone, byParcel } = splitJobs(jobs, parcels);
    expect(alone).toEqual([]);
    expect(byParcel.size).toBe(0);
  });
});
