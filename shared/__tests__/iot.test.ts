import { describe, expect, it } from "vitest";
import { availableSlots } from "../availability";
import { displayStatus, freeConnectedPoints, isOffline } from "../iot/charging-points";
import {
  DeviceParseError,
  handleDeviceRequest,
  normalizeStatus,
  parseDeviceEvent,
  parseXingke,
  toIngestOutlets,
  type Ingest,
} from "../iot/device-events";
import { xingkeOrderNumber, xingkeStartCommand, xingkeStopCommand } from "../iot/xingke-commands";
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

describe("Xingke protocol", () => {
  it("reads a device status report with either PORT separator", () => {
    const [a, b] = parseXingke("MOD:52;EID:123456;T:2601;V:22035;PORT:0000|0101|0290;VER:2122;\r\nMOD:52;EID:123456;PORT:0000,0101;\r\n");
    expect(a).toEqual({
      externalId: "123456",
      outlets: [
        { outlet: 1, status: "free" },
        { outlet: 2, status: "charging" },
        { outlet: 3, status: "fault" },
      ],
    });
    expect(b.outlets).toHaveLength(2);
  });

  it("reads an order status report with power and energy", () => {
    const [e] = parseXingke("MOD:51;ORD:20261012120000123456;EID:12345601;MSG:00;V:22035;I:1250;P:260850;E:1250;CT:42;\r\n");
    expect(e).toEqual({ externalId: "123456", outlets: [{ outlet: 2, status: "charging", powerWatts: 261, energyWh: 1250 }] });
    expect(parseXingke("MOD:51;EID:12345600;MSG:03;\n")[0].outlets[0].status).toBe("done");
    expect(parseXingke("MOD:51;EID:12345600;MSG:04;\n")[0].outlets[0].status).toBe("free");
  });

  it("reads faults and command answers", () => {
    expect(parseXingke("MOD:70;EID:12345600;MSG:99;")[0].outlets).toEqual([{ outlet: 1, status: "fault" }]);
    expect(parseXingke("MOD:70;EID:123456;MSG:11;")[0]).toEqual({ externalId: "123456", outlets: [], allOutlets: "fault" });
    expect(parseXingke("MOD:01;RES:0;ORD:1;EID:12345601;MSG:00;")[0]).toEqual({
      externalId: "123456",
      outlets: [{ outlet: 2, status: "charging" }],
      ack: { order: "1", kind: "start", ok: true, code: "00" },
    });
    expect(parseXingke("MOD:01;RES:1;ORD:1;EID:12345601;MSG:01;")[0].outlets).toEqual([]);
    expect(parseXingke("MOD:02;RES:0;ORD:1;EID:12345601;")[0].outlets).toEqual([{ outlet: 2, status: "free" }]);
    expect(parseXingke("MOD:53;CMD:0;EID:12345601;UID:0012345678;")[0]).toEqual({ externalId: "123456", outlets: [] });
    expect(parseXingke("MOD:98;RES:0;")).toEqual([]);
  });

  it("rejects bad lines", () => {
    expect(() => parseXingke("EID:123456;")).toThrow(DeviceParseError);
    expect(() => parseXingke("MOD:52;EID:12345;")).toThrow(DeviceParseError);
    expect(() => parseXingke("MOD:52;EID:123456;PORT:001;")).toThrow(DeviceParseError);
    expect(() => parseXingke("MOD:51;EID:123456;MSG:00;")).toThrow(DeviceParseError);
  });

  it("builds start and stop commands", () => {
    const order = xingkeOrderNumber(new Date("2026-10-12T12:34:56Z"), () => 0.042);
    expect(order).toBe("20261012123456042000");
    expect(xingkeStartCommand("123456", 1, order)).toBe(`MOD:01;CMD:0;ORD:${order};EID:12345600;MSG:999;\r\n`);
    expect(xingkeStartCommand("123456", 2, order, 60)).toBe(`MOD:01;CMD:0;ORD:${order};EID:12345601;MSG:060;\r\n`);
    expect(xingkeStopCommand("123456", 2, order)).toBe(`MOD:02;CMD:0;ORD:${order};EID:12345601;\r\n`);
    expect(() => xingkeStartCommand("A1", 1, order)).toThrow();
  });

  it("ingests every line of a text body", async () => {
    const calls: Parameters<Ingest>[] = [];
    const ingest: Ingest = async (...args) => {
      calls.push(args);
      return args[0] === "999999" ? { error: "unknown_device" } : { updated: args[1].length };
    };
    const req = (body: string) =>
      new Request("https://app.poinderecharge.com/api/devices/events?format=xingke", {
        method: "POST",
        headers: { "x-device-key": "s3cret", "content-type": "text/plain" },
        body,
      });
    const res = await handleDeviceRequest(req("MOD:52;EID:123456;PORT:0000|0101;\r\nMOD:70;EID:123456;MSG:11;\r\n"), "s3cret", ingest);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ results: [{ device: "123456", updated: 2 }, { device: "123456", updated: 0 }] });
    expect(calls[1][3]).toEqual({ allOutlets: "fault", ack: undefined });
    expect(calls[0][2]).toMatchObject({ MOD: "52", EID: "123456" });
    expect((await handleDeviceRequest(req("MOD:52;EID:999999;"), "s3cret", ingest)).status).toBe(404);
    expect((await handleDeviceRequest(req("garbage"), "s3cret", ingest)).status).toBe(422);
  });
});
