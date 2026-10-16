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
});
