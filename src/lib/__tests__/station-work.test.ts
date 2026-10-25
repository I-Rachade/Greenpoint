import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveStation } from "../active-station";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { applyBatteryEvent, roleAt, stationTiles, takesBatteryIn } from "@shared/station-work";

// Station work in the demo backend: the same rules as worker/station-work.ts (tested in
// worker/station-work.test.ts), so the demo behaves like the Worker.

const STATION = "st-tokoin"; // own swap station, one battery type (Spiro 72 V)
const TYPE = "bt-spiro-72";

async function as(backend: DemoBackend, role: "customer" | "operator" | "admin", phone = "+22890123456") {
  await backend.register(phone, DEMO_CODE, "2580", role);
}

/** Staff work at one station (W2): an admin moves the demo staff member (Kossi) to `stationId`. */
async function staffAt(backend: DemoBackend, stationId: string) {
  await as(backend, "admin", "+22890000001");
  await backend.ownerMoveStaff("demo-operator", stationId);
}

const full = async (backend: DemoBackend) => (await backend.stationCounter(STATION)).rows[0].full;
let n = 0;
const rid = () => `demo-req-${String(++n).padStart(6, "0")}`;

describe("station work rules", () => {
  it("applies counter events, never below 0 and within capacity (R3, R4)", () => {
    expect(applyBatteryEvent({ full: 0, empty: 0 }, "issue", -1)).toBeNull();
    expect(applyBatteryEvent({ full: 2, empty: 1 }, "issue", -1)).toEqual({ full: 1, empty: 1 });
    expect(applyBatteryEvent({ full: 2, empty: 1 }, "full", 1)).toEqual({ full: 3, empty: 0 });
    expect(applyBatteryEvent({ full: 2, empty: 0 }, "full", 1)).toEqual({ full: 3, empty: 0 });
    expect(applyBatteryEvent({ full: 2, empty: 0 }, "full", 1, { total: 4, capacity: 4 })).toBeNull();
    expect(applyBatteryEvent({ full: 2, empty: 0 }, "correction", -3)).toBeNull();
    expect(applyBatteryEvent({ full: 2, empty: 0 }, "empty_in", 1)).toEqual({ full: 2, empty: 1 });
    expect(takesBatteryIn("first_purchase")).toBe(false);
    expect(takesBatteryIn("fleet")).toBe(true);
  });

  it("shows a tile only for an active service", () => {
    expect(stationTiles(["swap"])).toEqual(["swap", "counter", "reservations"]);
    expect(stationTiles(["ev", "parcels"])).toEqual(["charging", "parcels"]);
    expect(stationTiles([])).toEqual([]);
    // Our own stations: the tile opens the staff's cash closing even without Green Credit (0057).
    expect(stationTiles(["parcels"], false, true)).toEqual(["parcels", "credit"]);
    expect(stationTiles(["swap"], false, false, true)).toEqual(["swap", "counter", "reservations", "share"]);
  });

  it("knows the role at a station", () => {
    expect(roleAt({ role: "admin" }, { operatorId: "x" })).toBe("admin");
    expect(roleAt({ role: "operator", ownerOf: ["x"] }, { operatorId: "x" })).toBe("owner");
    expect(roleAt({ role: "operator", ownerOf: ["x"] }, { operatorId: "y" })).toBe("staff");
    expect(roleAt({ role: "customer" }, { operatorId: "x" })).toBeNull();
  });
});

