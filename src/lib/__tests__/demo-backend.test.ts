import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveStation } from "../active-station";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { reservableOutlets, reservableTypes } from "../reservations";
import { boxFromCode, boxQrUrl, socketQrUrl } from "../charging";

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
      backend.recordSwap(STATION, { requestId, customerType: "app", reservationId: r.id, pickupCode, batteryTypeId, payment: "cash", batteryIn: `IN-${requestId}`, batteryOut: `OUT-${requestId}` });

    // Only station staff complete, at their active station (as in the Worker).
    await expect(swap("req-0000001", r.pickupCode!)).rejects.toMatchObject({ code: "forbidden" });

    await asRole(backend, "operator");
    // Kossi works at this station only (W2); another chosen station is refused.
    setActiveStation("st-tokoin");
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
    // No staff at the Université (W2): an admin completes, with the station chosen.
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
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
    setActiveStation(STATION);
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
  it("starts and stops a charge by QR code where the admin allowed it", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890123456", DEMO_CODE, "2580", "admin");
    const device = (await backend.listDevices()).find((d) => d.stationId === STATION)!;
    const point = device.points.find((p) => p.status === "free")!;
    const token = device.qrToken!;
    const stateOf = async () => (await backend.chargeOutlet(token)).outlets.find((o) => o.pointId === point.id)!.state;
    expect(await stateOf()).toBe("disabled");
    await expect(backend.startOutletCharge(token, point.id, "2580")).rejects.toMatchObject({ code: "charge_qr_disabled" });

    await backend.setQrStart(point.id, true);
    expect((await backend.listStations()).find((s) => s.id === STATION)!.chargingPoints!.find((p) => p.id === point.id)!.qrStart).toBe(true);
    expect(await stateOf()).toBe("free");
    const charge = await backend.startOutletCharge(token, point.id, "2580");
    expect(charge).toMatchObject({ status: "charging", selfStarted: true });
    expect(await stateOf()).toBe("busy");
    // One charge at a time until it is paid.
    const other = device.points.find((p) => p.status === "free" && p.id !== point.id)!;
    await backend.setQrStart(other.id, true);
    await expect(backend.startOutletCharge(token, other.id, "2580")).rejects.toMatchObject({ code: "charge_unpaid" });
    // Paid in advance from Green Credit: a charge that took no energy is closed at once.
    expect((await backend.stopSelfCharge(charge.id)).status).toBe("cancelled");
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
      openingHours: "07:00-21:00",
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
    const swap = (requestId: string, driverCode: string) => backend.recordSwap(STATION, { requestId, customerType: "fleet", driverCode, batteryTypeId, batteryIn: `IN-${requestId}`, batteryOut: `OUT-${requestId}` });
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

describe("DemoBackend fleets (phase 6, as in the Worker)", () => {
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

  it("registers a fleet manager with a pending fleet, blocked until an admin approves (W5)", async () => {
    const profile = await backend.registerFleetManager("+22891112233", DEMO_CODE, "2580", "Moto Lomé");
    expect(profile.role).toBe("fleet_manager");
    const view = await backend.fleetView();
    expect(view.fleet?.status).toBe("pending");
    expect(view.drivers).toEqual([]);
    await expect(backend.inviteFleetDriver("+22891000001")).rejects.toMatchObject({ code: "fleet_not_approved" });
    // R11: a fleet manager is not a customer.
    await expect(backend.myWallet()).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.myGreenpoint()).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.reserve(STATION, "battery", null)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.registerFleetManager("+22891112233", DEMO_CODE, "2580", "Encore")).rejects.toMatchObject({ code: "account_exists" });

    await backend.register("+22890123456", DEMO_CODE, "2580", "admin");
    const pending = (await backend.adminFleets()).find((f) => f.managerId === profile.id)!;
    expect(pending.status).toBe("pending");
    await backend.reviewFleet(profile.id, "approve");
    expect((await backend.adminFleets()).find((f) => f.managerId === profile.id)?.status).toBe("approved");
  });

  it("limits a standard fleet to 3 places, invites included (R13), and locks the statistics", async () => {
    await backend.register("+22890123456", DEMO_CODE, "2580", "fleet_manager");
    const view = await backend.fleetView();
    expect(view.fleet?.tier).toBe("standard");
    await expect(backend.fleetStats("2026-10-01", "2026-10-12")).rejects.toMatchObject({ code: "fleet_locked" });
    const free = (view.fleet!.driverLimit ?? 0) - view.fleet!.used;
    for (let i = 0; i < free; i++) await backend.inviteFleetDriver(`+2289100000${i}`);
    await expect(backend.inviteFleetDriver("+22891000009")).rejects.toMatchObject({ code: "fleet_limit" });
    const invite = (await backend.fleetView()).invites[0];
    await backend.revokeFleetInvite(invite.id);
    await backend.inviteFleetDriver("+22891000009");
  });

  it("lets an empty customer account accept an invite and become a driver (R12)", async () => {
    await backend.register("+22890123456", DEMO_CODE, "2580", "admin");
    await backend.setDriversEnabled(true);
    await backend.register("+22890123456", DEMO_CODE, "2580", "fleet_manager");
    const invite = await backend.inviteFleetDriver("+22897777777");
    await expect(backend.inviteFleetDriver("+22897777777")).rejects.toMatchObject({ code: "invite_pending" });
    await backend.register("+22897777777", DEMO_CODE, "2580", "customer");
    const mine = await backend.myFleetInvites();
    expect(mine.map((i) => i.token)).toContain(invite.token);
    const application = { fullName: "Kossi Mensah", idNumber: "TG-12345", licenseNumber: "LIC-987", wantedType: "moto" as const };
    await backend.acceptFleetInvite(invite.token.toLowerCase(), mine.find((i) => i.token === invite.token)!.needsApplication ? application : undefined);
    const home = await backend.driverHome();
    expect(home.driver).not.toBeNull();
    expect((await backend.getProfile())?.role).toBe("driver");
    await expect(backend.myFleetInvites()).resolves.toEqual([]);
  });
});

