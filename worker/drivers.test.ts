import { describe, expect, it } from "vitest";
import { DEFAULT_DRIVER_SETTINGS, driverBadgePayload, driverEarning, fareFor, OPEN_JOB_EXPIRY_MINUTES, signDriverPass, type FleetVehicleType } from "../src/lib/drivers";
import { distanceMeters } from "../src/lib/geo";
import type { Profile } from "../src/lib/types";
import {
  abandonJob,
  acceptJob,
  adminDrivers,
  applyDriver,
  arriveAtDoor,
  assignJob,
  bookDelivery,
  boardRide,
  bookPickup,
  bookRide,
  bookCourier,
  cancelJob,
  collectPickup,
  declineJob,
  deliverJob,
  dispatch,
  driverAtStation,
  driverHome,
  driverPass,
  approveProof,
  confirmCourierReceipt,
  rejectProof,
  failDelivery,
  finishRide,
  handToDriver,
  joinQueue,
  myJobs,
  receiveFromDriver,
  reviewDriver,
  runDispatch,
  saveDriverSettings,
  saveFleetVehicle,
  settleDriver,
  stationDrivers,
  uploadDriverDocument,
  uploadProof,
} from "./drivers";
import type { Env } from "./env";
import { createParcel, myParcels, parcelInfo, pickUpParcel, stationParcels, type ParcelCtx } from "./parcels";
import { startRun } from "./parcel-runs";
import { fakeD1 } from "./test-d1";

const OWN_OPERATOR = "00000000-0000-4000-8000-000000000001";
const A = { id: "st-a", lat: 6.1319, lng: 1.2228 };
const B = { id: "st-b", lat: 6.17, lng: 1.21 };
const HOME = { lat: 6.175, lng: 1.215, note: "Portail bleu", phone: "90 11 22 33" };

const ADMIN: Profile = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" };
const SENDER: Profile = { id: "sender", phone: "+22891000000", email: null, fullName: "Ama", role: "customer" };
const RECIPIENT_PHONE = "+22892000000";

function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  db.exec(`
    insert into users (id, phone, full_name, role, created_at) values
      ('admin', '+22890000001', 'Admin', 'admin', '${now}'),
      ('sender', '+22891000000', 'Ama', 'rider', '${now}'),
      ('d1', '+22893000001', null, 'rider', '${now}'),
      ('d2', '+22893000002', null, 'rider', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('${A.id}', '${OWN_OPERATOR}', 'Station A', ${A.lat}, ${A.lng}, 'both', '${now}'),
      ('${B.id}', '${OWN_OPERATOR}', 'Station B', ${B.lat}, ${B.lng}, 'both', '${now}');
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('${A.id}', 1, '', 0, '${now}'), ('${B.id}', 1, '', 0, '${now}');
    insert into app_settings (key, value, updated_at) values ('drivers_enabled', '1', '${now}');
  `);
  const files = new Map<string, ArrayBuffer>();
  const media = {
    async put(key: string, body: ArrayBuffer) {
      files.set(key, body);
    },
    async get(key: string) {
      return files.has(key) ? { body: files.get(key), writeHttpMetadata() {}, httpEtag: "x" } : null;
    },
    async delete(key: string) {
      files.delete(key);
    },
  };
  const env = { DB: d1, MEDIA: media } as unknown as Env;
  // `active`: the station the person works at now (header X-Active-Station, plan phase 3).
  const ctx = (user: Profile | null, active?: string): ParcelCtx => ({
    env,
    db: env.DB,
    request: new Request("https://app.poinderecharge.com/api", { headers: active ? { "X-Active-Station": active } : {} }),
    user: async () => user,
    requireUser: async () => {
      if (!user) throw new Error("not_authenticated");
      return user;
    },
    requireAdmin: async () => {
      if (user?.role !== "admin") throw new Error("forbidden");
      return user;
    },
    isStaffOf: async (u) => u.role === "admin",
    audit: (actor, table, action, rowId, changes, ids = {}) =>
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(new Date().toISOString(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes)),
  });
  return { db, env, files, ctx, admin: ctx(ADMIN), sender: ctx(SENDER), at: (stationId: string) => ctx(ADMIN, stationId) };
}

const photo = () =>
  new Request("https://app.poinderecharge.com/x", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: new Uint8Array([1, 2, 3]) });

const profile = (id: string, phone: string): Profile => ({ id, phone, email: null, fullName: null, role: "customer" });

/** A driver who applied, sent their photos and was approved with a vehicle of this type. */
async function approvedDriver(t: ReturnType<typeof setup>, id: string, type: FleetVehicleType = "tricycle") {
  const me = t.ctx(profile(id, `+2289300000${id.slice(-1)}`));
  await applyDriver(me, { fullName: `Chauffeur ${id}`, idNumber: "ID12345", licenseNumber: "LIC9876", wantedType: type });
  for (const kind of ["id", "license", "portrait"]) await uploadDriverDocument(me, kind, photo());
  await saveFleetVehicle(t.admin, null, { type, plate: `TG-${id}`, isActive: true });
  const vehicle = (await adminDrivers(t.admin)).vehicles.find((v) => v.plate === `TG-${id}`.toUpperCase())!;
  await reviewDriver(t.admin, id, { action: "approve", vehicleId: vehicle.id });
  // The approval made the account a driver account (0030, R1); the session reads the new role.
  const driver = t.ctx({ ...profile(id, `+2289300000${id.slice(-1)}`), role: "driver" });
  const home = await driverHome(driver);
  return { me: driver, code: home.driver!.code!, badge: driverBadgePayload(home.driver!.code!), pass: (await driverPass(driver)).payload };
}

const parcelInput = (express: boolean) => ({
  senderPhone: "91 00 00 00",
  recipientPhone: "92 00 00 00",
  toStationId: B.id,
  content: "Documents",
  measures: { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1 },
  express,
});

async function arrivedParcelAtB(t: ReturnType<typeof setup>) {
  const parcel = await createParcel(t.at(A.id), A.id, parcelInput(false));
  t.db.exec(`update parcels set status = 'arrived', pickup_code = '654321', arrived_at = '${new Date().toISOString()}' where id = '${parcel.id}'`);
  return parcel;
}

describe("driver application", () => {
  it("needs the three photos before approval and gives the driver a vehicle and a code", async () => {
    const t = setup();
    const me = t.ctx(profile("d1", "+22893000001"));
    await applyDriver(me, { fullName: "Kodjo", idNumber: "ID1", licenseNumber: "LIC1", wantedType: "moto" }).catch((e) => expect(e.code).toBe("bad_request"));
    await applyDriver(me, { fullName: "Kodjo", idNumber: "ID123", licenseNumber: "LIC123", wantedType: "moto" });
    await saveFleetVehicle(t.admin, null, { type: "moto", plate: "tg 1234 ab", isActive: true });
    const vehicle = (await adminDrivers(t.admin)).vehicles[0];
    expect(vehicle.plate).toBe("TG 1234 AB");
    await expect(reviewDriver(t.admin, "d1", { action: "approve", vehicleId: vehicle.id })).rejects.toMatchObject({ code: "documents_missing" });
    for (const kind of ["id", "license", "portrait"]) await uploadDriverDocument(me, kind, photo());
    expect(t.files.size).toBe(3);
    await reviewDriver(t.admin, "d1", { action: "approve", vehicleId: vehicle.id });
    const home = await driverHome(me);
    expect(home.driver?.status).toBe("active");
    expect(home.driver?.vehicle?.plate).toBe("TG 1234 AB");
    expect(home.driver?.code).toMatch(/^[A-Z2-9]{8}$/);
    // The same vehicle cannot go to a second driver.
    const other = t.ctx(profile("d2", "+22893000002"));
    await applyDriver(other, { fullName: "Afi", idNumber: "ID456", licenseNumber: "LIC456", wantedType: "moto" });
    for (const kind of ["id", "license", "portrait"]) await uploadDriverDocument(other, kind, photo());
    await expect(reviewDriver(t.admin, "d2", { action: "approve", vehicleId: vehicle.id })).rejects.toMatchObject({ code: "vehicle_unavailable" });
  });
});

