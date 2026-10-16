import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canSwitch, commandRoute } from "../iot/devices";
import {
  commandStatus,
  parseXingkeCallback,
  XingkeCallbackError,
  xingkeDedupKey,
  xingkeEffect,
  xingkeMessageId,
  xingkeStartRequest,
  xingkeStopRequest,
} from "../iot/xingke-cloud";

// Examples from the Xingke Unified API V1.0 (planung/xingke-two-wheeler-api-v1.0-en.pdf).
const envelope = (action: string, data: object, messageId = "evt-0019") => ({
  messageId,
  deviceId: "XK16-DEMO-000001",
  action,
  timestamp: "2026-10-13T02:00:00Z",
  data,
});

const effect = (action: string, data: object) => xingkeEffect(parseXingkeCallback(envelope(action, data)));

describe("Xingke cloud commands", () => {
  it("builds a start until full and a timed start as in section 6", () => {
    expect(xingkeStartRequest("start-1", 1, "20261013000000000001")).toEqual({
      messageId: "start-1",
      action: "RemoteStartTransaction",
      data: { connectorId: 1, transactionId: "20261013000000000001", startSource: "Remote", chargingMode: "AutoStop" },
    });
    expect(xingkeStartRequest("start-2", 2, "20261013000000000002", 3600).data).toEqual({
      connectorId: 2,
      transactionId: "20261013000000000002",
      startSource: "Remote",
      chargingMode: "Timed",
      duration: 3600,
    });
    expect(() => xingkeStartRequest("x", 1, "1", 90)).toThrow();
    expect(() => xingkeStartRequest("x", 1, "1", 60_000)).toThrow();
  });

  it("builds a stop as in section 7", () => {
    expect(xingkeStopRequest("stop-1", 1, "20261013000000000001")).toEqual({
      messageId: "stop-1",
      action: "RemoteStopTransaction",
      data: { connectorId: 1, transactionId: "20261013000000000001", stopSource: "Remote" },
    });
  });

  it("makes message ids the API accepts", () => {
    const id = xingkeMessageId("start");
    expect(id).toMatch(/^pdr-start-[0-9a-f]{32}$/);
    expect(id.length).toBeLessThanOrEqual(64);
  });
});

describe("Xingke cloud callbacks", () => {
  it("rejects a broken envelope", () => {
    expect(() => parseXingkeCallback({ ...envelope("DeviceOnline", {}), deviceId: "bad id" })).toThrow(XingkeCallbackError);
    expect(() => parseXingkeCallback({ ...envelope("DeviceOnline", {}), timestamp: "soon" })).toThrow(XingkeCallbackError);
    expect(() => parseXingkeCallback({ ...envelope("DeviceOnline", {}), data: "{}" })).toThrow(XingkeCallbackError);
  });

  it("reads charging status with power in W and energy converted to Wh", () => {
    expect(
      effect("ChargingStatusNotification", {
        connectorId: 1,
        transactionId: "20261013000000000001",
        status: "Charging",
        reason: "None",
        vendorCode: "00",
        power: 260.85,
        energy: 1.25,
      }),
    ).toEqual({ outlets: [{ outlet: 1, status: "charging", powerWatts: 261, energyWh: 1250, transactionId: "20261013000000000001" }] });
  });

  it("maps stop reasons", () => {
    const stopped = (reason: string) =>
      effect("ChargingStatusNotification", { connectorId: 1, transactionId: "1", status: "Stopped", reason, vendorCode: "03" })!.outlets[0]
        .status;
    expect(stopped("Completed")).toBe("done");
    expect(stopped("PowerLossOrUnplugged")).toBe("free");
    expect(stopped("Overload")).toBe("fault");
    expect(stopped("SomethingNew")).toBeUndefined();
  });

  it("reads channel states and leaves unknown ones alone", () => {
    expect(
      effect("StatusNotification", {
        temperature: 26.01,
        connectors: [
          { connectorId: 1, status: "Available", errorCode: "NoError", vendorCode: "00" },
          { connectorId: 2, status: "Charging", errorCode: "NoError", vendorCode: "01" },
          { connectorId: 3, status: "Faulted", errorCode: "RelayStuck", vendorCode: "90" },
          { connectorId: 4, status: "Unknown", errorCode: "Unknown", vendorCode: "77" },
        ],
      })!.outlets,
    ).toEqual([
      { outlet: 1, status: "free" },
      { outlet: 2, status: "charging" },
      { outlet: 3, status: "fault" },
      { outlet: 4, status: undefined },
    ]);
  });

  it("reads faults of one channel and of the whole device", () => {
    expect(effect("FaultNotification", { scope: "Connector", connectorId: 3, errorCode: "OverVoltage", vendorCode: "11" })).toEqual({
      outlets: [{ outlet: 3, status: "fault" }],
    });
    expect(effect("FaultNotification", { scope: "Device", errorCode: "HighTemperature", vendorCode: "10" })).toEqual({
      outlets: [],
      allOutlets: "fault",
    });
  });

  it("reads online, offline and command results; card events are only stored", () => {
    expect(effect("DeviceOnline", { reason: "Connected" })).toEqual({ outlets: [], online: true });
    expect(effect("DeviceOffline", { reason: "HeartbeatTimeout" })).toEqual({ outlets: [], online: false });
    expect(effect("CardPresented", { connectorId: 1, idTag: "0012345678", intent: "BalanceInquiry" })).toBeNull();
    const result = xingkeEffect(
      parseXingkeCallback(
        envelope(
          "CommandResult",
          { requestAction: "RemoteStartTransaction", status: "Failed", code: "ALREADY_CHARGING", message: "", result: { connectorId: 2 } },
          "start-timed-0001",
        ),
      ),
    );
    expect(result?.command).toEqual({
      messageId: "start-timed-0001",
      requestAction: "RemoteStartTransaction",
      status: "Failed",
      code: "ALREADY_CHARGING",
      connectorId: 2,
    });
    expect([commandStatus("Succeeded"), commandStatus("Sent"), commandStatus("Failed"), commandStatus("Unknown")]).toEqual([
      "done",
      "done",
      "failed",
      null,
    ]);
  });

  it("deduplicates command results per status, other events per message", () => {
    const unknown = parseXingkeCallback(envelope("CommandResult", { status: "Unknown" }, "m1"));
    const confirmed = parseXingkeCallback(envelope("CommandResult", { status: "Succeeded" }, "m1"));
    expect(xingkeDedupKey(unknown)).not.toBe(xingkeDedupKey(confirmed));
    expect(xingkeDedupKey(parseXingkeCallback(envelope("DeviceOnline", {}, "e1")))).toBe("XK16-DEMO-000001:DeviceOnline:e1");
  });
});