describe("DemoBackend merchants", () => {
  let backend: DemoBackend;
  const SHOP = { lat: 6.1382, lng: 1.2431 };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
    backend = new DemoBackend();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the demo shop: team limit, booking, assigned driver checked in at an hourly rate", async () => {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.setDriversEnabled(true);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    const code = (await backend.driverHome()).driver!.code!;

    const merchant = await backend.register("+22890000006", DEMO_CODE, "2580", "merchant");
    expect(merchant.merchant).toMatchObject({ name: "Boutique Akwaba", status: "approved", isOwner: true });
    // R11: a merchant is not a customer.
    await expect(backend.reserve(STATION, "battery", null)).rejects.toMatchObject({ code: "forbidden" });
    const assignment = await backend.addMerchantDriver({ kind: "assigned", driver: code, payMode: "hourly", ratePerHourFcfa: 1000 });
    expect(assignment.status).toBe("pending");
    await expect(backend.addMerchantDriver({ kind: "assigned", driver: code, payMode: "per_trip" })).rejects.toMatchObject({ code: "merchant_driver_exists" });
    const invite = await backend.inviteMerchantEmployee("+22897100001");
    await backend.inviteMerchantEmployee("+22897100002");
    await backend.inviteMerchantEmployee("+22897100003");
    await expect(backend.inviteMerchantEmployee("+22897100004")).rejects.toMatchObject({ code: "merchant_limit" });

    // The invited customer accepts and books a courier for the shop.
    await backend.register("+22897100001", DEMO_CODE, "2580", "customer");
    expect((await backend.myMerchantInvites()).map((i) => i.merchantName)).toEqual(["Boutique Akwaba"]);
    await backend.acceptMerchantInvite(invite.token);
    expect((await backend.getProfile())?.merchant).toMatchObject({ isOwner: false });
    const job = await backend.bookCourier({
      pickup: { ...SHOP, note: "Boutique", phone: "+22890000066" },
      dropoff: { lat: 6.13, lng: 1.22, note: "Porte bleue" },
      recipientPhone: "+22897200001",
      content: "Pagne",
      size: "S",
    });
    expect(job.customerName).toBe("Boutique Akwaba");
    await expect(backend.merchantActivity()).rejects.toMatchObject({ code: "forbidden" });

    // The driver approves, checks in near the shop and gets the shop's trip first.
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.decideMerchantAssignment(assignment.id, true);
    await expect(backend.checkInAtShop("merchant-akwaba", { lat: 6.2, lng: 1.2 })).rejects.toMatchObject({ code: "too_far" });
    await backend.checkInAtShop("merchant-akwaba", SHOP);
    const home = await backend.driverHome();
    expect(home.job?.id).toBe(job.id);
    await backend.acceptJob(job.id);
    await backend.boardRide(job.id);
    await expect(backend.checkOutOfShop()).rejects.toMatchObject({ code: "driver_busy" });

    await backend.register("+22897100001", DEMO_CODE, "2580", "customer");
    const handover = (await backend.myJobs()).find((j) => j.id === job.id)!.handoverCode!;
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.finishRide(job.id, handover);
    // Decision A: no share of the fare for an hourly driver.
    expect((await backend.driverHome()).ledger.filter((e) => e.kind === "earning")).toEqual([]);
    await expect(backend.joinDriverQueue("st-be", SHOP)).rejects.toMatchObject({ code: "checked_in_at_shop" });
    vi.setSystemTime(new Date("2026-10-12T11:00:00Z"));
    await backend.checkOutOfShop();
    const shops = await backend.driverShops();
    expect(shops.checkin).toBeNull();
    expect(shops.unpaid.map((k) => k.amountFcfa)).toEqual([2000]);
    await backend.confirmShopHoursReceived(shops.unpaid[0].id);

    await backend.register("+22890000006", DEMO_CODE, "2580", "merchant");
    const view = await backend.merchantView();
    expect(view.members.map((m) => m.isOwner)).toEqual([true, false]);
    expect(view.today.done).toBe(1);
    expect((await backend.merchantActivity()).some((a) => a.table === "merchant_checkins")).toBe(true);
    await expect(backend.removeMerchantEmployee(view.merchant.ownerId)).rejects.toMatchObject({ code: "forbidden" });
    await backend.removeMerchantEmployee(view.members[1].userId);

    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.reviewMerchant("merchant-akwaba", "suspend");
    await backend.register("+22890000006", DEMO_CODE, "2580", "merchant");
    await expect(backend.bookRide({ pickup: { ...SHOP, note: "", phone: "+22890000066" }, dropoff: { lat: 6.13, lng: 1.22, note: "" }, passengers: 1 })).rejects.toMatchObject({
      code: "merchant_not_approved",
    });
  });

  it("phase 2: saved addresses, statistics once unlocked, a courier back at the shop", async () => {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.setDriversEnabled(true);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.joinDriverQueue("st-be", SHOP);

    await backend.register("+22890000006", DEMO_CODE, "2580", "merchant");
    const saved = await backend.addMerchantAddress({ label: "Entrepôt", address: "Zone portuaire", phone: "90 11 22 44", ...SHOP });
    expect((await backend.merchantView()).addresses.map((a) => a.label)).toEqual(["Entrepôt"]);
    await expect(backend.merchantStats({ from: "2026-10-12", to: "2026-10-12", group: "day" })).rejects.toMatchObject({ code: "merchant_locked" });
    const job = await backend.bookCourier({
      pickup: { lat: saved.lat, lng: saved.lng, note: saved.address, phone: saved.phone },
      dropoff: { lat: 6.13, lng: 1.22, note: "Porte bleue" },
      recipientPhone: "+22897200001",
      content: "Pagne",
      size: "S",
    });

    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.acceptJob(job.id);
    await backend.boardRide(job.id);
    await backend.arriveAtDoor(job.id);
    await expect(backend.failDelivery(job.id)).rejects.toMatchObject({ code: "wait_longer" });
    vi.setSystemTime(new Date("2026-10-12T10:00:00Z"));
    await backend.failDelivery(job.id);

    await backend.register("+22890000006", DEMO_CODE, "2580", "merchant");
    expect((await backend.merchantView()).live.find((j) => j.id === job.id)).toMatchObject({ status: "returning", forShop: true });
    await backend.confirmShopReturn(job.id);
    await expect(backend.confirmShopReturn(job.id)).rejects.toMatchObject({ code: "job_wrong_status" });

    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.setMerchantTier("merchant-akwaba", "unlocked");
    await backend.register("+22890000006", DEMO_CODE, "2580", "merchant");
    const stats = await backend.merchantStats({ from: "2026-10-12", to: "2026-10-12", group: "day" });
    expect(stats.totals).toMatchObject({ booked: 1, failed: 1, spendFcfa: job.fareFcfa });
    await backend.removeMerchantAddress(saved.id);
    expect((await backend.merchantView()).addresses).toEqual([]);
  });

  it("registers a merchant with a pending shop", async () => {
    const profile = await backend.registerMerchant("+22897300001", DEMO_CODE, "2580", { name: "Chez Ama", phone: "+22897300002", address: "Tokoin", lat: 6.15, lng: 1.22 });
    expect(profile.merchant).toMatchObject({ name: "Chez Ama", status: "pending", isOwner: true });
    await expect(backend.inviteMerchantEmployee("+22897300003")).rejects.toMatchObject({ code: "merchant_not_approved" });
    expect((await backend.merchantView()).merchant.status).toBe("pending");
  });
});

