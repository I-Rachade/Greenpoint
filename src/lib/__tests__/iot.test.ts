import { describe, expect, it } from "vitest";
import { availableSlots } from "../availability";
import { displayStatus, freeConnectedPoints, isOffline } from "../iot/charging-points";
import {
  DeviceParseError,
  handleDeviceRequest,
  normalizeStatus,
  parseDeviceEvent,
  toIngestOutlets,
  type Ingest,
} from "../iot/device-events";
import type { ChargingPoint, StationView } from "../types";

const NOW = new Date("2026-10-12T12:00:00Z");

function point(overrides: Partial<ChargingPoint> = {}): ChargingPoint {
  return {
    id: "p1",
    stationId: "s1",
    label: "A-1",
    status: "free",
    deviceId: "DEV1",
    outlet: 1,
    powerWatts: 0,
    lastSeenAt: "2026-10-12T11:58:00Z",
    ...overrides,
  };
}

describe("parseDeviceEvent", () => {
  it("reads the generic format and normalizes aliases", () => {
    const event = parseDeviceEvent("generic", {
      device: "a84041000181f0a1",
      outlets: [
        { outlet: 1, state: "ON", power: "180.4", energy_wh: 420 },
        { port: 2, status: "idle" },
      ],
    });
    expect(event).toEqual({
      externalId: "A84041000181F0A1",
      outlets: [
        { outlet: 1, status: "charging", powerWatts: 180, energyWh: 420 },
        { outlet: 2, status: "free", powerWatts: undefined, energyWh: undefined },
      ],
    });
  });

  it("reads a The Things Network uplink", () => {
    const event = parseDeviceEvent("ttn", {
      end_device_ids: { device_id: "socket-1", dev_eui: "A84041000181F0A1" },
      uplink_message: { decoded_payload: { outlets: [{ outlet: 2, status: "full" }] } },
    });
    expect(event.externalId).toBe("A84041000181F0A1");
    expect(event.outlets[0]).toMatchObject({ outlet: 2, status: "done" });
  });

  it("reads a ChirpStack event and treats a missing payload as heartbeat", () => {
    const event = parseDeviceEvent("chirpstack", { deviceInfo: { devEui: "a840" } });
    expect(event).toEqual({ externalId: "A840", outlets: [] });
  });

  it("rejects bad input", () => {
    expect(() => parseDeviceEvent("generic", { outlets: [] })).toThrow(DeviceParseError);
    expect(() => parseDeviceEvent("generic", { device: "x", outlets: [{ outlet: 0 }] })).toThrow(DeviceParseError);
    expect(() => parseDeviceEvent("generic", { device: "x", outlets: [{ outlet: 1, status: "melting" }] })).toThrow(
      DeviceParseError,
    );
    expect(() => parseDeviceEvent("ttn", { uplink_message: {} })).toThrow(DeviceParseError);
  });

  it("maps to the database function's shape", () => {
    const outlets = toIngestOutlets({ externalId: "X", outlets: [{ outlet: 1, status: "fault", powerWatts: 0 }] });
    expect(outlets).toEqual([{ outlet: 1, status: "fault", power_watts: 0, energy_wh: undefined }]);
  });
});

describe("normalizeStatus", () => {
  it("infers the status from power when none is sent", () => {
    expect(normalizeStatus(undefined, 120)).toBe("charging");
    expect(normalizeStatus(undefined, 2)).toBe("free");
    expect(normalizeStatus(undefined, undefined)).toBeUndefined();
  });
});

describe("charging points", () => {
  it("shows silent devices as offline", () => {
    expect(isOffline(point(), NOW)).toBe(false);
    expect(isOffline(point({ lastSeenAt: "2026-10-12T11:30:00Z" }), NOW)).toBe(true);
    expect(isOffline(point({ lastSeenAt: null }), NOW)).toBe(true);
    expect(isOffline(point({ deviceId: null, lastSeenAt: null }), NOW)).toBe(false);
    expect(displayStatus(point({ status: "charging", lastSeenAt: null }), NOW)).toBe("offline");
  });

  it("counts only free, reporting, connected points", () => {
    const points = [
      point({ id: "a" }),
      point({ id: "b", status: "charging" }),
      point({ id: "c", lastSeenAt: "2026-10-12T10:00:00Z" }),
      point({ id: "d", deviceId: null }),
    ];
    expect(freeConnectedPoints(points, NOW)).toBe(1);
  });

  it("drives availableSlots for connected stations", () => {
    const station = {
      kind: "charging",
      chargingSlots: 2,
      batteryCapacity: 0,
      status: { stationId: "s1", isOpen: true, freeSlots: 2, fullBatteries: 0, updatedAt: "" },
      reservedSlots: 0,
      reservedBatteries: 0,
      chargingPoints: [point({ id: "a" }), point({ id: "b", lastSeenAt: null })],
    } as unknown as StationView;
    expect(availableSlots(station, NOW)).toBe(1);
    expect(availableSlots({ ...station, reservedSlots: 1 }, NOW)).toBe(0);
    expect(availableSlots({ ...station, chargingPoints: [] }, NOW)).toBe(2);
  });
});

describe("handleDeviceRequest", () => {
  const URL = "https://app.poinderecharge.com/api/devices/events";
  function post(body: unknown, headers: Record<string, string> = { "x-device-key": "s3cret" }, query = "") {
    return new Request(URL + query, { method: "POST", headers, body: JSON.stringify(body) });
  }
  const calls: Parameters<Ingest>[] = [];
  const ingest: Ingest = async (...args) => {
    calls.push(args);
    return args[0] === "NOPE" ? { error: "unknown_device" } : { updated: args[1].length };
  };

  it("checks the secret", async () => {
    expect((await handleDeviceRequest(post({}), undefined, ingest)).status).toBe(503);
    expect((await handleDeviceRequest(post({}, {}), "s3cret", ingest)).status).toBe(401);
    expect((await handleDeviceRequest(post({}, { "x-device-key": "s3creT" }), "s3cret", ingest)).status).toBe(401);
  });

  it("ingests a TTN uplink sent with a bearer token", async () => {
    const res = await handleDeviceRequest(
      post(
        { end_device_ids: { dev_eui: "a1" }, uplink_message: { decoded_payload: { outlets: [{ outlet: 1, power: 90 }] } } },
        { authorization: "Bearer s3cret" },
        "?format=ttn",
      ),
      "s3cret",
      ingest,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ device: "A1", updated: 1 });
    expect(calls.at(-1)?.[1]).toEqual([{ outlet: 1, status: "charging", power_watts: 90, energy_wh: undefined }]);
  });

  it("reports bad input and unknown devices", async () => {
    expect((await handleDeviceRequest(post({}, undefined, "?format=xml"), "s3cret", ingest)).status).toBe(400);
    expect(
      (await handleDeviceRequest(post({ device: "x", outlets: [{ outlet: 1, status: "boom" }] }), "s3cret", ingest)).status,
    ).toBe(422);
    expect((await handleDeviceRequest(post({ device: "nope" }), "s3cret", ingest)).status).toBe(404);
  });
});
