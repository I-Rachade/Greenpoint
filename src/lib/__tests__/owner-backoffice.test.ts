import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveStation } from "../active-station";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { cleanOpeningHours, formatOpeningHours, openAt, parseOpeningHours, todayHours } from "@shared/opening-hours";
import { byMonth, emptyDays, periodStart, reportPeriod } from "@shared/owner-backoffice";

// Plan phase 8 in the demo backend: the same rules as the Worker (worker/owner.test.ts,
// worker/migration-0033.test.ts, worker/role-matrix.test.ts).

describe("opening hours", () => {
  it("reads days and times and writes one canonical line", () => {
    expect(parseOpeningHours("07:00-21:00")).toEqual({ days: [1, 2, 3, 4, 5, 6, 7], open: "07:00", close: "21:00" });
    expect(parseOpeningHours("Mo-Sa 7:00 – 21:00")).toEqual({ days: [1, 2, 3, 4, 5, 6], open: "07:00", close: "21:00" });
    expect(parseOpeningHours("Sa-Mo 08:00-12:00")?.days).toEqual([1, 6, 7]);
    expect(parseOpeningHours("24h/24")).toEqual({ days: [1, 2, 3, 4, 5, 6, 7], open: "00:00", close: "24:00" });
    expect(parseOpeningHours("Lun-Sam 7h-21h")).toBeNull();
    expect(formatOpeningHours({ days: [1, 2, 3, 4, 5, 7], open: "07:00", close: "21:00" })).toBe("Mo-Fr,Su 07:00-21:00");
    expect(formatOpeningHours({ days: [1, 3], open: "08:00", close: "18:00" })).toBe("Mo,We 08:00-18:00");
  });

  it("is never saved empty or as free text", () => {
    expect(cleanOpeningHours("")).toBeNull();
    expect(cleanOpeningHours("   ")).toBeNull();
    expect(cleanOpeningHours("toujours")).toBeNull();
    expect(cleanOpeningHours("25:00-26:00")).toBeNull();
    expect(cleanOpeningHours("mo-fr 7:00-19:30")).toBe("Mo-Fr 07:00-19:30");
    expect(cleanOpeningHours("Mo-Fr 8:00-19:00;sa 08:00-15:00")).toBe("Mo-Fr 08:00-19:00; Sa 08:00-15:00");
    expect(cleanOpeningHours("Mo-Fr 08:00-19:00; le samedi matin")).toBeNull();
  });

  it("knows open and closed, also past midnight", () => {
    const night = parseOpeningHours("Fr 20:00-02:00")!;
    expect(openAt(night, new Date("2026-10-16T21:00:00Z"))).toBe(true); // Friday evening
    expect(openAt(night, new Date("2026-10-17T01:00:00Z"))).toBe(true); // Saturday night, from Friday
    expect(openAt(night, new Date("2026-10-17T21:00:00Z"))).toBe(false); // Saturday evening
    expect(openAt(parseOpeningHours("Mo-Fr 07:00-19:00")!, new Date("2026-10-18T10:00:00Z"))).toBe(false); // Sunday
  });
});