describe("queue", () => {
  it("only lets a driver queue at the station", async () => {
    const t = setup();
    const { me } = await approvedDriver(t, "d1");
    await expect(joinQueue(t.ctx(profile("sender", SENDER.phone!)), A.id, A)).rejects.toMatchObject({ code: "not_a_driver" });
    await expect(joinQueue(me, A.id, B)).rejects.toMatchObject({ code: "too_far" });
    await expect(joinQueue(me, A.id, null)).rejects.toMatchObject({ code: "too_far" });
    await joinQueue(me, A.id, { lat: A.lat + 0.001, lng: A.lng });
    expect((await driverHome(me)).driver?.queue).toMatchObject({ stationId: A.id, position: 1 });
  });

  it("only at a station unlocked for drivers, and no trip for a queue there once locked (R8)", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    const second = await approvedDriver(t, "d2");
    await joinQueue(first.me, A.id, A);
    t.db.exec(`update station_services set unlocked = 0 where station_id = '${A.id}' and service = 'drivers'`);
    await expect(joinQueue(second.me, A.id, A)).rejects.toMatchObject({ code: "service_not_offered" });
    // The driver already in line there gets no new trip.
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    expect((await driverHome(first.me)).job).toBeNull();
  });

  it("blocks a driver who owes the cash limit", async () => {
    const t = setup();
    const { me } = await approvedDriver(t, "d1");
    t.db.exec(`insert into driver_ledger (id, driver_id, at, kind, amount_fcfa) values ('l1', 'd1', '${new Date().toISOString()}', 'collected', 20000)`);
    await expect(joinQueue(me, A.id, A)).rejects.toMatchObject({ code: "cash_limit" });
  });
});

describe("express trip", () => {
  it("goes to the first driver in line, is handed over by scan and arrives at B", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    const second = await approvedDriver(t, "d2");
    await joinQueue(first.me, A.id, A);
    await joinQueue(second.me, A.id, A);
    const parcel = await createParcel(t.at(A.id), A.id, parcelInput(true));
    expect(parcel.express).toBe(true);
    // Not on the collection run.
    await expect(startRun(t.at(A.id), A.id, second.badge, [parcel.id])).rejects.toMatchObject({ code: "parcel_wrong_status" });

    const offered = (await driverHome(first.me)).job!;
    expect(offered).toMatchObject({ kind: "express", status: "assigned", fromStationId: A.id, toStationId: B.id });
    const km = Math.ceil(distanceMeters(A, B) / 1000);
    expect(offered.fareFcfa).toBe(500 + 100 * km + 1000);
    expect((await driverHome(second.me)).driver?.queue?.position).toBe(1);

    await acceptJob(first.me, offered.id);
    expect((await stationDrivers(t.admin, A.id)).outgoing).toHaveLength(1);
    const scan = await driverAtStation(t.admin, A.id, first.badge);
    expect(scan.handOver?.id).toBe(offered.id);
    // The parcel is scanned into the driver's hands: another parcel is refused.
    const other = await createParcel(t.at(A.id), A.id, parcelInput(false));
    await expect(handToDriver(t.at(A.id), A.id, first.code, offered.id, other.trackingNo)).rejects.toMatchObject({ code: "parcel_not_in_run" });
    await expect(handToDriver(t.admin, A.id, first.code, offered.id, parcel.trackingNo)).rejects.toMatchObject({ code: "active_station_required" });
    await handToDriver(t.at(A.id), A.id, first.code, offered.id, parcel.trackingNo);
    expect(t.db.prepare("select status from parcels where id = ?").get(parcel.id)).toMatchObject({ status: "in_transit" });

    // Station A cannot "receive" it; station B can.
    expect((await driverAtStation(t.admin, A.id, first.badge)).receive).toBeNull();
    expect((await stationDrivers(t.admin, B.id)).incoming).toHaveLength(1);
    await receiveFromDriver(t.at(B.id), B.id, first.badge, offered.id, `poinderecharge colis ${parcel.trackingNo}\nDe: Station A`);
    const row = t.db.prepare("select status, pickup_code from parcels where id = ?").get(parcel.id) as { status: string; pickup_code: string };
    expect(row.status).toBe("arrived");
    expect(row.pickup_code).toMatch(/^\d{6}$/);

    const home = await driverHome(first.me);
    expect(home.job).toBeNull();
    expect(home.driver?.balanceFcfa).toBe(-driverEarning(offered.fareFcfa, DEFAULT_DRIVER_SETTINGS));
    // Daily settlement: the station pays the earning out, only for the signed pass of the driver's app.
    for (const typed of [first.code, first.badge]) {
      await expect(settleDriver(t.at(B.id), B.id, typed, home.driver!.balanceFcfa)).rejects.toMatchObject({ code: "driver_pass_required" });
    }
    await expect(settleDriver(t.at(B.id), B.id, first.pass, 0)).rejects.toMatchObject({ code: "balance_changed" });
    await settleDriver(t.at(B.id), B.id, first.pass, home.driver!.balanceFcfa);
    expect((await driverHome(first.me)).driver?.balanceFcfa).toBe(0);
  });

  it("goes to the next driver when the first says no or does not confirm in time", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    const second = await approvedDriver(t, "d2");
    await joinQueue(first.me, A.id, A);
    await joinQueue(second.me, A.id, A);
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(first.me)).job!;
    await declineJob(first.me, job.id);
    expect((await driverHome(second.me)).job?.id).toBe(job.id);
    expect((await driverHome(first.me)).driver?.queue?.stationId).toBe(A.id);
    // The second does not answer.
    t.db.exec(`update delivery_jobs set assigned_at = '${new Date(Date.now() - 10 * 60_000).toISOString()}' where id = '${job.id}'`);
    await dispatch(t.admin);
    // Both drivers had their turn: the trip waits for the admin or a new driver.
    expect(t.db.prepare("select status, driver_id from delivery_jobs where id = ?").get(job.id)).toMatchObject({ status: "open", driver_id: null });
    await assignJob(t.admin, job.id, "d2");
    expect((await driverHome(second.me)).job?.status).toBe("assigned");
  });

  it("is offered by the write that creates it and by the cron, never by a page load", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    await joinQueue(first.me, A.id, A);
    // The counter creating the express parcel offers its trip at once.
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(first.me)).job!;
    expect(job.status).toBe("assigned");
    const row = () => t.db.prepare("select status, driver_id from delivery_jobs where id = ?").get(job.id);
    // The offer runs out: pages that only read leave it alone…
    t.db.exec(`update delivery_jobs set assigned_at = '${new Date(Date.now() - 10 * 60_000).toISOString()}' where id = '${job.id}'`);
    await driverHome(first.me);
    await stationDrivers(t.admin, A.id);
    await adminDrivers(t.admin);
    expect(row()).toMatchObject({ status: "assigned", driver_id: "d1" });
    // …the driver can no longer take it, and the every-minute cron moves it on.
    await expect(acceptJob(first.me, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await runDispatch(t.env);
    expect(row()).toMatchObject({ status: "open", driver_id: null });
  });

  it("only offers parcels to vehicles big enough", async () => {
    const t = setup();
    const moto = await approvedDriver(t, "d1", "moto");
    await joinQueue(moto.me, A.id, A);
    await createParcel(t.at(A.id), A.id, { ...parcelInput(true), measures: { lengthCm: 90, widthCm: 50, heightCm: 50, weightKg: 30 } });
    expect((await driverHome(moto.me)).job).toBeNull();
  });
});

