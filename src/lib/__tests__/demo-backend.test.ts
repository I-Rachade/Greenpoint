import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveStation } from "../active-station";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { reservableOutlets, reservableTypes } from "../reservations";

// Runs without a browser: the demo falls back to in-memory storage.
const STATION = "st-grand-marche"; // open around the clock in the demo data

async function asRole(backend: DemoBackend, role: "customer" | "operator") {
  await backend.register("+22890123456", DEMO_CODE, "2580", role);
}

/** Reserves what the station offers: its first free battery type, or its first free outlet (none at a counted station). */
async function reserveAny(backend: DemoBackend, stationId: string, kind: "battery" | "slot") {
  const station = (await backend.listStations()).find((s) => s.id === stationId)!;
  const target = kind === "battery" ? (reservableTypes(station)[0]?.id ?? null) : (reservableOutlets(station)[0]?.id ?? null);
  return backend.reserve(stationId, kind, target);
}

describe("DemoBackend reservations", () => {
  let backend: DemoBackend;
  beforeEach(() => {
    // Midday in Lomé, so every demo station is within its opening hours.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    backend = new DemoBackend();
    setActiveStation(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("gives the customer a pickup code that staff never see", async () => {
    await asRole(backend, "customer");
    const r = await reserveAny(backend, STATION, "battery");
    expect(r.pickupCode).toMatch(/^\d{4}$/);
    const staffView = await backend.stationReservations(STATION);
    expect(staffView.find((x) => x.id === r.id)?.pickupCode).toBeUndefined();
  });

  it("completes a battery reservation by its swap, only with the right code, once", async () => {
    await asRole(backend, "customer");
    const r = await reserveAny(backend, STATION, "battery");
    const before = (await backend.listStations()).find((s) => s.id === STATION)!.status.fullBatteries;
    const swap = (requestId: string, pickupCode: string, batteryTypeId?: string | null) =>
      backend.recordSwap(STATION, { requestId, customerType: "app", reservationId: r.id, pickupCode, batteryTypeId, payment: "cash" });

    // Only station staff complete, at their active station (as in the Worker).
    await expect(swap("req-0000001", r.pickupCode!)).rejects.toMatchObject({ code: "forbidden" });

    await asRole(backend, "operator");
    await expect(swap("req-0000001", r.pickupCode!)).rejects.toMatchObject({ code: "active_station_required" });
    setActiveStation(STATION);
    // The code alone no longer completes a battery reservation: the swap does.
    await expect(backend.completeReservation(r.id, r.pickupCode!)).rejects.toMatchObject({ code: "swap_required" });
    const wrong = r.pickupCode === "0000" ? "1111" : "0000";
    await expect(swap("req-0000001", wrong)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    const other = (await backend.listStations()).find((s) => s.id === STATION)!.batteryTypes?.find((t) => t.id !== r.target);
    if (r.target && other) await expect(swap("req-0000001", r.pickupCode!, other.id)).rejects.toMatchObject({ code: "battery_type_mismatch" });
    await swap("req-0000001", r.pickupCode!);
    expect(await backend.stationSwaps(STATION)).toMatchObject([{ customerType: "app", payment: "cash", reservationId: r.id, batteryTypeId: r.target ?? "" }]);
    await expect(swap("req-0000002", r.pickupCode!)).rejects.toMatchObject({ code: "reservation_not_active" });

    const after = (await backend.listStations()).find((s) => s.id === STATION)!;
    expect(after.status.fullBatteries).toBe(before - 1);
    expect(after.reservedBatteries).toBe(0);
  });

  it("reserves by type as the Worker: type named, free battery of it, free outlet, riders only", async () => {
    await asRole(backend, "operator");
    await expect(backend.reserve(STATION, "swap", null)).rejects.toMatchObject({ code: "forbidden" });
    await asRole(backend, "customer");
    await expect(backend.reserve(STATION, "swap", null)).rejects.toMatchObject({ code: "battery_type_required" });
    await expect(backend.reserve(STATION, "swap", "nope")).rejects.toMatchObject({ code: "battery_type_unavailable" });
    // A station with connected outlets: the customer picks one.
    await expect(backend.reserve(STATION, "charging_point", null)).rejects.toMatchObject({ code: "outlet_required" });
    const station = (await backend.listStations()).find((s) => s.id === STATION)!;
    const type = reservableTypes(station)[0];
    const r = await backend.reserve(STATION, "swap", type.id);
    expect(r).toMatchObject({ kind: "swap", target: type.id, targetKind: "battery_type" });
    const after = (await backend.listStations()).find((s) => s.id === STATION)!;
    expect(after.batteryTypes?.find((t) => t.id === type.id)?.reserved).toBe(1);
    expect((await backend.stationReservations(STATION))[0].customer).toBeTruthy();

  });

  it("locks a reservation after 5 wrong codes", async () => {
    await asRole(backend, "customer");
    const r = await reserveAny(backend, "st-universite", "slot");
    await asRole(backend, "operator");
    setActiveStation("st-universite");
    const wrong = r.pickupCode === "0000" ? "1111" : "0000";
    for (let i = 0; i < 5; i++) await expect(backend.completeReservation(r.id, wrong)).rejects.toMatchObject({ code: "wrong_pickup_code" });
    await expect(backend.completeReservation(r.id, r.pickupCode!)).rejects.toMatchObject({ code: "code_locked" });
  });

  it("cancels active reservations when the station closes", async () => {
    await asRole(backend, "customer");
    const r = await reserveAny(backend, STATION, "slot");
    await asRole(backend, "operator");
    setActiveStation(STATION);
    await backend.updateStatus(STATION, { isOpen: false });
    await asRole(backend, "customer");
    const mine = (await backend.myReservations()).find((x) => x.id === r.id)!;
    expect(mine.status).toBe("cancelled");
    expect(mine.cancelReason).toBe("station_closed");
  });

  it("pauses re-reserving at a station after cancelling there", async () => {
    await asRole(backend, "customer");
    const r = await reserveAny(backend, STATION, "battery");
    await backend.cancelReservation(r.id);
    await expect(reserveAny(backend, STATION, "battery")).rejects.toMatchObject({ code: "cooldown" });
  });

  it("limits unused reservations per day", async () => {
    await asRole(backend, "customer");
    for (const station of ["st-tokoin", "st-agoe", "st-universite"]) {
      const r = await reserveAny(backend, station, station === "st-universite" ? "slot" : "battery");
      await backend.cancelReservation(r.id);
    }
    await expect(reserveAny(backend, STATION, "battery")).rejects.toMatchObject({ code: "daily_limit" });
  });
});

describe("DemoBackend account deletion", () => {
  it("needs the code, then removes the login and the reservations", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    const backend = new DemoBackend();
    await asRole(backend, "customer");
    await reserveAny(backend, STATION, "battery");

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

    // Not while a charge runs on one of its outlets (as the Worker).
    const charge = await backend.startCharge(STATION, { pointId: added.points[0].id });
    await expect(backend.deleteDevice("123456")).rejects.toMatchObject({ code: "charge_busy" });
    await backend.stopCharge(STATION, charge.id);

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

describe("DemoBackend driver accounts (phase 5, as in the Worker)", () => {
  let backend: DemoBackend;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    backend = new DemoBackend();
    setActiveStation(null);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps a driver account out of customer things (R11) and gives no greenpoints", async () => {
    await backend.register("+22890123456", DEMO_CODE, "2580", "driver");
    const home = await backend.driverHome();
    expect(home.driver?.status).toBe("active");
    expect(home.formerAccount).toBeNull();
    await expect(backend.myWallet()).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.myGreenpoint()).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.reserve(STATION, "battery", null)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.bookPickup({ home: { lat: 6.13, lng: 1.22, note: "" }, toStationId: STATION } as never)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.sendFormerAccountCode("+22899999999")).rejects.toMatchObject({ code: "account_not_found" });
  });

  it("takes only a valid, fresh driver pass for a fleet swap (R10)", async () => {
    await backend.register("+22890123456", DEMO_CODE, "2580", "driver");
    const pass = await backend.driverPass();
    const code = (await backend.driverHome()).driver!.code!;
    await backend.signIn("+22890123456", "2580", "operator");
    setActiveStation(STATION);
    const batteryTypeId = (await backend.listStations()).find((s) => s.id === STATION)!.batteryTypes?.[0]?.id ?? null;
    const swap = (requestId: string, driverCode: string) => backend.recordSwap(STATION, { requestId, customerType: "fleet", driverCode, batteryTypeId });
    await expect(swap("req-fleet-01", `POINDERECHARGE-CHAUFFEUR:${code}`)).rejects.toMatchObject({ code: "driver_pass_invalid" });
    await expect(swap("req-fleet-01", pass.payload.replace(/.$/, (c) => (c === "0" ? "1" : "0")))).rejects.toMatchObject({ code: "driver_pass_invalid" });
    vi.setSystemTime(new Date("2026-10-12T12:11:00Z"));
    await expect(swap("req-fleet-01", pass.payload)).rejects.toMatchObject({ code: "driver_pass_expired" });
    vi.setSystemTime(new Date("2026-10-12T12:05:00Z"));
    const done = await swap("req-fleet-02", pass.payload);
    expect(done.payment).toBe("fleet");
  });

  it("refuses the driver role in the generic role change", async () => {
    await backend.register("+22890123456", DEMO_CODE, "2580", "driver");
    await backend.signIn("+22890123456", "2580", "admin");
    await expect(backend.setUserRole("demo-customer", "driver")).rejects.toMatchObject({ message: "bad_request" });
    await expect(backend.setUserRole("demo-driver", "customer")).rejects.toMatchObject({ code: "has_other_role" });
  });
});