describe("report periods", () => {
  it("falls back to 7 days and starts at midnight", () => {
    expect(reportPeriod("30")).toBe(30);
    expect(reportPeriod("12")).toBe(7);
    const now = new Date("2026-10-15T15:00:00Z");
    expect(periodStart(1, now)).toBe("2026-10-15T00:00:00.000Z");
    expect(periodStart(7, now)).toBe("2026-10-09T00:00:00.000Z");
    expect(emptyDays(7, now).map((d) => d.day)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
    expect(byMonth(emptyDays(365, now))).toHaveLength(13);
  });
});

describe("DemoBackend owner backoffice (phase 8, as the Worker)", () => {
  let backend: DemoBackend;
  const as = (role: "customer" | "operator" | "admin", phone = "+22890123456") => backend.register(phone, DEMO_CODE, "2580", role);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    backend = new DemoBackend();
    setActiveStation(null);
  });
  afterEach(() => {
    vi.useRealTimers();
    setActiveStation(null);
  });

  it("keeps staff at one station: a second one is refused, moving is explicit (W2)", async () => {
    await as("admin", "+22890000001");
    const view = await backend.ownerView();
    // An admin sees every operator, and the list to re-staff from migration 0033.
    expect(view.operators.length).toBeGreaterThan(1);
    expect(view.staff.filter((s) => s.userId === "demo-operator").map((s) => s.stationId)).toEqual(["st-grand-marche"]);
    expect(view.reassignments.map((r) => r.stationId).sort()).toEqual(["st-agoe", "st-be", "st-tokoin", "st-universite"]);
    expect(view.reassignments[0]).toMatchObject({ userId: "demo-operator", currentStationId: "st-grand-marche" });

    // The admin's direct assignment follows the one-station rule (the owner's route only invites).
    await expect(backend.assignStaff("st-tokoin", "demo-operator")).rejects.toMatchObject({ code: "staff_other_station" });
    await backend.ownerMoveStaff("demo-operator", "st-tokoin");
    const moved = await backend.ownerView();
    expect(moved.staff.filter((s) => s.userId === "demo-operator").map((s) => s.stationId)).toEqual(["st-tokoin"]);
    // Moving there dealt with that entry of the list.
    expect(moved.reassignments.map((r) => r.stationId).sort()).toEqual(["st-agoe", "st-be", "st-universite"]);
    await backend.resolveReassignment(moved.reassignments[0].id);
    expect((await backend.ownerView()).reassignments).toHaveLength(2);

    // Staff → customer only after removal from the station (R15).
    await expect(backend.setUserRole("demo-operator", "customer")).rejects.toMatchObject({ code: "role_change_blocked" });
    await backend.ownerRemoveStaff("st-tokoin", "demo-operator");
    expect((await backend.adminSnapshot()).users.find((u) => u.id === "demo-operator")?.role).toBe("customer");
  });

  it("makes staff by invitation only, whether or not the contact has an account (0050)", async () => {
    await as("admin", "+22890000001");
    // The same answer for a contact without an account and for one with an account.
    await backend.ownerInviteStaff("st-tokoin", "90 00 00 77");
    await backend.ownerInviteStaff("st-tokoin", "90000002");
    expect((await backend.ownerView()).invites.map((i) => i.label)).toEqual(["+228 90 •• •• 77", "+228 90 •• •• 02"]);
    // The account that signs up with the number sees the invite; someone else does not.
    await as("customer", "+22890000078");
    expect(await backend.myStaffInvites()).toEqual([]);
    await as("customer", "+22890000077");
    const [invite] = await backend.myStaffInvites();
    expect(invite).toMatchObject({ stationName: expect.any(String) });
    await backend.acceptStaffInvite(invite.id);
    expect((await backend.getProfile())?.role).toBe("operator");
    expect(await backend.myStaffInvites()).toEqual([]);
    // The staff member at another station: the checks run on accepting.
    await as("operator", "+22890000002");
    const [forOperator] = await backend.myStaffInvites();
    await expect(backend.acceptStaffInvite(forOperator.id)).rejects.toMatchObject({ code: "staff_other_station" });
    await backend.declineStaffInvite(forOperator.id);
    await as("admin", "+22890000001");
    const view = await backend.ownerView();
    expect(view.invites).toEqual([]);
    expect(view.staff.some((s) => s.stationId === "st-tokoin" && s.label === "+228 90 •• •• 77")).toBe(true);
  });

  it("lets the owner cancel invites, and ends them after 7 days", async () => {
    await as("admin", "+22890000001");
    await backend.ownerInviteStaff("st-tokoin", "90000077");
    await backend.ownerInviteStaff("st-be", "90000077");
    const [first, second] = (await backend.ownerView()).invites;
    await backend.ownerRevokeStaffInvite(first.id);
    await expect(backend.ownerRevokeStaffInvite(first.id)).rejects.toMatchObject({ code: "invite_not_found" });
    vi.setSystemTime(new Date("2026-10-22T12:00:01Z"));
    expect((await backend.ownerView()).invites).toEqual([]);
    await as("customer", "+22890000077");
    expect(await backend.myStaffInvites()).toEqual([]);
    await expect(backend.acceptStaffInvite(second.id)).rejects.toMatchObject({ code: "invite_not_found" });
  });

  it("gives staff no backoffice and customers no station work (R2)", async () => {
    await as("operator", "+22890000002");
    await expect(backend.ownerView()).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.ownerLive(null)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.ownerReport(null, 7)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.stationBatteryEvents("st-grand-marche", 7)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.myWallet()).rejects.toMatchObject({ code: "forbidden" });
    await as("customer");
    await expect(backend.staffStations()).rejects.toMatchObject({ code: "forbidden" });
  });

  it("saves hours as days and times only, and prices with their old value", async () => {
    await as("admin", "+22890000001");
    await expect(backend.ownerSaveStation("st-tokoin", { openingHours: "", phone: null })).rejects.toMatchObject({ code: "opening_hours_invalid" });
    await expect(backend.ownerSaveStation("st-tokoin", { openingHours: "07:00-21:00", phone: null, chargeKwhXof: 0 })).rejects.toMatchObject({ code: "unknown" });
    await backend.ownerSaveStation("st-tokoin", { openingHours: "Mo-Sa 07:00-21:00", phone: null, swapXof: 600 });
    expect((await backend.listStations()).find((s) => s.id === "st-tokoin")?.openingHours).toBe("Mo-Sa 07:00-21:00");
    expect((await backend.ownerView()).prices.find((p) => p.stationId === "st-tokoin")?.swapXof).toBe(600);
    const [entry] = await backend.auditLog({ table: "stations" });
    expect(entry.changes).toMatchObject({ price_battery_xof: [500, 600] });
  });

  it("starts a new station closed and empty, and clamps the counter when capacity drops", async () => {
    await as("admin", "+22890000001");
    const base = { operatorId: "op-poinderecharge", name: "Nouvelle", address: "", lat: 6.1, lng: 1.2, kind: "swap" as const, vehicleTypes: [], chargingSlots: 0, batteryCapacity: 8, openingHours: "07:00-21:00", phone: null };
    await expect(backend.saveStation(null, { ...base, openingHours: "" })).rejects.toMatchObject({ code: "opening_hours_invalid" });
    await backend.saveStation(null, base);
    const fresh = (await backend.listStations()).find((s) => s.name === "Nouvelle")!;
    expect(fresh.status).toMatchObject({ isOpen: false, fullBatteries: 0 });

    // Agoè: 11 full batteries over two types; capacity down to 4 takes from the larger counter first.
    const station = (await backend.listStations()).find((s) => s.id === "st-agoe")!;
    const before = station.status.fullBatteries;
    expect(before).toBe(11);
    await backend.saveStation("st-agoe", { ...station, operatorId: station.operatorId, kind: "both", batteryCapacity: 4, openingHours: station.openingHours });
    setActiveStation("st-agoe");
    const counter = await backend.stationCounter("st-agoe");
    expect(counter.rows.map((r) => r.full)).toEqual([2, 2]);
    const trims = counter.events.filter((e) => e.type === "correction");
    expect(trims.every((e) => e.reason === "Capacité réduite" && e.role === "admin")).toBe(true);
    expect(trims.reduce((a, e) => a + e.delta, 0)).toBe(4 - before);
  });

  it("keeps places per battery type, the station's being their sum, as the Worker (0064)", async () => {
    await as("admin", "+22890000001");
    const station = (await backend.listStations()).find((s) => s.id === "st-agoe")!;
    expect(station.batteryTypes!.map((t) => [t.id, t.fullBatteries, t.capacity])).toEqual([
      ["bt-ovt-60", 6, 8],
      ["bt-ovt-72", 5, 8],
    ]);
    await backend.saveStation("st-agoe", {
      ...station,
      kind: "both",
      batteryTypeIds: ["bt-ovt-60", "bt-ovt-72"],
      batteryTypeCapacities: { "bt-ovt-60": 3, "bt-ovt-72": 9 },
    });
    const after = (await backend.listStations()).find((s) => s.id === "st-agoe")!;
    expect(after.batteryCapacity).toBe(12);
    expect(after.batteryTypes!.map((t) => [t.id, t.fullBatteries, t.capacity])).toEqual([
      ["bt-ovt-60", 3, 3],
      ["bt-ovt-72", 5, 9],
    ]);
    setActiveStation("st-agoe");
    const counter = await backend.stationCounter("st-agoe");
    expect(counter.rows.map((r) => r.capacity)).toEqual([3, 9]);
    await expect(backend.batteryEvent("st-agoe", { type: "full", batteryTypeId: "bt-ovt-60", requestId: "req-full-0001" })).rejects.toMatchObject({ code: "counter_full" });
    expect((await backend.batteryEvent("st-agoe", { type: "full", batteryTypeId: "bt-ovt-72", requestId: "req-full-0002" })).fullAfter).toBe(6);
  });

  it("pages the reservations table with a total", async () => {
    await as("admin", "+22890000001");
    const all = await backend.adminReservations({ limit: 5 });
    expect(all.rows).toHaveLength(5);
    expect(all.total).toBeGreaterThan(5);
    const next = await backend.adminReservations({ limit: 5, offset: 5 });
    expect(next.rows[0].id).not.toBe(all.rows[0].id);
    const done = await backend.adminReservations({ status: "completed", limit: 200 });
    expect(done.rows.every((r) => r.status === "completed")).toBe(true);
    expect(done.total).toBe(done.rows.length);
  });

  it("closes a station: cancels what is still held, says how many, logs the action (R17)", async () => {
    await as("customer", "+22890123456");
    await backend.reserve("st-grand-marche", "slot", null).catch(() => null);
    const held = (await backend.myReservations()).filter((r) => r.stationId === "st-grand-marche" && r.status === "active").length;
    await as("operator", "+22890000002");
    const { cancelled } = await backend.updateStatus("st-grand-marche", { isOpen: false });
    expect(cancelled).toBe(held);
    await as("admin", "+22890000001");
    const report = await backend.ownerReport("st-grand-marche", 1);
    expect(report.staff.find((p) => p.personId === "demo-operator")).toMatchObject({ role: "staff", actions: 1 });
  });

  it("reports revenue apart from the cash for poinderecharge (W12)", async () => {
    await as("admin", "+22890000001");
    setActiveStation("st-tokoin");
    await backend.recordSwap("st-tokoin", { requestId: "demo-w12-000001", customerType: "cash", batteryIn: "a-1", batteryOut: "a-2", amountXof: 500 });
    const report = await backend.ownerReport("st-tokoin", 1);
    expect(report.revenue).toMatchObject({ swapCashXof: 500, cashXof: 500, totalXof: 500 });
    expect(report.poinderecharge).toMatchObject({ parcelsXof: 0, driversXof: 0, totalXof: 0, thirdParty: false });
    expect(report.perDay).toHaveLength(1);
    expect(report.perDay[0]).toMatchObject({ swaps: 1, swapXof: 500 });
    expect(report.hours[12]).toBe(1);
    const live = await backend.ownerLive("st-tokoin");
    expect(live.parcels).toEqual([{ stationId: "st-tokoin", toSend: 0, incoming: 0, toPickUp: 0 }]);
  });
});

describe("today's hours", () => {
  const week = "Mo-Fr 08:00-19:00; Sa 08:00-15:00";
  it("gives today's closing time, all day, or closed", () => {
    expect(todayHours(week, new Date("2026-10-16T10:00:00Z"))).toEqual({ kind: "closes", at: "19:00" }); // Friday
    expect(todayHours(week, new Date("2026-10-17T10:00:00Z"))).toEqual({ kind: "closes", at: "15:00" }); // Saturday
    expect(todayHours(week, new Date("2026-10-18T10:00:00Z"))).toEqual({ kind: "closed" }); // Sunday
    expect(todayHours("24h/24", new Date("2026-10-18T10:00:00Z"))).toEqual({ kind: "allDay" });
    expect(todayHours("Fr 20:00-02:00; Fr 08:00-12:00", new Date("2026-10-16T10:00:00Z"))).toEqual({ kind: "closes", at: "02:00" });
    expect(todayHours("Lun-Sam 8h-18h")).toBeNull();
  });
});