describe("home delivery", () => {
  it("hands the pickup right to the driver, who delivers with the recipient's code and a photo", async () => {
    const t = setup();
    const parcel = await arrivedParcelAtB(t);
    const recipientId = (t.db.prepare("select id from users where phone = ?").get(RECIPIENT_PHONE) as { id: string }).id;
    const recipient = t.ctx(profile(recipientId, RECIPIENT_PHONE));
    await expect(bookDelivery(t.sender, parcel.id, HOME)).rejects.toMatchObject({ code: "forbidden" });
    await expect(bookDelivery(recipient, parcel.id, { ...HOME, lat: 9.5, lng: 1.2 })).rejects.toMatchObject({ code: "outside_area" });
    const booked = await bookDelivery(recipient, parcel.id, HOME);
    expect(booked).toMatchObject({ kind: "delivery", status: "open", collectFcfa: fareFor(booked.distanceM, false, DEFAULT_DRIVER_SETTINGS) });
    expect((await myJobs(recipient))[0].id).toBe(booked.id);

    const driver = await approvedDriver(t, "d1", "moto");
    await joinQueue(driver.me, B.id, B);
    const job = (await driverHome(driver.me)).job!;
    expect(job.id).toBe(booked.id);
    // The driver never sees the code.
    expect(JSON.stringify(await driverHome(driver.me))).not.toContain("654321");
    await acceptJob(driver.me, job.id);
    await expect(cancelJob(t.sender, job.id)).rejects.toMatchObject({ code: "forbidden" });
    await handToDriver(t.at(B.id), B.id, driver.badge, job.id, parcel.trackingNo);
    // While out with the driver it cannot be picked up at the counter.
    await expect(pickUpParcel(t.at(B.id), B.id, "654321")).rejects.toMatchObject({ code: "parcel_with_driver" });
    await expect(cancelJob(recipient, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });

    await arriveAtDoor(driver.me, job.id);
    await expect(deliverJob(driver.me, job.id, "654321")).rejects.toMatchObject({ code: "photo_missing" });
    await uploadProof(driver.me, job.id, photo());
    await expect(deliverJob(driver.me, job.id, "111111")).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await deliverJob(driver.me, job.id, "654321");
    expect(t.db.prepare("select status, delivery_status from parcels where id = ?").get(parcel.id)).toMatchObject({
      status: "picked_up",
      delivery_status: "delivered",
    });
    const fare = job.fareFcfa;
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(fare - driverEarning(fare, DEFAULT_DRIVER_SETTINGS));
  });

  it("brings the parcel back after the waiting time when nobody is there", async () => {
    const t = setup();
    const parcel = await arrivedParcelAtB(t);
    const recipientId = (t.db.prepare("select id from users where phone = ?").get(RECIPIENT_PHONE) as { id: string }).id;
    const recipient = t.ctx(profile(recipientId, RECIPIENT_PHONE));
    const driver = await approvedDriver(t, "d1");
    await joinQueue(driver.me, B.id, B);
    const job = await bookDelivery(recipient, parcel.id, HOME);
    await acceptJob(driver.me, job.id);
    await handToDriver(t.at(B.id), B.id, driver.badge, job.id, parcel.trackingNo);
    await arriveAtDoor(driver.me, job.id);
    await expect(failDelivery(driver.me, job.id)).rejects.toMatchObject({ code: "wait_longer" });
    t.db.exec(`update delivery_jobs set at_door_at = '${new Date(Date.now() - 11 * 60_000).toISOString()}' where id = '${job.id}'`);
    await failDelivery(driver.me, job.id);
    expect((await driverAtStation(t.admin, B.id, driver.badge)).receive?.id).toBe(job.id);
    await receiveFromDriver(t.at(B.id), B.id, driver.badge, job.id, parcel.trackingNo);
    expect(t.db.prepare("select status, delivery_status from parcels where id = ?").get(parcel.id)).toMatchObject({
      status: "arrived",
      delivery_status: "failed",
    });
    // The code works at the counter again, and nothing was earned.
    await pickUpParcel(t.at(B.id), B.id, "654321");
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(0);
  });

  it("is called off when the recipient picks the parcel up in person first", async () => {
    const t = setup();
    const parcel = await arrivedParcelAtB(t);
    const recipientId = (t.db.prepare("select id from users where phone = ?").get(RECIPIENT_PHONE) as { id: string }).id;
    const job = await bookDelivery(t.ctx(profile(recipientId, RECIPIENT_PHONE)), parcel.id, HOME);
    await pickUpParcel(t.at(B.id), B.id, "654321");
    expect(t.db.prepare("select status from delivery_jobs where id = ?").get(job.id)).toMatchObject({ status: "cancelled" });
  });
});