describe("DemoBackend driver phase 2 (as in the Worker)", () => {
  let backend: DemoBackend;
  const HOME = { lat: 6.1382, lng: 1.2431, note: "Maison", phone: "+22890123456" };
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T09:00:00Z"));
    backend = new DemoBackend();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pays a courier from the wallet, refunds a cancelled one and pays the driver out on the phone", async () => {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.setDriversEnabled(true);
    await backend.setWalletEnabled(true);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.joinDriverQueue("st-be", HOME);

    await asRole(backend, "customer");
    const before = (await backend.myWallet()).balanceXof;
    const booking = { pickup: HOME, dropoff: { lat: 6.13, lng: 1.22, note: "Porte bleue" }, recipientPhone: "+22897200001", content: "Pagne", size: "S" as const };
    const job = await backend.bookCourier({ ...booking, payWith: "wallet" });
    expect(job).toMatchObject({ prepaidFcfa: job.fareFcfa, collectFcfa: 0 });
    expect((await backend.myWallet()).balanceXof).toBe(before - job.fareFcfa);
    const second = await backend.bookCourier({ ...booking, payWith: "wallet" });
    await backend.cancelJob(second.id);
    expect((await backend.myWallet()).balanceXof).toBe(before - job.fareFcfa);
    expect((await backend.myJobs()).find((j) => j.id === second.id)).toMatchObject({ refunded: true });

    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.acceptJob(job.id);
    await backend.boardRide(job.id);
    await asRole(backend, "customer");
    const code = (await backend.myJobs()).find((j) => j.id === job.id)!.handoverCode!;
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.finishRide(job.id, code);
    const home = await backend.driverHome();
    expect(home.ledger.map((e) => e.kind)).toEqual(["earning"]);
    const owed = -home.driver!.balanceFcfa;
    expect((await backend.requestDriverPayout("flooz", "90 11 22 33")).amountFcfa).toBe(owed);
    await expect(backend.requestDriverPayout("flooz", "90 11 22 33")).rejects.toMatchObject({ code: "payout_pending" });

    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    const [payout] = await backend.adminDriverPayouts();
    await backend.decideDriverPayout(payout.id, "paid", "FL-1");
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    expect((await backend.driverHome()).driver!.balanceFcfa).toBe(0);
    expect((await backend.driverHome()).payout).toMatchObject({ status: "paid", reference: "FL-1" });
  });

  it("holds the share of a courier handed over by photo until the sender confirms, and settles cash only for the pass", async () => {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.setDriversEnabled(true);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.joinDriverQueue("st-be", HOME);
    await asRole(backend, "customer");
    const job = await backend.bookCourier({ pickup: HOME, dropoff: { lat: 6.13, lng: 1.22, note: "Porte bleue" }, recipientPhone: "+22897200001", content: "Pagne", size: "S" });
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.acceptJob(job.id);
    await backend.boardRide(job.id);
    // No FileReader in Node: a stand-in that reads every photo as the same data URL.
    vi.stubGlobal(
      "FileReader",
      class {
        result = "data:image/jpeg;base64,AQID";
        onload: (() => void) | null = null;
        readAsDataURL() {
          this.onload?.();
        }
      },
    );
    await backend.uploadDeliveryPhoto(job.id, new File([new Uint8Array([1, 2, 3])], "door.jpg", { type: "image/jpeg" }));
    vi.unstubAllGlobals();
    await backend.finishRide(job.id);
    expect((await backend.driverHome()).ledger.map((e) => e.kind)).toEqual(["collected"]);

    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    expect((await backend.adminDrivers()).jobs.find((j) => j.id === job.id)?.proofReview).toBe("pending");
    await asRole(backend, "customer");
    expect((await backend.myJobs()).find((j) => j.id === job.id)?.proofReview).toBe("pending");
    await backend.confirmCourierReceipt(job.id);
    await expect(backend.confirmCourierReceipt(job.id)).rejects.toMatchObject({ code: "job_wrong_status" });
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    const home = await backend.driverHome();
    expect(home.ledger.map((e) => e.kind).sort()).toEqual(["collected", "earning"]);
    const pass = (await backend.driverPass()).payload;

    // The driver hands in the cash at the counter: the typed code is not enough, the pass is.
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    setActiveStation("st-be");
    await expect(backend.settleDriver("st-be", home.driver!.code!, home.driver!.balanceFcfa)).rejects.toMatchObject({ code: "driver_pass_required" });
    await expect(backend.settleDriver("st-be", pass.replace(/.$/, (c) => (c === "0" ? "1" : "0")), home.driver!.balanceFcfa)).rejects.toMatchObject({ code: "driver_pass_invalid" });
    await backend.settleDriver("st-be", pass, home.driver!.balanceFcfa);
    setActiveStation(null);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    expect((await backend.driverHome()).driver!.balanceFcfa).toBe(0);
  });

  it("adds a nearby parcel trip to a busy driver's tour", async () => {
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    await backend.setDriversEnabled(true);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.joinDriverQueue("st-be", HOME);
    await asRole(backend, "customer");
    const booking = { pickup: HOME, dropoff: { lat: 6.13, lng: 1.22, note: "Porte bleue" }, recipientPhone: "+22897200001", content: "Pagne", size: "S" as const };
    const first = await backend.bookCourier(booking);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    await backend.acceptJob(first.id);
    await backend.reportDriverPosition({ lat: HOME.lat, lng: HOME.lng });
    await asRole(backend, "customer");
    const second = await backend.bookCourier(booking);
    await backend.register("+22893000009", DEMO_CODE, "2580", "driver");
    const home = await backend.driverHome();
    expect(home.jobs?.map((j) => [j.id, j.status])).toEqual([
      [second.id, "assigned"],
      [first.id, "accepted"],
    ]);
  });
});