describe("DemoBackend station work", () => {
  let backend: DemoBackend;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    backend = new DemoBackend();
    setActiveStation(null);
  });
  afterEach(() => vi.useRealTimers());

  it("needs the active station for actions and refuses riders (R7)", async () => {
    await as(backend, "customer");
    await expect(backend.batteryEvent(STATION, { type: "full", requestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
    // Staff at another station: no rights here (403).
    await as(backend, "operator", "+22890000002");
    await expect(backend.batteryEvent(STATION, { type: "full", requestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
    await staffAt(backend, STATION);
    await as(backend, "operator", "+22890000002");
    // Staff have one station: without a chosen station they act at it; another chosen station is refused.
    setActiveStation("st-grand-marche");
    await expect(backend.batteryEvent(STATION, { type: "full", requestId: rid() })).rejects.toMatchObject({ code: "active_station_required" });
    setActiveStation(null);
    const before = await full(backend);
    await expect(backend.batteryEvent(STATION, { type: "issue", requestId: rid() })).resolves.toMatchObject({ type: "issue", fullAfter: before - 1, role: "staff" });
    setActiveStation(STATION);
    await expect(backend.batteryEvent(STATION, { type: "issue", requestId: rid() })).resolves.toMatchObject({ fullAfter: before - 2 });
    const stations = await backend.staffStations();
    expect(stations.find((s) => s.id === STATION)).toMatchObject({ myRole: "staff", activeServices: expect.arrayContaining(["swap"]) });
  });

  it("counts a request id once and never goes below 0 (R4, R5)", async () => {
    await staffAt(backend, STATION);
    await as(backend, "operator", "+22890000002");
    setActiveStation(STATION);
    const start = await full(backend);
    const same = { type: "issue" as const, requestId: "demo-same-0001" };
    await backend.batteryEvent(STATION, same);
    await backend.batteryEvent(STATION, same);
    expect(await full(backend)).toBe(start - 1);
    for (let i = 1; i < start; i++) await backend.batteryEvent(STATION, { type: "issue", requestId: rid() });
    await expect(backend.batteryEvent(STATION, { type: "issue", requestId: rid() })).rejects.toMatchObject({ code: "no_full_battery" });
    expect((await backend.listStations()).find((s) => s.id === STATION)!.status.fullBatteries).toBe(0);
  });

  it("lets only owners and admins correct, with a reason", async () => {
    await staffAt(backend, STATION);
    await as(backend, "operator", "+22890000002");
    setActiveStation(STATION);
    await expect(backend.batteryEvent(STATION, { type: "correction", delta: 1, reason: "inventaire", requestId: rid() })).rejects.toMatchObject({ code: "forbidden" });
    await as(backend, "admin", "+22890000001");
    await expect(backend.batteryEvent(STATION, { type: "correction", delta: 1, requestId: rid() })).rejects.toMatchObject({ code: "reason_required" });
    const start = await full(backend);
    await expect(backend.batteryEvent(STATION, { type: "correction", delta: 2, reason: "inventaire", requestId: rid() })).resolves.toMatchObject({ fullAfter: start + 2, role: "admin" });
  });

  it("records a swap with one battery in and one out, cash only in Lite (R6, R9)", async () => {
    await as(backend, "admin", "+22890000001");
    setActiveStation(STATION);
    const start = await full(backend);
    const swap = await backend.recordSwap(STATION, { requestId: rid(), customerType: "cash", batteryIn: "sp-1", batteryOut: "sp-2", amountXof: 400 });
    // The station's price, not the amount typed.
    expect(swap).toMatchObject({ customerType: "cash", batteryIn: "SP-1", batteryOut: "SP-2", payment: "cash", amountXof: 500, role: "admin" });
    expect((await backend.stationCounter(STATION)).rows[0]).toMatchObject({ batteryTypeId: TYPE, full: start - 1, empty: 1 });
    await backend.recordSwap(STATION, { requestId: rid(), customerType: "first_purchase", batteryOut: "SP-3" });
    expect((await backend.stationCounter(STATION)).rows[0]).toMatchObject({ full: start - 2, empty: 1 });
    expect((await backend.stationSwaps(STATION, { customerType: "cash" })).length).toBe(1);

    await backend.setLiteEnabled(true);
    await expect(backend.recordSwap(STATION, { requestId: rid(), customerType: "fleet", driverCode: "ABCDEFGH" })).rejects.toMatchObject({ code: "cash_only" });
  });

  it("takes an app customer's swap from Green Credit with the code their phone shows", async () => {
    await as(backend, "customer", "+22890123456");
    const { code } = await backend.createCreditCode("2580");
    await staffAt(backend, STATION);
    await as(backend, "operator", "+22890000002");
    setActiveStation(STATION);
    const swap = await backend.recordSwap(STATION, { requestId: rid(), customerType: "app", creditCode: code, batteryIn: "SP-1", batteryOut: "SP-2" });
    expect(swap).toMatchObject({ customerType: "app", payment: "wallet", amountXof: 500 });
    // The code is used once.
    await expect(backend.recordSwap(STATION, { requestId: rid(), customerType: "app", creditCode: code, batteryIn: "SP-3", batteryOut: "SP-4" })).rejects.toMatchObject({
      code: "credit_code_invalid",
    });
  });
});

describe("scanner codes", () => {
  it("reads back a reservation QR code and nothing else", async () => {
    const { reservationQrPayload, parseReservationQr } = await import("@shared/reservations");
    expect(parseReservationQr(reservationQrPayload("res-42", "4821"))).toEqual({ id: "res-42", code: "4821" });
    expect(parseReservationQr("4821")).toBeNull();
    expect(parseReservationQr("poinderecharge:resa:res-42:48")).toBeNull();
  });

  it("tells a customer's own code from other text", async () => {
    const { customerCode, isCustomerCode, contactFromCode } = await import("@shared/charging");
    expect(isCustomerCode(customerCode("+22890551234"))).toBe(true);
    expect(contactFromCode(customerCode("+22890551234"))).toBe("+22890551234");
    expect(isCustomerCode("+22890551234")).toBe(false);
    expect(isCustomerCode("poinderecharge:id:")).toBe(false);
  });
});