describe("handover at the counter", () => {
  const arrive = (t: ReturnType<typeof setup>, id: string, code: string) =>
    t.db.exec(`update parcels set status = 'arrived', pickup_code = '${code}', arrived_at = '${new Date().toISOString()}' where id = '${id}'`);
  const status = (t: ReturnType<typeof setup>, id: string) => (t.db.prepare("select status from parcels where id = ?").get(id) as { status: string }).status;

  it("finds a parcel by its number, but hands it over only for the pickup code", async () => {
    const t = setup();
    const parcel = await createParcel(t.at(A.id), A.id, parcelInput(false));
    await expect(pickUpParcel(t.at(B.id), B.id, parcel.trackingNo)).rejects.toMatchObject({ code: "parcel_not_arrived" });
    await expect(pickUpParcel(t.at(B.id), B.id, "GP-ZZZZZZ")).rejects.toMatchObject({ code: "parcel_not_found" });
    arrive(t, parcel.id, "654321");
    // The number is on the label, not secret: alone it hands nothing over.
    await expect(pickUpParcel(t.at(B.id), B.id, parcel.trackingNo)).rejects.toMatchObject({ code: "pickup_code_required" });
    await expect(pickUpParcel(t.at(B.id), B.id, "", parcel.trackingNo)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await expect(pickUpParcel(t.at(B.id), B.id, "111111", parcel.trackingNo)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    expect(status(t, parcel.id)).toBe("arrived");
    const done = await pickUpParcel(t.at(B.id), B.id, "654321", parcel.trackingNo.toLowerCase());
    expect(done.status).toBe("picked_up");
    expect(status(t, parcel.id)).toBe("picked_up");
    // The right code took its try back; only the one wrong code is left.
    expect(t.db.prepare("select count(*) as n from parcel_code_failures where station_id = ?").get(`parcel:${parcel.id}`)).toMatchObject({ n: 1 });
  });

  it("shows the pickup code to the sender as well, never to staff", async () => {
    const t = setup();
    const parcel = await createParcel(t.at(A.id), A.id, parcelInput(false));
    arrive(t, parcel.id, "654321");
    const own = t.ctx(profile((t.db.prepare("select id from users where phone = '+22891000000'").get() as { id: string }).id, "+22891000000"));
    const [mine] = await myParcels(own);
    expect(mine).toMatchObject({ direction: "sent", pickupCode: "654321" });
    const staffView = await stationParcels(t.admin, B.id);
    expect(staffView.find((p) => p.id === parcel.id)?.pickupCode).toBeUndefined();
  });

  it("locks wrong codes per parcel, so other recipients can still collect", async () => {
    const t = setup();
    const target = await createParcel(t.at(A.id), A.id, parcelInput(false));
    const other = await createParcel(t.at(A.id), A.id, parcelInput(false));
    arrive(t, target.id, "654321");
    arrive(t, other.id, "123456");
    // Parallel guesses for one parcel: the tries are counted before the check, never more than 5.
    const tries = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => pickUpParcel(t.at(B.id), B.id, String(200000 + i), target.trackingNo)));
    const codes = tries.map((r) => (r.status === "rejected" ? (r.reason as { code: string }).code : "ok"));
    expect(codes.filter((c) => c === "wrong_pickup_code")).toHaveLength(5);
    expect(codes.filter((c) => c === "code_locked")).toHaveLength(3);
    // Even the right code waits for that parcel now…
    await expect(pickUpParcel(t.at(B.id), B.id, "654321", target.trackingNo)).rejects.toMatchObject({ code: "code_locked" });
    // …but the other recipient collects with their code, typed bare or with the number.
    await pickUpParcel(t.at(B.id), B.id, "123456");
    expect(status(t, other.id)).toBe("picked_up");
  });

  it("locks the whole counter once wrong codes spread over many parcels reach the station ceiling", async () => {
    const t = setup();
    const atB = await Promise.all(Array.from({ length: 9 }, () => createParcel(t.at(A.id), A.id, parcelInput(false))));
    atB.forEach((p, i) => arrive(t, p.id, String(100000 + i)));
    // A parcel waiting at station A, another counter.
    const atA = await createParcel(t.at(B.id), B.id, { ...parcelInput(false), toStationId: A.id });
    arrive(t, atA.id, "777777");
    const wrong = (p: { trackingNo: string }) => pickUpParcel(t.at(B.id), B.id, "999999", p.trackingNo);
    // 4 wrong codes for each of 7 parcels (below the per-parcel lock of 5) and one bare: 29.
    for (const p of atB.slice(0, 7)) for (let i = 0; i < 4; i++) await expect(wrong(p)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await expect(pickUpParcel(t.at(B.id), B.id, "999998")).rejects.toMatchObject({ code: "wrong_pickup_code" });
    // A right code takes its try back: the recipient collects, the count stays at 29.
    await pickUpParcel(t.at(B.id), B.id, "100007", atB[7].trackingNo);
    expect(status(t, atB[7].id)).toBe("picked_up");
    // The 30th wrong code is still checked; from then on, nothing at this counter is.
    await expect(wrong(atB[0])).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await expect(pickUpParcel(t.at(B.id), B.id, "100008", atB[8].trackingNo)).rejects.toMatchObject({ code: "code_locked" });
    await expect(pickUpParcel(t.at(B.id), B.id, "100008")).rejects.toMatchObject({ code: "code_locked" });
    expect(status(t, atB[8].id)).toBe("arrived");
    // Station A is not affected: a wrong code is checked there, the right one hands over.
    await expect(pickUpParcel(t.at(A.id), A.id, "999999", atA.trackingNo)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await pickUpParcel(t.at(A.id), A.id, "777777");
    expect(status(t, atA.id)).toBe("picked_up");
    expect(t.db.prepare("select count(*) as n from parcel_code_failures where at_station = ?").get(B.id)).toEqual({ n: 30 });
  });

  it("never counts more than the station ceiling when wrong codes for many parcels arrive at once", async () => {
    const t = setup();
    const atB = await Promise.all(Array.from({ length: 10 }, () => createParcel(t.at(A.id), A.id, parcelInput(false))));
    atB.forEach((p, i) => arrive(t, p.id, String(100000 + i)));
    const tries = await Promise.allSettled(atB.flatMap((p) => Array.from({ length: 4 }, () => pickUpParcel(t.at(B.id), B.id, "999999", p.trackingNo))));
    const codes = tries.map((r) => (r.status === "rejected" ? (r.reason as { code: string }).code : "ok"));
    expect(codes.filter((c) => c === "wrong_pickup_code")).toHaveLength(30);
    expect(codes.filter((c) => c === "code_locked")).toHaveLength(10);
  });

  it("locks bare codes at the station without blocking a parcel found by its number", async () => {
    const t = setup();
    const parcel = await createParcel(t.at(A.id), A.id, parcelInput(false));
    arrive(t, parcel.id, "654321");
    for (let i = 0; i < 5; i++) await expect(pickUpParcel(t.at(B.id), B.id, "999999")).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await expect(pickUpParcel(t.at(B.id), B.id, "654321")).rejects.toMatchObject({ code: "code_locked" });
    await pickUpParcel(t.at(B.id), B.id, "654321", parcel.trackingNo);
    expect(status(t, parcel.id)).toBe("picked_up");
  });
});

describe("driver pass at the counter", () => {
  it("refuses a forged or expired pass where the typed code still works", async () => {
    const t = setup();
    const driver = await approvedDriver(t, "d1");
    const parcel = await createParcel(t.at(A.id), A.id, parcelInput(false));
    t.db.exec(`update parcels set label_printed_at = '${new Date().toISOString()}' where id = '${parcel.id}'`);
    const forged = `${driver.pass.slice(0, -4)}0000`;
    await expect(driverAtStation(t.admin, A.id, forged)).rejects.toMatchObject({ code: "driver_pass_invalid" });
    await expect(startRun(t.at(A.id), A.id, forged, [parcel.id])).rejects.toMatchObject({ code: "driver_pass_invalid" });
    await expect(startRun(t.at(A.id), A.id, `${driver.badge}:0:1:X`, [parcel.id])).rejects.toMatchObject({ code: "driver_pass_invalid" });
    const secret = (t.db.prepare("select value from app_settings where key = 'driver_pass_secret'").get() as { value: string }).value;
    const old = await signDriverPass(secret, driver.code, null, Date.now() - 60 * 60_000);
    await expect(driverAtStation(t.admin, A.id, old.payload)).rejects.toMatchObject({ code: "driver_pass_expired" });
    await expect(settleDriver(t.at(A.id), A.id, old.payload, 0)).rejects.toMatchObject({ code: "driver_pass_expired" });
    // The pass and the typed code both find the driver for parcels.
    expect((await driverAtStation(t.admin, A.id, driver.pass)).driver.userId).toBe("d1");
    expect((await driverAtStation(t.admin, A.id, driver.code)).driver.userId).toBe("d1");
    const run = await startRun(t.at(A.id), A.id, driver.code, [parcel.id]);
    expect(run.parcels).toHaveLength(1);
  });
});

describe("pickup at home", () => {
  it("creates the parcel when the driver measured and collected, and it arrives at B", async () => {
    const t = setup();
    const booking = await bookPickup(t.sender, {
      home: HOME,
      toStationId: A.id,
      recipientPhone: "92 00 00 00",
      recipientName: "Kossi",
      content: "Vêtements",
      size: "M",
    });
    expect(booking.status).toBe("open");
    expect(booking.collectFcfa).toBe(500 + booking.fareFcfa);
    const driver = await approvedDriver(t, "d1");
    // Nearest station to the home is B: the driver waiting there gets the trip.
    await joinQueue(driver.me, B.id, B);
    const job = (await driverHome(driver.me)).job!;
    expect(job.id).toBe(booking.id);
    expect(job.home?.phone).toBe("+22890112233");
    await acceptJob(driver.me, job.id);
    await expect(collectPickup(driver.me, job.id, { lengthCm: 200, widthCm: 20, heightCm: 20, weightKg: 2 })).rejects.toMatchObject({
      code: "parcel_too_large",
    });
    const collected = await collectPickup(driver.me, job.id, { lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 8 });
    expect(collected).toMatchObject({ status: "picked_up", size: "L", collectFcfa: 1000 + job.fareFcfa });
    expect(collected.trackingNo).toMatch(/^GP-/);
    expect((await myJobs(t.sender))[0].trackingNo).toBe(collected.trackingNo);
    await expect(receiveFromDriver(t.at(A.id), A.id, driver.badge, job.id, "GP-ZZZZZZ")).rejects.toMatchObject({ code: "parcel_not_found" });
    await receiveFromDriver(t.at(A.id), A.id, driver.badge, job.id, collected.trackingNo!);
    expect(t.db.prepare("select status, from_station_id from parcels where id = ?").get(collected.parcelId)).toMatchObject({
      status: "arrived",
      from_station_id: B.id,
    });
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(collected.collectFcfa - driverEarning(job.fareFcfa, DEFAULT_DRIVER_SETTINGS));
  });
});

describe("ride", () => {
  const DROPOFF = { lat: 6.2, lng: 1.19, note: "Marché d'Agoè" };

  it("takes the customer from A to B and books the fare as cash collected", async () => {
    const t = setup();
    const booking = await bookRide(t.sender, { pickup: HOME, dropoff: DROPOFF, passengers: 1 });
    expect(booking).toMatchObject({ kind: "ride", status: "open", passengers: 1, dropoff: DROPOFF });
    expect(booking.fareFcfa).toBe(fareFor(distanceMeters(HOME, DROPOFF), false, DEFAULT_DRIVER_SETTINGS));
    expect(booking.collectFcfa).toBe(booking.fareFcfa);
    // One open ride at a time.
    await expect(bookRide(t.sender, { pickup: HOME, dropoff: DROPOFF, passengers: 1 })).rejects.toMatchObject({ code: "ride_open" });

    const driver = await approvedDriver(t, "d1", "moto");
    await joinQueue(driver.me, B.id, B);
    const job = (await driverHome(driver.me)).job!;
    expect(job.id).toBe(booking.id);
    // Not before the driver accepted, and parcel steps do not apply.
    await expect(boardRide(driver.me, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await acceptJob(driver.me, job.id);
    await expect(collectPickup(driver.me, job.id, { lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 })).rejects.toMatchObject({ code: "job_wrong_status" });
    await expect(finishRide(driver.me, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await boardRide(driver.me, job.id);
    // The customer cannot cancel once on board.
    await expect(cancelJob(t.sender, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await finishRide(driver.me, job.id);

    const home = await driverHome(driver.me);
    expect(home.job).toBeNull();
    expect(home.history[0]).toMatchObject({ id: job.id, status: "done" });
    expect(home.driver?.balanceFcfa).toBe(job.fareFcfa - driverEarning(job.fareFcfa, DEFAULT_DRIVER_SETTINGS));
    expect((await myJobs(t.sender))[0]).toMatchObject({ kind: "ride", status: "done" });
    // A new ride can be booked once the last one is over.
    expect((await bookRide(t.sender, { pickup: HOME, dropoff: DROPOFF, passengers: 1 })).status).toBe("open");
  });

  it("only offers rides to vehicles with a seat for every passenger", async () => {
    const t = setup();
    const booking = await bookRide(t.sender, { pickup: HOME, dropoff: DROPOFF, passengers: 3 });
    const moto = await approvedDriver(t, "d1", "moto");
    await joinQueue(moto.me, B.id, B);
    expect((await driverHome(moto.me)).job).toBeNull();
    const tricycle = await approvedDriver(t, "d2", "tricycle");
    await joinQueue(tricycle.me, A.id, A);
    expect((await driverHome(tricycle.me)).job?.id).toBe(booking.id);
  });

  it("refuses bad bookings", async () => {
    const t = setup();
    await expect(bookRide(t.sender, { pickup: HOME, dropoff: DROPOFF, passengers: 5 })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bookRide(t.sender, { pickup: HOME, dropoff: { lat: 7.5, lng: 1.1, note: "" }, passengers: 1 })).rejects.toMatchObject({ code: "outside_area" });
    await expect(bookRide(t.sender, { pickup: { ...HOME, phone: "" }, dropoff: DROPOFF, passengers: 1 })).rejects.toMatchObject({
      code: "phone_not_allowed",
    });
  });
});

describe("express parcel door to door", () => {
  const DROPOFF = { lat: 6.2, lng: 1.19, note: "Agoè, portail bleu" };
  const booking = { pickup: HOME, dropoff: DROPOFF, recipientPhone: "92 00 00 00", recipientName: "Afi", content: "Clés", size: "S" as const };

  it("is paid at the sender's door and handed to the recipient", async () => {
    const t = setup();
    const job = await bookCourier(t.sender, booking);
    expect(job).toMatchObject({ kind: "courier", status: "open", dropoff: DROPOFF, recipient: { phone: "+22892000000", name: "Afi" }, content: "Clés" });
    expect(job.collectFcfa).toBe(fareFor(distanceMeters(HOME, DROPOFF), false, DEFAULT_DRIVER_SETTINGS));

    const driver = await approvedDriver(t, "d1", "moto");
    await joinQueue(driver.me, B.id, B);
    expect((await driverHome(driver.me)).job?.id).toBe(job.id);
    await acceptJob(driver.me, job.id);
    await boardRide(driver.me, job.id);
    // Paid at the door: owed to us as soon as the driver has the parcel.
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(job.fareFcfa);
    await expect(cancelJob(t.sender, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    // Not one tap at the door: the recipient's code (the sender sees it, the driver does not) or a photo.
    const code = (await myJobs(t.sender))[0].handoverCode!;
    expect(code).toMatch(/^\d{6}$/);
    expect(JSON.stringify(await driverHome(driver.me))).not.toContain(code);
    await expect(finishRide(driver.me, job.id)).rejects.toMatchObject({ code: "proof_required" });
    await expect(finishRide(driver.me, job.id, code === "000000" ? "111111" : "000000")).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await finishRide(driver.me, job.id, code);
    const home = await driverHome(driver.me);
    expect(home.job).toBeNull();
    expect(home.driver?.balanceFcfa).toBe(job.fareFcfa - driverEarning(job.fareFcfa, DEFAULT_DRIVER_SETTINGS));
    expect((await myJobs(t.sender))[0]).toMatchObject({ kind: "courier", status: "done" });
  });

  it("hands over with a photo of the handover when the recipient has no code", async () => {
    const t = setup();
    const job = await bookCourier(t.sender, booking);
    const driver = await approvedDriver(t, "d1", "moto");
    await joinQueue(driver.me, B.id, B);
    await acceptJob(driver.me, job.id);
    await expect(uploadProof(driver.me, job.id, photo())).rejects.toMatchObject({ code: "job_wrong_status" });
    await boardRide(driver.me, job.id);
    await expect(finishRide(driver.me, job.id, "")).rejects.toMatchObject({ code: "proof_required" });
    await uploadProof(driver.me, job.id, photo());
    await finishRide(driver.me, job.id);
    expect(t.db.prepare("select status, proof_review from delivery_jobs where id = ?").get(job.id)).toMatchObject({ status: "done", proof_review: "pending" });
    // Without the recipient's code the driver's share waits: only what they collected counts.
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(job.fareFcfa);
    expect((await myJobs(t.sender))[0].proofReview).toBe("pending");
    expect((await adminDrivers(t.admin)).jobs.find((j) => j.id === job.id)?.proofReview).toBe("pending");
    // Someone else cannot confirm it; the sender can, once.
    const stranger = t.ctx(profile("d2", "+22893000002"));
    await expect(confirmCourierReceipt(stranger, job.id)).rejects.toMatchObject({ code: "forbidden" });
    await confirmCourierReceipt(t.sender, job.id);
    await expect(confirmCourierReceipt(t.sender, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await expect(approveProof(t.admin, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(job.fareFcfa - driverEarning(job.fareFcfa, DEFAULT_DRIVER_SETTINGS));
    expect((await myJobs(t.sender))[0].proofReview).toBe("approved");
  });

  it("books the held share when an admin approves the photo, and not for a trip handed over with the code", async () => {
    const t = setup();
    const job = await bookCourier(t.sender, booking);
    const driver = await approvedDriver(t, "d1", "moto");
    await joinQueue(driver.me, B.id, B);
    await acceptJob(driver.me, job.id);
    await boardRide(driver.me, job.id);
    await uploadProof(driver.me, job.id, photo());
    await finishRide(driver.me, job.id);
    await expect(approveProof(t.sender, job.id)).rejects.toThrow("forbidden");
    await approveProof(t.admin, job.id);
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(job.fareFcfa - driverEarning(job.fareFcfa, DEFAULT_DRIVER_SETTINGS));
    expect(t.db.prepare("select count(*) as n from driver_ledger where job_id = ? and kind = 'earning'").get(job.id)).toMatchObject({ n: 1 });

    const second = await bookCourier(t.sender, booking);
    await joinQueue(driver.me, B.id, B);
    await acceptJob(driver.me, second.id);
    await boardRide(driver.me, second.id);
    const code = (await myJobs(t.sender)).find((j) => j.id === second.id)!.handoverCode!;
    await finishRide(driver.me, second.id, code);
    expect(t.db.prepare("select proof_review from delivery_jobs where id = ?").get(second.id)).toMatchObject({ proof_review: null });
    await expect(approveProof(t.admin, second.id)).rejects.toMatchObject({ code: "job_wrong_status" });
  });

  it("books nothing when an admin rejects the photo, tells the driver and the sender, and refuses an approval after", async () => {
    const t = setup();
    const sent: { to: string; subject: string; text: string }[] = [];
    (t.env as { EMAIL?: unknown }).EMAIL = { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) };
    t.db.exec("update users set email = 'ama@example.tg' where id = 'sender'");
    const job = await bookCourier(t.sender, booking);
    const driver = await approvedDriver(t, "d1", "moto");
    t.db.exec("update users set email = 'kodjo@example.tg' where id = 'd1'");
    await joinQueue(driver.me, B.id, B);
    await acceptJob(driver.me, job.id);
    await boardRide(driver.me, job.id);
    await uploadProof(driver.me, job.id, photo());
    await finishRide(driver.me, job.id);
    sent.length = 0;
    const reason = (text: unknown) => async () => ({ reason: text });
    // Admins only, with a reason.
    await expect(rejectProof(t.sender, job.id, reason("Photo floue"))).rejects.toThrow("forbidden");
    await expect(rejectProof(t.admin, job.id, reason("  "))).rejects.toMatchObject({ code: "bad_request" });
    await expect(rejectProof(t.admin, job.id, reason(42))).rejects.toMatchObject({ code: "bad_request" });
    await expect(rejectProof(t.admin, job.id, reason("x".repeat(301)))).rejects.toMatchObject({ code: "bad_request" });
    await rejectProof(t.admin, job.id, reason(" Photo floue, pas de colis visible "));
    expect(t.db.prepare("select proof_review, proof_reject_reason from delivery_jobs where id = ?").get(job.id)).toEqual({
      proof_review: "rejected",
      proof_reject_reason: "Photo floue, pas de colis visible",
    });
    // The held share is not booked: only what the driver collected counts.
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(job.fareFcfa);
    expect(t.db.prepare("select count(*) as n from driver_ledger where job_id = ? and kind = 'earning'").get(job.id)).toMatchObject({ n: 0 });
    // Both are told why, and see it in the app.
    expect(sent.map((m) => m.to).sort()).toEqual(["ama@example.tg", "kodjo@example.tg"]);
    for (const m of sent) expect(m.text).toContain("Photo floue, pas de colis visible");
    expect((await myJobs(t.sender))[0]).toMatchObject({ proofReview: "rejected", proofRejectReason: "Photo floue, pas de colis visible" });
    expect((await driverHome(driver.me)).history.find((j) => j.id === job.id)).toMatchObject({ proofReview: "rejected" });
    expect((await adminDrivers(t.admin)).jobs.find((j) => j.id === job.id)?.proofReview).toBe("rejected");
    // Audit logged.
    const audit = t.db.prepare("select actor, changes from audit_log where table_name = 'delivery_jobs' and row_id = ?").all(job.id) as { actor: string; changes: string }[];
    expect(audit.map((a) => ({ actor: a.actor, ...JSON.parse(a.changes) }))).toContainEqual({
      actor: "admin",
      proof_review: ["pending", "rejected"],
      reason: "Photo floue, pas de colis visible",
    });
    // No approval, no confirmation and no second rejection after it.
    await expect(approveProof(t.admin, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await expect(confirmCourierReceipt(t.sender, job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await expect(rejectProof(t.admin, job.id, reason("Encore"))).rejects.toMatchObject({ code: "job_wrong_status" });
    expect((await driverHome(driver.me)).driver?.balanceFcfa).toBe(job.fareFcfa);
  });

  it("refuses to reject an approved photo or a trip handed over with the code, and one of approve or reject wins a race", async () => {
    const t = setup();
    const driver = await approvedDriver(t, "d1", "moto");
    const byPhoto = async () => {
      const job = await bookCourier(t.sender, booking);
      await joinQueue(driver.me, B.id, B);
      await acceptJob(driver.me, job.id);
      await boardRide(driver.me, job.id);
      await uploadProof(driver.me, job.id, photo());
      await finishRide(driver.me, job.id);
      return job;
    };
    const reason = async () => ({ reason: "Photo floue" });
    const approved = await byPhoto();
    await approveProof(t.admin, approved.id);
    await expect(rejectProof(t.admin, approved.id, reason)).rejects.toMatchObject({ code: "job_wrong_status" });
    expect(t.db.prepare("select proof_review from delivery_jobs where id = ?").get(approved.id)).toEqual({ proof_review: "approved" });

    const raced = await byPhoto();
    const answers = await Promise.allSettled([approveProof(t.admin, raced.id), rejectProof(t.admin, raced.id, reason), confirmCourierReceipt(t.sender, raced.id)]);
    expect(answers.filter((a) => a.status === "fulfilled")).toHaveLength(1);
    const state = (t.db.prepare("select proof_review from delivery_jobs where id = ?").get(raced.id) as { proof_review: string }).proof_review;
    const earnings = (t.db.prepare("select count(*) as n from driver_ledger where job_id = ? and kind = 'earning'").get(raced.id) as { n: number }).n;
    expect(earnings).toBe(state === "approved" ? 1 : 0);

    const withCode = await bookCourier(t.sender, booking);
    await joinQueue(driver.me, B.id, B);
    await acceptJob(driver.me, withCode.id);
    await boardRide(driver.me, withCode.id);
    await finishRide(driver.me, withCode.id, (await myJobs(t.sender)).find((j) => j.id === withCode.id)!.handoverCode!);
    await expect(rejectProof(t.admin, withCode.id, reason)).rejects.toMatchObject({ code: "job_wrong_status" });
  });

  it("only goes to vehicles big enough and refuses bad bookings", async () => {
    const t = setup();
    const job = await bookCourier(t.sender, { ...booking, size: "L" });
    const moto = await approvedDriver(t, "d1", "moto");
    await joinQueue(moto.me, B.id, B);
    expect((await driverHome(moto.me)).job).toBeNull();
    const car = await approvedDriver(t, "d2", "car");
    await joinQueue(car.me, A.id, A);
    expect((await driverHome(car.me)).job?.id).toBe(job.id);

    await expect(bookCourier(t.sender, { ...booking, recipientPhone: "" })).rejects.toMatchObject({ code: "phone_not_allowed" });
    await expect(bookCourier(t.sender, { ...booking, dropoff: { ...DROPOFF, note: " " } })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bookCourier(t.sender, { ...booking, content: "" })).rejects.toMatchObject({ code: "bad_request" });
    await expect(bookCourier(t.sender, { ...booking, dropoff: { lat: 7.5, lng: 1.1, note: "Loin" } })).rejects.toMatchObject({ code: "outside_area" });
  });

  it("ordered on the Courses tab, only goes to the vehicle picked there", async () => {
    const t = setup();
    // No active cargo tricycle yet: it shows as "soon" and cannot be ordered.
    expect((await parcelInfo(t.sender)).bookableVehicles).toEqual([]);
    await expect(bookCourier(t.sender, { ...booking, vehicleType: "cargo_tricycle" })).rejects.toMatchObject({ code: "vehicle_soon" });
    const moto = await approvedDriver(t, "d1", "moto");
    const cargo = await approvedDriver(t, "d2", "cargo_tricycle");
    expect((await parcelInfo(t.sender)).bookableVehicles).toEqual(["moto", "cargo_tricycle"]);
    // Too big for a moto.
    await expect(bookCourier(t.sender, { ...booking, size: "XL", vehicleType: "moto" })).rejects.toMatchObject({ code: "parcel_too_large" });
    const job = await bookCourier(t.sender, { ...booking, vehicleType: "cargo_tricycle" });
    expect(job.vehicleType).toBe("cargo_tricycle");
    await joinQueue(moto.me, A.id, A);
    expect((await driverHome(moto.me)).job).toBeNull();
    await joinQueue(cargo.me, B.id, B);
    expect((await driverHome(cargo.me)).job?.id).toBe(job.id);
  });
});

describe("settings", () => {
  it("rejects invalid values and logs changes", async () => {
    const t = setup();
    await expect(saveDriverSettings(t.admin, { ...DEFAULT_DRIVER_SETTINGS, driverSharePct: 120 })).rejects.toMatchObject({ code: "bad_request" });
    await saveDriverSettings(t.admin, { ...DEFAULT_DRIVER_SETTINGS, baseFcfa: 600 });
    expect((await adminDrivers(t.admin)).settings.baseFcfa).toBe(600);
    expect(t.db.prepare("select changes from audit_log where table_name = 'driver_settings'").get()).toMatchObject({
      changes: JSON.stringify({ baseFcfa: [500, 600] }),
    });
  });

  it("keeps settings saved before cars existed and gives cars the default limits", async () => {
    const t = setup();
    const old = { ...DEFAULT_DRIVER_SETTINGS, baseFcfa: 700, vehicles: DEFAULT_DRIVER_SETTINGS.vehicles.filter((v) => v.type !== "car") };
    t.db.prepare("insert or replace into driver_settings (id, settings, updated_at) values (1, ?, ?)").run(JSON.stringify(old), "2026-10-13T00:00:00.000Z");
    const settings = (await adminDrivers(t.admin)).settings;
    expect(settings.baseFcfa).toBe(700);
    expect(settings.vehicles.find((v) => v.type === "car")).toEqual(DEFAULT_DRIVER_SETTINGS.vehicles.find((v) => v.type === "car"));
  });
});

describe("driver module switched off", () => {
  it("refuses every booking that needs a driver, but not a regular parcel at the counter", async () => {
    const t = setup();
    const parcel = await arrivedParcelAtB(t);
    t.db.exec("update app_settings set value = '0' where key = 'drivers_enabled'");
    const recipient = t.ctx(profile(parcel.recipient.userId!, RECIPIENT_PHONE));
    const soon = { code: "drivers_soon" };
    const DROPOFF = { lat: 6.2, lng: 1.19, note: "Marché d'Agoè" };

    await expect(bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: "92 00 00 00", content: "Vêtements", size: "M" })).rejects.toMatchObject(soon);
    await expect(bookRide(t.sender, { pickup: HOME, dropoff: DROPOFF, passengers: 1 })).rejects.toMatchObject(soon);
    await expect(
      bookCourier(t.sender, { pickup: HOME, dropoff: DROPOFF, recipientPhone: "92 00 00 00", content: "Clés", size: "S" }),
    ).rejects.toMatchObject(soon);
    await expect(bookDelivery(recipient, parcel.id, HOME)).rejects.toMatchObject(soon);
    await expect(createParcel(t.at(A.id), A.id, parcelInput(true))).rejects.toMatchObject(soon);
    expect((await createParcel(t.at(A.id), A.id, parcelInput(false))).express).toBe(false);
  });

  it("closes applications and the queue, but a driver finishes the trip under way", async () => {
    const t = setup();
    const driver = await approvedDriver(t, "d1");
    await joinQueue(driver.me, A.id, A);
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(driver.me)).job!;
    t.db.exec("update app_settings set value = '0' where key = 'drivers_enabled'");
    const soon = { code: "drivers_soon" };

    const newcomer = t.ctx(profile("d2", "+22893000002"));
    await expect(applyDriver(newcomer, { fullName: "Chauffeur d2", idNumber: "ID12345", licenseNumber: "LIC9876", wantedType: "moto" })).rejects.toMatchObject(soon);
    await expect(uploadDriverDocument(newcomer, "id", photo())).rejects.toMatchObject(soon);
    await acceptJob(driver.me, job.id);
    expect((await driverHome(driver.me)).job?.status).toBe("accepted");
    t.db.exec(`update delivery_jobs set status = 'cancelled' where id = '${job.id}'`);
    await expect(joinQueue(driver.me, A.id, A)).rejects.toMatchObject(soon);
  });
});

const expire = (t: ReturnType<typeof setup>, jobId: string) =>
  t.db.exec(`update delivery_jobs set assigned_at = '${new Date(Date.now() - 10 * 60_000).toISOString()}' where id = '${jobId}'`);

describe("offers that run out", () => {
  it("put the driver back at the end of the line at the same station and tell them once", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    await joinQueue(first.me, A.id, A);
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(first.me)).job!;
    expect((await driverHome(first.me)).lastExpiredAt).toBeNull();
    expire(t, job.id);
    // The minute cron, with nobody using the app.
    await runDispatch(t.env);
    expect(t.db.prepare("select status, driver_id from delivery_jobs where id = ?").get(job.id)).toMatchObject({ status: "open", driver_id: null });
    const home = await driverHome(first.me);
    expect(home.job).toBeNull();
    expect(home.driver?.queue).toMatchObject({ stationId: A.id, position: 1 });
    expect(home.lastExpiredAt).not.toBeNull();
  });

  it("leave a driver over the cash limit out of the line", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    await joinQueue(first.me, A.id, A);
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(first.me)).job!;
    t.db.exec(`insert into driver_ledger (id, driver_id, at, kind, amount_fcfa) values ('l1', 'd1', '${new Date().toISOString()}', 'collected', 20000)`);
    expire(t, job.id);
    await runDispatch(t.env);
    expect((await driverHome(first.me)).driver?.queue).toBeNull();
  });

  it("are not sent or expired by the cron while the driver module is off", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    await joinQueue(first.me, A.id, A);
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(first.me)).job!;
    expire(t, job.id);
    t.db.exec("update app_settings set value = '0' where key = 'drivers_enabled'");
    await runDispatch(t.env);
    expect(t.db.prepare("select status from delivery_jobs where id = ?").get(job.id)).toMatchObject({ status: "assigned" });
  });
});

describe("giving back an accepted trip", () => {
  it("sends the trip to the next driver and the driver to the end of the line, with the reason", async () => {
    const t = setup();
    const first = await approvedDriver(t, "d1");
    const second = await approvedDriver(t, "d2");
    await joinQueue(first.me, A.id, A);
    await joinQueue(second.me, A.id, A);
    await createParcel(t.at(A.id), A.id, parcelInput(true));
    const job = (await driverHome(first.me)).job!;
    // Only once accepted, and with a known reason.
    await expect(abandonJob(first.me, job.id, "too_big")).rejects.toMatchObject({ code: "job_wrong_status" });
    await acceptJob(first.me, job.id);
    await expect(abandonJob(first.me, job.id, "bored")).rejects.toMatchObject({ code: "bad_request" });
    await expect(abandonJob(second.me, job.id, "too_big")).rejects.toMatchObject({ code: "job_not_found" });
    await abandonJob(first.me, job.id, "too_big");

    expect((await driverHome(second.me)).job).toMatchObject({ id: job.id, status: "assigned" });
    const home = await driverHome(first.me);
    expect(home.job).toBeNull();
    expect(home.driver?.queue).toMatchObject({ stationId: A.id, position: 1 });
    const audit = t.db
      .prepare("select changes from audit_log where table_name = 'delivery_jobs' and row_id = ? and actor = 'd1' order by id desc")
      .get(job.id) as { changes: string };
    expect(JSON.parse(audit.changes)).toMatchObject({ status: ["accepted", "open"], abandon_reason: "too_big" });
    // Nor can it be given back once the parcel is handed over.
    await acceptJob(second.me, job.id);
    await handToDriver(t.at(A.id), A.id, (await driverHome(second.me)).driver!.code!, job.id, job.trackingNo!);
    await expect(abandonJob(second.me, job.id, "other")).rejects.toMatchObject({ code: "job_wrong_status" });
  });
});

describe("pickup called off while the driver collects", () => {
  it("creates no parcel", async () => {
    const t = setup();
    const booking = await bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: "92 00 00 00", content: "Vêtements", size: "M" });
    const driver = await approvedDriver(t, "d1");
    await joinQueue(driver.me, B.id, B);
    await acceptJob(driver.me, booking.id);
    // The customer cancels right before the driver's trip moves on (after the driver's page loaded it).
    const db = t.env.DB;
    const racing = {
      ...driver.me,
      db: new Proxy(db, {
        get(target, key) {
          if (key !== "prepare") return Reflect.get(target, key);
          return (sql: string) => {
            if (sql.startsWith("update delivery_jobs set status = 'picked_up'")) {
              t.db.exec(`update delivery_jobs set status = 'cancelled' where id = '${booking.id}'`);
            }
            return target.prepare(sql);
          };
        },
      }),
    };
    await expect(collectPickup(racing, booking.id, { lengthCm: 50, widthCm: 40, heightCm: 30, weightKg: 8 })).rejects.toMatchObject({
      code: "job_wrong_status",
    });
    expect(t.db.prepare("select count(*) as n from parcels").get()).toMatchObject({ n: 0 });
    expect(t.db.prepare("select status, parcel_id from delivery_jobs where id = ?").get(booking.id)).toMatchObject({ status: "cancelled", parcel_id: null });
  });
});

describe("trips nobody takes", () => {
  it("are called off after OPEN_JOB_EXPIRY_MINUTES and the customer is told; express trips stay", async () => {
    const t = setup();
    const sent: { to: string; subject: string }[] = [];
    (t.env as { EMAIL?: unknown }).EMAIL = { send: async (m: { to: string; subject: string }) => void sent.push(m) };
    t.db.exec("update users set email = 'ama@example.tg' where id = 'sender'");
    const booking = await bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: "92 00 00 00", content: "Vêtements", size: "M" });
    const express = await createParcel(t.at(A.id), A.id, parcelInput(true));
    const old = new Date(Date.now() - (OPEN_JOB_EXPIRY_MINUTES + 1) * 60_000).toISOString();
    // Not yet: a fresh trip keeps waiting.
    await dispatch({ db: t.env.DB, audit: t.admin.audit, env: t.env });
    expect((await myJobs(t.sender))[0]).toMatchObject({ status: "open" });
    t.db.exec(`update delivery_jobs set created_at = '${old}'`);
    await dispatch({ db: t.env.DB, audit: t.admin.audit, env: t.env });
    expect((await myJobs(t.sender))[0]).toMatchObject({ id: booking.id, status: "cancelled", noDriver: true });
    expect(t.db.prepare("select status from delivery_jobs where parcel_id = ?").get(express.id)).toEqual({ status: "open" });
    expect(sent.filter((m) => m.subject === "Aucun chauffeur disponible")).toEqual([expect.objectContaining({ to: "ama@example.tg" })]);
    // Logged without an actor, with the reason.
    const audit = t.db.prepare("select actor, changes from audit_log where table_name = 'delivery_jobs' and row_id = ?").all(booking.id) as { actor: string | null; changes: string }[];
    expect(audit.some((a) => a.actor === null && JSON.parse(a.changes).reason === "no_driver")).toBe(true);
  });
});

describe("a trip the customer calls off", () => {
  it("tells the driver it was offered to, who goes back into line", async () => {
    const t = setup();
    const sent: { to: string; subject: string }[] = [];
    (t.env as { EMAIL?: unknown }).EMAIL = { send: async (m: { to: string; subject: string }) => void sent.push(m) };
    const driver = await approvedDriver(t, "d1");
    t.db.exec("update users set email = 'kodjo@example.tg' where id = 'd1'");
    await joinQueue(driver.me, B.id, B);
    const booking = await bookPickup(t.sender, { home: HOME, toStationId: A.id, recipientPhone: "92 00 00 00", content: "Vêtements", size: "M" });
    await acceptJob(driver.me, booking.id);
    sent.length = 0;
    await cancelJob(t.sender, booking.id);
    expect(sent).toEqual([expect.objectContaining({ to: "kodjo@example.tg", subject: "Course annulée" })]);
    expect((await driverHome(driver.me)).driver?.queue).toMatchObject({ stationId: B.id });
  });
});