describe("outlet QR codes", () => {
  it("link one code to the whole box and one derived code to each outlet", () => {
    const token = "0123456789abcdef0123456789abcdef";
    const url = boxQrUrl("https://app.poinderecharge.com/", token);
    expect(url).toBe(`https://app.poinderecharge.com/recharge?o=${token}`);
    expect(boxFromCode(` ${url} `)).toEqual({ token, outlet: null });
    expect(socketQrUrl("https://app.poinderecharge.com", token, 3)).toBe(`${url}&s=3`);
    expect(boxFromCode(socketQrUrl("https://app.poinderecharge.com", token, 3))).toEqual({ token, outlet: 3 });
    expect(boxFromCode(`${url}&s=99`)).toEqual({ token, outlet: null });
    // The older per-outlet codes, by charging point id, no longer open anything.
    expect(boxFromCode("https://app.poinderecharge.com/recharge?p=1f0c-ab")).toBeNull();
    expect(boxFromCode("https://app.poinderecharge.com/recharge?o=DEVEUI123")).toBeNull();
    expect(boxFromCode("https://example.com/pay?o=" + token)).toBeNull();
    expect(boxFromCode("poinderecharge:id:+22890123456")).toBeNull();
  });

  it("lets the customer pick a free outlet of the scanned box", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890999999", DEMO_CODE, "2580", "admin");
    const device = (await backend.listDevices()).find((d) => d.externalId === "DEMO-UL01")!;
    for (const p of device.points) await backend.setQrStart(p.id, true);
    const token = device.qrToken!;
    const info = await backend.chargeOutlet(token);
    expect(info.outlets.map((o) => o.outlet)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    await backend.register("+22890123456", DEMO_CODE, "2580", "customer");
    const first = info.outlets.find((o) => o.state === "free")!;
    await backend.startOutletCharge(token, first.pointId, "2580");
    expect((await backend.chargeOutlet(token)).outlets.find((o) => o.pointId === first.pointId)?.state).toBe("busy");
    // Only outlets of this box can be started with its code.
    await expect(backend.startOutletCharge(token, "cp-not-here", "2580")).rejects.toMatchObject({ code: "unknown" });

    await backend.register("+22890999999", DEMO_CODE, "2580", "admin");
    const renewed = await backend.renewBoxQr("DEMO-UL01");
    expect(renewed).not.toBe(token);
    await expect(backend.chargeOutlet(token)).rejects.toBeDefined();
  });
});

