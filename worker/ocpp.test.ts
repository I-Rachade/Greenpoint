import { describe, expect, it } from "vitest";
import { createDevice, startOutlet, stopOutlet } from "./devices";
import type { Env } from "./env";
import { applyOcppResult, handleOcppCall, handleOcppUpgrade, logOcppAttempt, OcppConnection, offeredProtocol } from "./ocpp";
import { fakeD1 } from "./test-d1";

const CP = "CP-Agoe-01"; // as the charge point spells its id in the URL
const ID = CP.toUpperCase();

/** A Durable Object namespace that records what the Worker hands to the charge point's connection. */
function fakeNamespace(online = true) {
  const requests: { url: string; body: string; headers: Headers }[] = [];
  const stub = {
    async fetch(input: Request | string, init?: RequestInit) {
      const request = typeof input === "string" ? new Request(input, init) : input;
      requests.push({ url: request.url, body: request.method === "POST" ? await request.text() : "", headers: request.headers });
      if (new URL(request.url).pathname === "/call") return Response.json(online ? { ok: true } : { ok: false, code: "DEVICE_OFFLINE" });
      return new Response("connected");
    },
  };
  return { requests, namespace: { idFromName: (name: string) => name, get: () => stub } };
}

async function setup(online = true) {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('op', 'Op', 1, '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values ('st', 'op', 'Agoè', 6.1, 1.2, 'charging', '${now}');
    insert into station_status (station_id, is_open, free_slots, updated_at) values ('st', 1, 0, '${now}');
  `);
  const ns = fakeNamespace(online);
  const env = { DB: d1, OCPP: ns.namespace } as unknown as Env;
  const created = await createDevice(
    d1 as unknown as D1Database,
    { externalId: CP, stationId: "st", outlets: 2, link: "own_server", protocol: "ocpp1.6" },
    "admin",
  );
  const key = (created as { ocppKey?: string }).ocppKey!;
  return { db, d1: d1 as unknown as D1Database, env, key, requests: ns.requests };
}

const upgrade = (key?: string, protocol = "ocpp1.6", id = CP) =>
  new Request(`https://app.poinderecharge.com/api/devices/ocpp/${id}`, {
    headers: {
      Upgrade: "websocket",
      "Sec-WebSocket-Protocol": protocol,
      ...(key ? { Authorization: `Basic ${btoa(`${id}:${key}`)}` } : {}),
    },
  });

const points = (db: ReturnType<typeof fakeD1>["db"]) =>
  db.prepare("select outlet, status, energy_wh from charging_points where device_id = ? order by outlet").all(ID);

