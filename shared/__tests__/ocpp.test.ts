import { describe, expect, it } from "vitest";
import { canSwitch, commandRoute, validDeviceInput } from "../iot/devices";
import {
  OcppCallError,
  OcppFrameError,
  basicAuth,
  callFrame,
  errorFrame,
  meterReading,
  ocppIdTag,
  ocppKey,
  parseFrame,
  resultFrame,
  statusEffect,
} from "../iot/ocpp";

// OCPP 1.6J frames and payloads as in the spec's examples.

describe("OCPP frames", () => {
  it("reads calls, results and errors", () => {
    expect(parseFrame('[2,"19223201","BootNotification",{"chargePointVendor":"VendorX","chargePointModel":"SingleSocketCharger"}]')).toEqual({
      type: 2,
      id: "19223201",
      action: "BootNotification",
      payload: { chargePointVendor: "VendorX", chargePointModel: "SingleSocketCharger" },
    });
    expect(parseFrame('[3,"m1",{"status":"Accepted"}]')).toEqual({ type: 3, id: "m1", payload: { status: "Accepted" } });
    expect(parseFrame('[4,"m1","NotImplemented","nope",{}]')).toEqual({ type: 4, id: "m1", code: "NotImplemented", description: "nope" });
  });

  it("rejects what is not a frame", () => {
    for (const text of ["hello", "{}", "[2]", '[2,"",""]', '[2,"1","Heartbeat",[]]', '[5,"1",{}]']) {
      expect(() => parseFrame(text)).toThrow(OcppFrameError);
    }
  });

  it("writes frames", () => {
    expect(callFrame("a", "RemoteStartTransaction", { connectorId: 1, idTag: "PDR1" })).toBe(
      '[2,"a","RemoteStartTransaction",{"connectorId":1,"idTag":"PDR1"}]',
    );
    expect(resultFrame("a", {})).toBe('[3,"a",{}]');
    expect(errorFrame("a", "NotImplemented", "x")).toBe('[4,"a","NotImplemented","x",{}]');
  });

  it("makes idTags and keys the spec accepts", () => {
    const tag = ocppIdTag();
    expect(tag).toMatch(/^PDR[0-9A-F]{17}$/);
    expect(ocppKey()).toMatch(/^[0-9a-f]{32}$/);
  });

  it("reads Basic auth", () => {
    expect(basicAuth(`Basic ${btoa("CP001:secret:with:colons")}`)).toEqual({ user: "CP001", password: "secret:with:colons" });
    expect(basicAuth("Bearer x")).toBeNull();
    expect(basicAuth(null)).toBeNull();
  });
});

describe("OCPP reports", () => {
  it("maps connector states, and a fault of connector 0 to every outlet", () => {
    const s = (status: string, connectorId = 1) => statusEffect({ connectorId, status, errorCode: "NoError" });
    expect(s("Available").outlets).toEqual([{ outlet: 1, status: "free" }]);
    expect(s("Charging").outlets[0].status).toBe("charging");
    expect(s("SuspendedEV").outlets[0].status).toBe("charging");
    expect(s("Finishing").outlets[0].status).toBe("done");
    expect(s("Faulted").outlets[0].status).toBe("fault");
    expect(s("Preparing").outlets[0].status).toBeUndefined();
    expect(s("Faulted", 0)).toEqual({ outlets: [], allOutlets: "fault" });
    expect(s("Available", 0)).toEqual({ outlets: [], allOutlets: undefined });
    expect(() => statusEffect({ status: "Available" })).toThrow(OcppCallError);
  });

  it("reads power and the charge's energy from meter values", () => {
    const payload = {
      connectorId: 2,
      transactionId: 7,
      meterValue: [
        {
          timestamp: "2026-10-15T06:00:00Z",
          sampledValue: [
            { value: "1250.5", measurand: "Energy.Active.Import.Register", unit: "Wh" },
            { value: "0.26", measurand: "Power.Active.Import", unit: "kW" },
          ],
        },
      ],
    };
    expect(meterReading(payload, 1000)).toEqual({ outlet: 2, powerWatts: 260, energyWh: 251 });
    // The default measurand is the energy register, in Wh.
    expect(meterReading({ connectorId: 1, meterValue: [{ sampledValue: [{ value: "5" }] }] }, 2)).toEqual({ outlet: 1, energyWh: 3 });
    // Per-phase power adds up.
    const phases = ["L1", "L2", "L3"].map((phase) => ({ value: "100", measurand: "Power.Active.Import", phase }));
    expect(meterReading({ connectorId: 1, meterValue: [{ sampledValue: phases }] })).toEqual({ outlet: 1, powerWatts: 300 });
    expect(meterReading({ connectorId: 0, meterValue: [] })).toBeNull();
  });
});

describe("OCPP sockets", () => {
  const ocpp = { externalId: "CP-001", vendor: "Any", link: "own_server" as const, protocol: "ocpp1.6" as const };

  it("are switched over OCPP", () => {
    expect(commandRoute(ocpp)).toBe("ocpp");
    expect(canSwitch(ocpp)).toBe(true);
  });

  it("must be on our own server", () => {
    expect(validDeviceInput({ ...ocpp, stationId: "st", outlets: 2 })).toBe(true);
    expect(validDeviceInput({ ...ocpp, link: "vendor_cloud", stationId: "st", outlets: 2 })).toBe(false);
  });
});