describe("DemoBackend car chargers (0048)", () => {
  it("shows the connected charger on its station, starts it by QR code at the car price, and keeps its outlet off the motorbike places", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890123456", DEMO_CODE, "2580", "admin");
    const station = (await backend.listStations()).find((s) => s.id === STATION)!;
    const car = station.evChargers!.find((c) => c.point)!;
    expect(car).toMatchObject({ name: "Borne VE 1", point: { qrStart: true, status: "free" } });
    expect(station.chargingPoints!.some((p) => p.id === car.point!.id)).toBe(false);

    const device = (await backend.listDevices()).find((d) => d.points.some((p) => p.id === car.point!.id))!;
    const info = await backend.chargeOutlet(device.qrToken!);
    expect(info.tariff).toEqual({ kwhXof: 200, minXof: 500 });
    expect(info.outlets[0]).toMatchObject({ label: "Borne VE 1", ev: { name: "Borne VE 1", connector: "type2", powerKw: 22 } });
    const charge = await backend.startOutletCharge(device.qrToken!, car.point!.id, "2580");
    expect(charge).toMatchObject({ pointLabel: "Borne VE 1", tariff: { kwhXof: 200, minXof: 500 } });

    // The admin sets a car price apart from the motorbike one; the charger can be unlinked.
    await backend.saveChargeTariff({ ev: true, stationId: null, kwhXof: 250, minXof: 600 });
    const admin = await backend.adminCharging();
    expect(admin).toMatchObject({ defaultTariff: { kwhXof: 150, minXof: 100 }, evTariff: { kwhXof: 250, minXof: 600 } });
    expect(admin.stations.find((s) => s.id === STATION)).toMatchObject({ evChargers: 1 });
    const charger = (await backend.listEvChargers()).find((c) => c.id === car.id)!;
    await expect(backend.saveEvCharger(null, { ...charger, name: "Autre", pointId: charger.pointId })).rejects.toMatchObject({ code: "outlet_busy" });
    await backend.saveEvCharger(charger.id, { ...charger, pointId: null });
    expect((await backend.listStations()).find((s) => s.id === STATION)!.evChargers!.find((c) => c.id === car.id)!.point).toBeUndefined();
  });
});