describe("OCPP charge points", () => {
  it("get a key once, stored only as a hash", async () => {
    const { db, key } = await setup();
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    const row = db.prepare("select protocol, ocpp_key_hash from devices").get() as { protocol: string; ocpp_key_hash: string };
    expect(row.protocol).toBe("ocpp1.6");
    expect(row.ocpp_key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.ocpp_key_hash).not.toContain(key);
  });

  it("connect only with their key and the ocpp1.6 subprotocol", async () => {
    const { env, key, requests } = await setup();
    expect((await handleOcppUpgrade(new Request("https://x/api/devices/ocpp/CP"), env, CP)).status).toBe(426);
    expect((await handleOcppUpgrade(upgrade(), env, CP)).status).toBe(401);
    expect((await handleOcppUpgrade(upgrade("wrong"), env, CP)).status).toBe(401);
    expect((await handleOcppUpgrade(upgrade(key, "ocpp2.0.1"), env, CP)).status).toBe(400);
    expect((await handleOcppUpgrade(upgrade(key, "ocpp1.6", "OTHER-1"), env, "OTHER-1")).status).toBe(404);
    expect(requests).toHaveLength(0);
    const ok = await handleOcppUpgrade(upgrade(key), env, CP);
    expect(await ok.text()).toBe("connected");
    expect(requests[0].url).toBe(`https://ocpp/connect?id=${ID}`);
  });

  it("connect with the key in the URL when the firmware cannot send a password", async () => {
    const { env, key, requests } = await setup();
    expect((await handleOcppUpgrade(upgrade(), env, CP, "wrong")).status).toBe(401);
    expect((await handleOcppUpgrade(upgrade(), env, "OTHER-1", key)).status).toBe(404);
    expect(requests).toHaveLength(0);
    expect(await (await handleOcppUpgrade(upgrade(), env, CP, key)).text()).toBe("connected");
  });

  it("connect without a password when added without one", async () => {
    const { d1, env, requests } = await setup();
    const input = { externalId: "OPEN-1", stationId: "st", outlets: 1, link: "own_server", protocol: "ocpp1.6", ocppNoPassword: true } as const;
    expect(await createDevice(d1, input, "admin")).toEqual({ externalId: "OPEN-1", outlets: 1 });
    expect(await (await handleOcppUpgrade(upgrade(undefined, "ocpp1.6", "OPEN-1"), env, "OPEN-1")).text()).toBe("connected");
    expect(requests[0].url).toBe("https://ocpp/connect?id=OPEN-1");
    // Sockets added with a password still need it.
    expect((await handleOcppUpgrade(upgrade(), env, CP)).status).toBe(401);
  });

  it("answer only with a subprotocol the charge point offered", async () => {
    const offered = (protocol?: string) =>
      offeredProtocol(new Request("https://x/", { headers: protocol ? { "Sec-WebSocket-Protocol": protocol } : {} }));
    expect(offered()).toBeNull();
    expect(offered("OCPP1.6")).toBe("OCPP1.6");
    expect(offered("ocpp2.0.1, ocpp1.6j")).toBe("ocpp1.6j");
    expect(offered("ocpp2.0.1")).toBe(false);
    const { env } = await setup();
    const open = { externalId: "OPEN-1", stationId: "st", outlets: 1, link: "own_server", protocol: "ocpp1.6", ocppNoPassword: true } as const;
    await createDevice(env.DB, open, "admin");
    const bare = new Request("https://x/api/devices/ocpp/OPEN-1", { headers: { Upgrade: "websocket" } });
    expect(await (await handleOcppUpgrade(bare, env, "OPEN-1")).text()).toBe("connected");
  });

  it("keep connection attempts, the key masked, at most one a minute", async () => {
    const { db, d1, key } = await setup();
    const request = new Request(`https://x/api/devices/ocpp/k/${key}/${CP}`, { headers: { Upgrade: "websocket", "User-Agent": "XK" } });
    await logOcppAttempt(d1, request, CP, 401);
    await logOcppAttempt(d1, request, CP, 401);
    const rows = db.prepare("select external_id, payload from device_messages").all() as { external_id: string; payload: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].external_id).toBe(ID);
    expect(rows[0].payload).not.toContain(key);
    expect(JSON.parse(rows[0].payload)).toMatchObject({ action: "OcppConnect", status: 401, path: `/api/devices/ocpp/k/***/${CP}`, userAgent: "XK" });
  });

  it("boot, report status and are switched on and off", async () => {
    const { db, d1, env, requests } = await setup();
    const boot = await handleOcppCall(d1, ID, "BootNotification", { chargePointVendor: "Xingke", chargePointModel: "XK-16" });
    expect(boot).toMatchObject({ status: "Accepted", interval: 300 });
    expect(db.prepare("select vendor, model, last_seen_at is not null seen from devices").get()).toEqual({ vendor: "Xingke", model: "XK-16", seen: 1 });

    await handleOcppCall(d1, ID, "StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" });
    await handleOcppCall(d1, ID, "StatusNotification", { connectorId: 2, status: "Available", errorCode: "NoError" });
    expect(db.prepare("select free_slots from station_status").get()).toEqual({ free_slots: 2 });

    // Switch on: a RemoteStartTransaction with a fresh idTag goes to the connection.
    const { order: idTag } = await startOutlet(env, CP, 2, "admin");
    const call = JSON.parse(requests[0].body);
    expect(call).toMatchObject({ action: "RemoteStartTransaction", payload: { connectorId: 2, idTag } });
    expect(db.prepare("select status, message_id from device_commands").get()).toEqual({ status: "sent", message_id: call.messageId });
    await applyOcppResult(d1, call.commandId, { type: 3, id: call.messageId, payload: { status: "Accepted" } });
    expect(db.prepare("select status, result from device_commands").get()).toEqual({ status: "done", result: "Accepted" });

    // The charge point starts the charge with our idTag.
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag })).toEqual({ idTagInfo: { status: "Accepted" } });
    const start = (await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 2, idTag, meterStart: 10_000, timestamp: "2026-10-15T06:00:00Z" })) as {
      transactionId: number;
      idTagInfo: { status: string };
    };
    expect(start.idTagInfo.status).toBe("Accepted");
    await handleOcppCall(d1, ID, "MeterValues", {
      connectorId: 2,
      transactionId: start.transactionId,
      meterValue: [{ timestamp: "2026-10-15T06:10:00Z", sampledValue: [{ value: "10350" }, { value: "260", measurand: "Power.Active.Import", unit: "W" }] }],
    });
    expect(db.prepare("select status, power_watts, energy_wh from charging_points where outlet = 2").get()).toEqual({
      status: "charging",
      power_watts: 260,
      energy_wh: 350,
    });

    // Switch off: the connector's open charge is stopped.
    await stopOutlet(env, CP, 2, "admin");
    expect(JSON.parse(requests[1].body)).toMatchObject({ action: "RemoteStopTransaction", payload: { transactionId: start.transactionId } });
    await handleOcppCall(d1, ID, "StopTransaction", { transactionId: start.transactionId, meterStop: 10_500, timestamp: "2026-10-15T06:20:00Z", reason: "Remote" });
    expect(points(db)).toEqual([
      { outlet: 1, status: "free", energy_wh: null },
      { outlet: 2, status: "done", energy_wh: 500 },
    ]);
    await expect(stopOutlet(env, CP, 2, "admin")).rejects.toMatchObject({ code: "device_not_charging" });
  });

  it("refuse charges with tags that are not ours", async () => {
    const { db, d1 } = await setup();
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag: "CARD123" })).toEqual({ idTagInfo: { status: "Invalid" } });
    const start = await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 1, idTag: "CARD123", meterStart: 0, timestamp: "2026-10-15T06:00:00Z" });
    expect(start).toMatchObject({ transactionId: 1, idTagInfo: { status: "Invalid" } });
    expect(points(db)[0]).toMatchObject({ status: "free" });
  });

  it("report an offline charge point and record the failed command", async () => {
    const { db, env } = await setup(false);
    await expect(startOutlet(env, CP, 1, "admin")).rejects.toMatchObject({ code: "device_offline" });
    expect(db.prepare("select status, result from device_commands").get()).toEqual({ status: "failed", result: "DEVICE_OFFLINE" });
  });

  it("answer unknown requests and bad payloads with an error", async () => {
    const { d1 } = await setup();
    await expect(handleOcppCall(d1, ID, "ReserveNow", {})).rejects.toMatchObject({ code: "NotImplemented" });
    await expect(handleOcppCall(d1, ID, "StartTransaction", { connectorId: "1" })).rejects.toMatchObject({ code: "TypeConstraintViolation" });
  });
});

