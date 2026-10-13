import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CODE, DemoBackend } from "../backend/demo";

// Runs without a browser: the demo falls back to in-memory storage.
const STATION = "st-grand-marche"; // open around the clock in the demo data

async function asRole(backend: DemoBackend, role: "customer" | "operator") {
  await backend.register("+22890123456", DEMO_CODE, "2580", role);
}

describe("DemoBackend reservations", () => {
  let backend: DemoBackend;
  beforeEach(() => {
    // Midday in Lomé, so every demo station is within its opening hours.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    backend = new DemoBackend();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the customer a pickup code that staff never see", async () => {
    await asRole(backend, "customer");
    const r = await backend.reserve(STATION, "battery");
    expect(r.pickupCode).toMatch(/^\d{4}$/);
    const staffView = await backend.stationReservations(STATION);
    expect(staffView.find((x) => x.id === r.id)?.pickupCode).toBeUndefined();
  });

  it("completes only with the right code and takes the battery off the counter", async () => {
    await asRole(backend, "customer");
    const r = await backend.reserve(STATION, "battery");
    const before = (await backend.listStations()).find((s) => s.id === STATION)!.status.fullBatteries;

    await expect(backend.completeReservation(r.id, r.pickupCode!)).rejects.toMatchObject({ code: "own_reservation" });

    await asRole(backend, "operator");
    const wrong = r.pickupCode === "0000" ? "1111" : "0000";
    await expect(backend.completeReservation(r.id, wrong)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await backend.completeReservation(r.id, r.pickupCode!);

    const after = (await backend.listStations()).find((s) => s.id === STATION)!;
    expect(after.status.fullBatteries).toBe(before - 1);
    expect(after.reservedBatteries).toBe(0);
  });

  it("cancels active reservations when the station closes", async () => {
    await asRole(backend, "customer");
    const r = await backend.reserve(STATION, "slot");
    await asRole(backend, "operator");
    await backend.updateStatus(STATION, { isOpen: false });
    await asRole(backend, "customer");
    const mine = (await backend.myReservations()).find((x) => x.id === r.id)!;
    expect(mine.status).toBe("cancelled");
    expect(mine.cancelReason).toBe("station_closed");
  });

  it("pauses re-reserving at a station after cancelling there", async () => {
    await asRole(backend, "customer");
    const r = await backend.reserve(STATION, "battery");
    await backend.cancelReservation(r.id);
    await expect(backend.reserve(STATION, "battery")).rejects.toMatchObject({ code: "cooldown" });
  });

  it("limits unused reservations per day", async () => {
    await asRole(backend, "customer");
    for (const station of ["st-tokoin", "st-agoe", "st-universite"]) {
      const r = await backend.reserve(station, station === "st-universite" ? "slot" : "battery");
      await backend.cancelReservation(r.id);
    }
    await expect(backend.reserve(STATION, "battery")).rejects.toMatchObject({ code: "daily_limit" });
  });
});

describe("DemoBackend account deletion", () => {
  it("needs the code, then removes the login and the reservations", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const backend = new DemoBackend();
    await asRole(backend, "customer");
    await backend.reserve(STATION, "battery");

    // The account has no e-mail address, so no code can go there.
    await expect(backend.sendDeleteCode("email")).rejects.toBeTruthy();
    await backend.sendDeleteCode("sms");
    await expect(backend.deleteAccount("sms", "000000")).rejects.toMatchObject({ code: "invalid_code" });
    await backend.deleteAccount("sms", DEMO_CODE);

    expect(await backend.getProfile()).toBeNull();
    await expect(backend.signIn("+22890123456", "2580")).rejects.toMatchObject({ code: "invalid_pin" });
    expect((await backend.listStations()).find((s) => s.id === STATION)!.reservedBatteries).toBe(0);
    vi.useRealTimers();
  });
});

describe("DemoBackend connected sockets", () => {
  it("lets an admin add, switch and remove a socket", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890123456", DEMO_CODE, "2580", "admin");
    const before = await backend.listDevices();
    const outletsBefore = (await backend.listStations()).find((s) => s.id === STATION)!.chargingSlots;

    await expect(backend.createDevice({ externalId: "x", stationId: STATION })).rejects.toMatchObject({ code: "invalid_device" });
    await backend.createDevice({ externalId: "123456", stationId: STATION, outlets: 2, link: "vendor_cloud" });
    await expect(backend.createDevice({ externalId: "123456", stationId: STATION })).rejects.toMatchObject({ code: "device_exists" });

    const added = (await backend.listDevices()).find((d) => d.externalId === "123456")!;
    expect(added.points.map((p) => p.label)).toEqual(["3456-1", "3456-2"]);
    const station = (await backend.listStations()).find((s) => s.id === STATION)!;
    expect(station.chargingPoints).toHaveLength(outletsBefore + 2);
    expect(station.chargingSlots).toBe(outletsBefore + 2);

    await backend.switchOutlet("123456", 2, true);
    expect((await backend.listDevices()).find((d) => d.externalId === "123456")!.points[1].status).toBe("charging");

    await backend.deleteDevice("123456");
    expect(await backend.listDevices()).toHaveLength(before.length);
  });

  it("is admin only", async () => {
    const backend = new DemoBackend();
    await asRole(backend, "customer");
    await expect(backend.listDevices()).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("DemoBackend station points", () => {
  it("keeps parcel points and refuses stations without any point", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890123456", DEMO_CODE, "2580", "admin");
    const base = {
      operatorId: "op-poinderecharge",
      name: "Casiers",
      address: "",
      lat: 6.13,
      lng: 1.22,
      vehicleTypes: [],
      chargingSlots: 5,
      batteryCapacity: 0,
      openingHours: "",
      phone: null,
    };
    await expect(backend.saveStation(null, { ...base, kind: "parcel" })).rejects.toMatchObject({ code: "station_without_point" });
    await backend.saveStation(null, { ...base, kind: "parcel", parcelDepot: { isActive: true, counter: false, lockers: 10, note: "" } });
    const s = (await backend.listStations()).find((x) => x.name === "Casiers")!;
    expect(s.kind).toBe("parcel");
    expect(s.chargingSlots).toBe(0);
    expect(s.parcelPoint).toEqual({ counter: false, lockers: 10 });
    await expect(backend.saveParcelDepot(s.id, { isActive: false, note: "", lockers: 0 })).rejects.toMatchObject({ code: "station_without_point" });
  });
});