describe("DemoBackend point partners", () => {
  it("gives a socket to a partner, whose linked customer account then sees it", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890123456", DEMO_CODE, "2580", "customer");
    await expect(backend.pointPartnerDashboard(30)).rejects.toMatchObject({ code: "forbidden" });
    // Another number for the admin: the demo finds an account by its number.
    await backend.register("+22890999999", DEMO_CODE, "2580", "admin");
    const [partner] = await backend.adminPointPartners();
    await backend.addPointPartnerAccount(partner.id, "+22890123456");
    await backend.setDevicePartner("DEMO-UL01", partner.id);
    expect((await backend.adminPointPartners())[0].devices).toEqual([{ externalId: "DEMO-UL01", stationId: "st-universite", outlets: 8 }]);
    await backend.signIn("+22890123456", "2580", "customer");
    expect((await backend.getProfile())?.pointPartner).toMatchObject({ id: partner.id, status: "active" });
    const dash = await backend.pointPartnerDashboard(30);
    expect(dash.points).toHaveLength(8);
    expect(new Set(dash.points.map((p) => p.stationId))).toEqual(new Set(["st-universite"]));
    await backend.signIn("+22890999999", "2580", "admin");
    await backend.setPointPartnerActive(partner.id, false);
    await backend.signIn("+22890123456", "2580", "customer");
    await expect(backend.pointPartnerDashboard(30)).rejects.toMatchObject({ code: "partner_suspended" });
  });
});