describe("OCPP connection", () => {
  function connection(env: Env) {
    const storage = new Map<string, unknown>();
    const sent: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (text: string) => sent.push(text),
      close: () => {},
      deserializeAttachment: () => ({ externalId: ID }),
    };
    const ctx = {
      getWebSockets: () => [ws],
      storage: {
        get: async (k: string) => storage.get(k),
        put: async (k: string, v: unknown) => void storage.set(k, v),
        delete: async (k: string) => storage.delete(k),
      },
    };
    return { conn: new OcppConnection(ctx as unknown as DurableObjectState, env), ws: ws as unknown as WebSocket, sent, storage };
  }

  it("answers the charge point and matches its answers to our commands", async () => {
    const { db, env } = await setup();
    const { conn, ws, sent, storage } = connection(env);
    await conn.webSocketMessage(ws, '[2,"hb-1","Heartbeat",{}]');
    expect(JSON.parse(sent[0])).toEqual([3, "hb-1", { currentTime: expect.any(String) }]);
    await conn.webSocketMessage(ws, '[2,"x-1","ReserveNow",{}]');
    expect(JSON.parse(sent[1])).toEqual([4, "x-1", "NotImplemented", "ReserveNow is not supported", {}]);

    db.exec(`insert into device_commands (id, external_id, outlet, kind, order_no, line, message_id, status, created_at)
             values (5, '${ID}', 1, 'start', 'PDR1', '[]', 'm-5', 'sent', '2026-10-15T06:00:00Z')`);
    const res = await conn.fetch(
      new Request(`https://ocpp/call?id=${ID}`, { method: "POST", body: JSON.stringify({ commandId: 5, messageId: "m-5", action: "RemoteStartTransaction", payload: { connectorId: 1, idTag: "PDR1" } }) }),
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(JSON.parse(sent[2])).toEqual([2, "m-5", "RemoteStartTransaction", { connectorId: 1, idTag: "PDR1" }]);
    expect(storage.has("pending:m-5")).toBe(true);

    await conn.webSocketMessage(ws, '[4,"m-5","GenericError","connector busy",{}]');
    expect(db.prepare("select status, result from device_commands where id = 5").get()).toEqual({ status: "failed", result: "GenericError: connector busy" });
    expect(storage.has("pending:m-5")).toBe(false);
  });
});