describe("command routes", () => {
  it("switches Xingke cloud sockets and 6-digit bridge sockets only", () => {
    expect(commandRoute({ externalId: "XK16-DEMO-000001", vendor: "Xingke", link: "vendor_cloud" })).toBe("xingke_cloud");
    expect(commandRoute({ externalId: "123456", vendor: "", link: "own_server" })).toBe("xingke_bridge");
    expect(canSwitch({ externalId: "70B3D57ED0000001", vendor: "LoRa", link: "lorawan" })).toBe(false);
  });
});

// The vendor's JSON package (planung/xingke-two-wheeler-api-v1.0-en-json.zip), unchanged.
const FIXTURES = new URL("./fixtures/xingke/", import.meta.url);
const fixture = (name: string) => JSON.parse(readFileSync(new URL(name, FIXTURES), "utf8"));
const eventFiles = readdirSync(FIXTURES).filter((f) => /^\d+_event_/.test(f));

describe("vendor JSON examples", () => {
  it("our commands match the vendor's start and stop examples", () => {
    const start = fixture("01_command_RemoteStartTransaction.json");
    expect(xingkeStartRequest(start.messageId, 1, start.data.transactionId)).toEqual(start);
    const timed = fixture("03_command_RemoteStartTransaction.json");
    expect(xingkeStartRequest(timed.messageId, 2, timed.data.transactionId, 3600)).toEqual(timed);
    const stop = fixture("05_command_RemoteStopTransaction.json");
    expect(xingkeStopRequest(stop.messageId, 1, stop.data.transactionId)).toEqual({ ...stop, data: { ...stop.data, stopSource: "Remote" } });
  });

  it.each(eventFiles)("reads %s", (file) => {
    const cb = parseXingkeCallback(fixture(file));
    const action = file.replace(/^\d+_event_|\.json$/g, "");
    expect(cb.action).toBe(action);
    const result = xingkeEffect(cb);
    if (action === "CardPresented") expect(result).toBeNull();
    else expect(result).not.toBeNull();
  });

  it("maps the example events as documented", () => {
    const read = (name: string) => xingkeEffect(parseXingkeCallback(fixture(name)));
    expect(read("19_event_ChargingStatusNotification.json")?.outlets).toEqual([{ outlet: 1, status: "charging", powerWatts: 261, energyWh: 1250, transactionId: "20261013000000000001" }]);
    expect(read("20_event_ChargingStatusNotification.json")?.outlets).toEqual([{ outlet: 1, status: "done", powerWatts: 0, energyWh: 1500, transactionId: "20261013000000000001" }]);
    expect(read("21_event_StatusNotification.json")?.outlets.map((o) => o.status)).toEqual(["free", "charging", "fault"]);
    expect(read("27_event_FaultNotification.json")).toEqual({ outlets: [], allOutlets: "fault" });
    expect(read("25_event_DeviceOffline.json")?.online).toBe(false);
  });
});