describe("DemoBackend station cash (as worker/station-cash.ts)", () => {
  const PARTNER_STATION = "st-hedzranawoe"; // the demo's partner station (op-example)
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes the day, carries a rejected handover over and keeps the commission back", async () => {
    const backend = new DemoBackend();
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    setActiveStation(PARTNER_STATION);
    // Cash put on a card before the card rule of October 2026 (cards are no longer topped up).
    const memory = (backend as unknown as { memory: { cardTopups?: { stationId: string; amountXof: number; at: string }[] } }).memory;
    memory.cardTopups = [{ stationId: PARTNER_STATION, amountXof: 2000, at: new Date().toISOString() }];
    const [before] = await backend.ownerCash(PARTNER_STATION);
    expect(before).toMatchObject({ type: "operator", dueXof: 2000, lines: { cardsXof: 2000, totalXof: 2000 } });
    const input = { stationId: PARTNER_STATION, method: "cash" as const, reference: "Agent Komi", expectedDueXof: 2000 };
    await expect(backend.closeCashDay({ ...input, amountXof: 1500 })).rejects.toMatchObject({ code: "handover_note_required" });
    await expect(backend.closeCashDay({ ...input, amountXof: 1000, expectedDueXof: 1000 })).rejects.toMatchObject({ code: "cash_changed" });
    const h = await backend.closeCashDay({ ...input, amountXof: 2000 });
    expect((await backend.ownerCash(PARTNER_STATION))[0]).toMatchObject({ dueXof: 0, pendingXof: 2000 });
    await expect(backend.decideHandover(h.id, false)).rejects.toMatchObject({ code: "reject_reason_required" });
    expect(await backend.decideHandover(h.id, false, "Rien reçu")).toMatchObject({ status: "rejected" });
    await expect(backend.decideHandover(h.id, true)).rejects.toMatchObject({ code: "handover_decided" });
    expect((await backend.ownerCash(PARTNER_STATION))[0]).toMatchObject({ carryXof: 2000, dueXof: 2000 });
    // A shop station: swaps are ours; commission kept back on what is ours (the top-up is not a sale).
    await backend.saveStationCashSettings(PARTNER_STATION, { swapOwner: "poinderecharge", commissionPct: 10, commissionMode: "deduct" });
    expect((await backend.ownerCash(PARTNER_STATION))[0]).toMatchObject({ type: "shop", commissionXof: 0, dueXof: 2000 });
  });
});
