import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setActiveStation } from "../active-station";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { parseSerials, sortBrands } from "../batteries";

// Battery register in the demo backend: the same rules as worker/batteries.ts (tested in
// worker/batteries.test.ts), so the demo behaves like the Worker.

const STATION = "st-tokoin"; // own swap station, one battery type (Spiro 72 V)
let n = 0;
const rid = () => `demo-bat-req-${String(++n).padStart(6, "0")}`;

describe("battery register rules", () => {
  it("reads a pasted list of numbers", () => {
    expect(parseSerials("sp-1\nSP-2, sp-1 ; sp-3\n\n")).toEqual({ serials: ["SP-1", "SP-2", "SP-3"], invalid: [] });
    expect(parseSerials("x".repeat(61)).invalid).toHaveLength(1);
  });

  it("sorts brands by name, the unknown brand last", () => {
    expect(sortBrands([{ brand: "", count: 1 }, { brand: "Spiro", count: 0 }, { brand: "Omnivoltaic", count: 2 }]).map((b) => b.brand)).toEqual(["Omnivoltaic", "Spiro", ""]);
  });
});

describe("DemoBackend battery register", () => {
  let backend: DemoBackend;
  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-15T12:00:00Z"));
    backend = new DemoBackend();
    setActiveStation(null);
    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    setActiveStation(STATION);
  });
  afterEach(() => vi.useRealTimers());

  it("needs the numbers at a station with battery types, adds an unknown one and follows it", async () => {
    await expect(backend.recordSwap(STATION, { requestId: rid(), customerType: "cash" })).rejects.toMatchObject({ code: "battery_number_required" });
    expect(await backend.lookupBattery(STATION, "new-1", "bt-spiro-72")).toEqual({ state: "new", brand: null, status: null });
    await backend.recordSwap(STATION, { requestId: rid(), customerType: "cash", batteryIn: "SP72-0103", batteryOut: "new-1" });
    const list = await backend.listBatteries({ q: "NEW-1" });
    expect(list.batteries).toMatchObject([{ serial: "NEW-1", brand: "Spiro", source: "swap", location: "customer", swaps: 1 }]);
    const detail = await backend.batteryDetail(list.batteries[0].id);
    expect(detail.history.map((h) => h.type)).toEqual(["out", "added_at_swap"]);
    // SP72-0103 was registered and handed out before: now back at Tokoin.
    const back = (await backend.listBatteries({ q: "SP72-0103" })).batteries[0];
    expect(back).toMatchObject({ source: "registered", location: "station", stationId: STATION });
  });

  it("refuses a number of another brand, registers lists and changes a status", async () => {
    await expect(backend.recordSwap(STATION, { requestId: rid(), customerType: "cash", batteryIn: "OV60-2201", batteryOut: "SP72-0104" })).rejects.toMatchObject({
      code: "battery_wrong_brand",
    });
    expect(await backend.registerBatteries({ batteryTypeId: "bt-spiro-72", serials: ["SP72-0101", "sp72-0901", " "] })).toEqual({ added: 1, existing: ["SP72-0101"], invalid: [" "] });
    const spiro = await backend.listBatteries({ brand: "Spiro" });
    expect(spiro.batteries.every((b) => b.brand === "Spiro")).toBe(true);
    expect(spiro.brands.find((b) => b.brand === "Spiro")?.count).toBe(spiro.batteries.length);
    const id = spiro.batteries.find((b) => b.serial === "SP72-0901")!.id;
    await backend.setBatteryStatus(id, { status: "lost", reason: "Volée" });
    expect((await backend.batteryDetail(id)).history[0]).toMatchObject({ type: "status", status: "lost", reason: "Volée" });
  });
});
