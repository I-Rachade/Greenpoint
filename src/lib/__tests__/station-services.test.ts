import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reservableOutlets } from "@shared/reservations";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { customerStation } from "@shared/station-services";
import type { StationView } from "@shared/types";

// Service unlock per station in the demo backend, as worker/services.test.ts on Cloudflare.

const OWNER = "+22890111111";
const ADMIN = "+22890222222";
const OWN_STATION = "st-hedzranawoe"; // operator op-example, motorbike outlets
const OTHER_STATION = "st-grand-marche"; // operator op-poinderecharge

async function as(backend: DemoBackend, contact: string, role: "customer" | "operator" | "admin") {
  await backend.register(contact, DEMO_CODE, "2580", role);
}

/** The demo operator account runs op-example (an admin links it, as on Cloudflare). */
async function withOwner(backend: DemoBackend) {
  await as(backend, OWNER, "operator");
  await as(backend, ADMIN, "admin");
  await backend.addOperatorOwner("op-example", OWNER);
  await as(backend, OWNER, "operator");
}

describe("demo: service unlock per station", () => {
  let backend: DemoBackend;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-12T12:00:00Z"));
    backend = new DemoBackend();
  });
  afterEach(() => vi.useRealTimers());

  it("starts with what every station offers unlocked", async () => {
    await as(backend, ADMIN, "admin");
    const rows = await backend.stationServices();
    const unlocked = (id: string) => rows.filter((r) => r.stationId === id && r.unlocked).map((r) => r.service).sort();
    expect(unlocked("st-grand-marche")).toEqual(["charging", "drivers", "ev", "parcels", "swap"]);
    expect(unlocked("st-tokoin")).toEqual(expect.arrayContaining(["drivers", "parcels", "swap"]));
    expect(unlocked("st-colis-adewui")).toEqual(["drivers", "parcels"]);
  });

  it("runs request, approval and the role checks", async () => {
    await withOwner(backend);
    const mine = await backend.stationServices();
    expect(new Set(mine.map((r) => r.stationId))).toEqual(new Set([OWN_STATION]));
    expect(mine.find((r) => r.service === "parcels")).toMatchObject({ unlocked: false, status: null });

    await expect(backend.requestStationService(OTHER_STATION, "ev")).rejects.toMatchObject({ code: "forbidden" });
    await backend.requestStationService(OWN_STATION, "parcels");
    await expect(backend.requestStationService(OWN_STATION, "parcels")).rejects.toMatchObject({ code: "service_request_pending" });
    await expect(backend.decideStationService(OWN_STATION, "parcels", true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.setStationService(OWN_STATION, "parcels", true)).rejects.toMatchObject({ code: "forbidden" });

    await as(backend, ADMIN, "admin");
    await expect(backend.requestStationService(OWN_STATION, "ev")).rejects.toMatchObject({ code: "forbidden" });
    expect((await backend.stationServices()).find((r) => r.stationId === OWN_STATION && r.service === "parcels")?.status).toBe("pending");
    await backend.decideStationService(OWN_STATION, "parcels", true);
    await expect(backend.decideStationService(OWN_STATION, "parcels", true)).rejects.toMatchObject({ code: "no_pending_request" });

    await as(backend, OWNER, "operator");
    expect((await backend.stationServices()).find((r) => r.service === "parcels")).toMatchObject({ unlocked: true, status: "approved", active: true });
    await expect(backend.requestStationService(OWN_STATION, "parcels")).rejects.toMatchObject({ code: "service_already_unlocked" });

    await as(backend, "+22890333333", "customer");
    await expect(backend.stationServices()).rejects.toMatchObject({ code: "forbidden" });
    await expect(backend.requestStationService(OWN_STATION, "ev")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("R8: global switch AND station unlock decide what customers see and may do", async () => {
    await as(backend, ADMIN, "admin");
    const station = async () => (await backend.listStations()).find((s) => s.id === OTHER_STATION);
    expect((await station())?.parcelPoint).toBeTruthy();
    await backend.setStationService(OTHER_STATION, "parcels", false);
    expect((await station())?.parcelPoint).toBeNull();
    expect((await backend.parcelInfo()).depots.some((d) => d.stationId === OTHER_STATION)).toBe(false);
    await backend.setStationService(OTHER_STATION, "parcels", true);
    await backend.setParcelsEnabled(false);
    expect((await station())?.parcelPoint).toBeNull();
    await backend.setParcelsEnabled(true);

    await backend.setStationService(OTHER_STATION, "swap", false);
    expect((await station())?.kind).toBe("charging");
    await as(backend, "+22890333333", "customer");
    await expect(backend.reserve(OTHER_STATION, "battery")).rejects.toMatchObject({ code: "service_not_offered" });
    const outlet = reservableOutlets((await station())!)[0]?.id ?? null;
    expect((await backend.reserve(OTHER_STATION, "slot", outlet)).status).toBe("active");
  });

  it("R9: Lite switches parcels and drivers off everywhere", async () => {
    await as(backend, ADMIN, "admin");
    await backend.setDriversEnabled(true);
    await backend.setLiteEnabled(true);
    const row = (await backend.stationServices()).find((r) => r.stationId === OTHER_STATION && r.service === "drivers")!;
    expect({ unlocked: row.unlocked, globalOn: row.globalOn, active: row.active }).toEqual({ unlocked: true, globalOn: false, active: false });
    expect((await backend.listStations()).find((s) => s.id === OTHER_STATION)?.parcelPoint).toBeNull();
  });
});

describe("customerStation", () => {
  const base = {
    id: "s",
    kind: "both",
    parcelPoint: { counter: true, lockers: 0 },
    evChargers: [{ id: "e", name: "E", connector: "type2", powerKw: 22 }],
    batteryTypes: [],
  } as unknown as StationView;

  it("keeps a fully unlocked station as it is", () => {
    expect(customerStation(base, new Set(["swap", "charging", "ev", "parcels"]))).toEqual(base);
  });

  it("drops locked services and hides a station with nothing left", () => {
    expect(customerStation(base, new Set(["charging"]))).toMatchObject({ kind: "charging", parcelPoint: null, evChargers: [] });
    expect(customerStation(base, new Set(["parcels"]))?.kind).toBe("parcel");
    expect(customerStation(base, new Set())).toBeNull();
  });
});
