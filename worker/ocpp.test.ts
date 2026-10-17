import { describe, expect, it } from "vitest";
import { deleteChargeCard, listChargeCards, saveChargeCard, setChargeCardBlocked } from "./charge-cards";
import { startSelfCharge, stopSelfCharge } from "./charging";
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

  it("accept only a tag we sent this charge point, once, on its connector", async () => {
    const { d1, env, requests } = await setup();
    const { order: idTag } = await startOutlet(env, CP, 1, "admin");
    const call = JSON.parse(requests[0].body);
    await applyOcppResult(d1, call.commandId, { type: 3, id: call.messageId, payload: { status: "Accepted" } });
    // Made up, or for another connector: refused.
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag: "PDR000ANYTHING" })).toEqual({ idTagInfo: { status: "Invalid" } });
    const other = await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 2, idTag, meterStart: 0, timestamp: "2026-10-15T06:00:00Z" });
    expect(other).toMatchObject({ idTagInfo: { status: "Invalid" } });
    // A refused start used the tag up: the charge point may not retry it either.
    const again = await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 1, idTag, meterStart: 0, timestamp: "2026-10-15T06:00:00Z" });
    expect(again).toMatchObject({ idTagInfo: { status: "Invalid" } });
  });

  it("refuse a start the charge point remembers after the outlet was switched off", async () => {
    const { d1, env, requests } = await setup();
    const { order: idTag } = await startOutlet(env, CP, 1, "admin");
    const call = JSON.parse(requests[0].body);
    await applyOcppResult(d1, call.commandId, { type: 3, id: call.messageId, payload: { status: "Accepted" } });
    // Switched off before the customer plugged in: no transaction to stop yet.
    await expect(stopOutlet(env, CP, 1, "admin")).rejects.toMatchObject({ code: "device_not_charging" });
    const late = await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 1, idTag, meterStart: 0, timestamp: "2026-10-15T06:00:00Z" });
    expect(late).toMatchObject({ idTagInfo: { status: "Invalid" } });
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
  function connection(env: Env, attachment: object = { externalId: ID }) {
    const storage = new Map<string, unknown>();
    const sent: string[] = [];
    const ws = {
      readyState: WebSocket.OPEN,
      send: (text: string) => sent.push(text),
      close: () => {},
      deserializeAttachment: () => attachment,
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

  it("keeps the first frames, errors and how the connection ended", async () => {
    const { db, env } = await setup();
    const traces = () =>
      (db.prepare("select payload from device_messages where payload like '%OcppTrace%' order by id").all() as { payload: string }[]).map((r) =>
        JSON.parse(r.payload),
      );
    // Long connected: only the refused call and the close are kept.
    const old = connection(env, { externalId: ID, connectedAt: Date.now() - 3_600_000 });
    await old.conn.webSocketMessage(old.ws, '[2,"hb-1","Heartbeat",{}]');
    await old.conn.webSocketMessage(old.ws, '[2,"x-1","ReserveNow",{}]');
    await old.conn.webSocketClose(old.ws, 1006, "", false);
    expect(traces()).toEqual([
      { action: "OcppTrace", dir: "out", frame: '[4,"x-1","NotImplemented","ReserveNow is not supported",{}]' },
      { action: "OcppTrace", dir: "close", code: 1006, reason: "", wasClean: false, seconds: 3600 },
    ]);
    // Freshly connected: every frame in and out.
    db.exec("delete from device_messages");
    const fresh = connection(env, { externalId: ID, connectedAt: Date.now() });
    await fresh.conn.webSocketMessage(fresh.ws, '[2,"hb-2","Heartbeat",{}]');
    await fresh.conn.webSocketMessage(fresh.ws, "garbage");
    expect(traces().map((t) => [t.dir, t.frame])).toEqual([
      ["in", '[2,"hb-2","Heartbeat",{}]'],
      ["out", fresh.sent[0]],
      ["in", "garbage"],
    ]);
  });
});

describe("OCPP charges by QR code", () => {
  const KOFI = { id: "kofi", phone: "+22896123456", email: null, fullName: "Kofi", role: "customer" } as const;

  async function charging() {
    const s = await setup();
    const now = new Date().toISOString();
    s.db.exec(`
      insert into users (id, phone, full_name, role, created_at) values ('kofi', '${KOFI.phone}', 'Kofi', 'rider', '${now}');
      update charging_points set qr_start = 1;
    `);
    await handleOcppCall(s.d1, ID, "BootNotification", { chargePointVendor: "V", chargePointModel: "M" });
    await handleOcppCall(s.d1, ID, "StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" });
    const point = (s.db.prepare("select id from charging_points where outlet = 1").get() as { id: string }).id;
    return { ...s, point };
  }
  const sessions = (db: ReturnType<typeof fakeD1>["db"]) => db.prepare("select status, energy_wh from charging_sessions").all();

  it("cancel the charge and give the reservation back when the charge point refuses to start", async () => {
    const { db, d1, env, requests, point } = await charging();
    const now = Date.now();
    db.prepare(
      `insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code, kind, target)
       values ('r1', 'kofi', 'st', 'slot', 'active', ?, ?, '1234', 'charging_point', ?)`,
    ).run(new Date(now - 60_000).toISOString(), new Date(now + 600_000).toISOString(), point);
    await startSelfCharge(env, KOFI, point);
    expect(db.prepare("select status from reservations").get()).toEqual({ status: "completed" });
    const call = JSON.parse(requests[0].body);
    await applyOcppResult(d1, call.commandId, { type: 3, id: call.messageId, payload: { status: "Rejected" } });
    expect(sessions(db)).toEqual([{ status: "cancelled", energy_wh: 0 }]);
    expect(db.prepare("select status, charging_point_id from reservations").get()).toEqual({ status: "active", charging_point_id: null });
    // The outlet can be started again.
    await startSelfCharge(env, KOFI, point);
    expect(db.prepare("select count(*) n from charging_sessions where status = 'charging'").get()).toEqual({ n: 1 });
  });

  it("never charge after the customer stopped, even if the charge point starts later", async () => {
    const { db, d1, env, requests, point } = await charging();
    const s = await startSelfCharge(env, KOFI, point);
    const call = JSON.parse(requests[0].body);
    await applyOcppResult(d1, call.commandId, { type: 3, id: call.messageId, payload: { status: "Accepted" } });
    await stopSelfCharge(env, KOFI, s.id);
    const late = await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 1, idTag: call.payload.idTag, meterStart: 1000, timestamp: new Date().toISOString() });
    expect(late).toMatchObject({ idTagInfo: { status: "Invalid" } });
    expect(sessions(db)).toEqual([{ status: "stopped", energy_wh: 0 }]);
    expect(points(db)[0]).toMatchObject({ status: "free" });
  });

  it("charge normally with the tag of the running charge", async () => {
    const { db, d1, env, requests, point } = await charging();
    await startSelfCharge(env, KOFI, point);
    const call = JSON.parse(requests[0].body);
    await applyOcppResult(d1, call.commandId, { type: 3, id: call.messageId, payload: { status: "Accepted" } });
    const start = (await handleOcppCall(d1, ID, "StartTransaction", { connectorId: 1, idTag: call.payload.idTag, meterStart: 1000, timestamp: new Date().toISOString() })) as {
      transactionId: number;
      idTagInfo: { status: string };
    };
    expect(start.idTagInfo.status).toBe("Accepted");
    await handleOcppCall(d1, ID, "StopTransaction", { transactionId: start.transactionId, meterStop: 1400, timestamp: new Date().toISOString() });
    expect(sessions(db)).toEqual([{ status: "stopped", energy_wh: 400 }]);
  });
});

describe("OCPP charges by card", () => {
  const ADMIN = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" } as const;
  const KOFI = { id: "kofi", phone: "+22896123456", email: null, fullName: "Kofi", role: "customer" } as const;
  const CARD = "04A3F21B7C";

  async function withCard() {
    const s = await setup();
    const now = new Date().toISOString();
    s.db.exec(`insert into users (id, phone, full_name, role, created_at) values ('kofi', '${KOFI.phone}', 'Kofi', 'rider', '${now}');`);
    await handleOcppCall(s.d1, ID, "BootNotification", { chargePointVendor: "V", chargePointModel: "M" });
    await handleOcppCall(s.d1, ID, "StatusNotification", { connectorId: 1, status: "Available", errorCode: "NoError" });
    await handleOcppCall(s.d1, ID, "StatusNotification", { connectorId: 2, status: "Available", errorCode: "NoError" });
    return s;
  }
  const link = (d1: D1Database, idTag: string, contact = KOFI.phone) =>
    saveChargeCard(d1, ADMIN, new Request("https://x", { method: "POST", body: JSON.stringify({ idTag, contact, label: "Kofi" }) }));
  const start = (d1: D1Database, idTag: string, connectorId = 1) =>
    handleOcppCall(d1, ID, "StartTransaction", { connectorId, idTag, meterStart: 5000, timestamp: new Date().toISOString() }) as Promise<{
      transactionId: number;
      idTagInfo: { status: string };
    }>;
  const sessions = (db: ReturnType<typeof fakeD1>["db"]) => db.prepare("select user_id, status, energy_wh, order_no from charging_sessions order by started_at").all();

  it("list a card nobody registered after its first swipe, and refuse it", async () => {
    const { db, d1 } = await withCard();
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag: "04:a3:f2:1b:7c" })).toEqual({ idTagInfo: { status: "Invalid" } });
    expect((await start(d1, CARD)).idTagInfo.status).toBe("Invalid");
    const cards = await listChargeCards(d1);
    expect(cards).toEqual([expect.objectContaining({ idTag: CARD, customer: null, lastDevice: ID })]);
    expect(sessions(db)).toEqual([]);
  });

  it("charge a registered card to its customer, who pays it like any charge", async () => {
    const { db, d1 } = await withCard();
    await link(d1, "04 a3 f2 1b 7c");
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag: CARD })).toEqual({ idTagInfo: { status: "Accepted" } });
    const tx = await start(d1, CARD);
    expect(tx.idTagInfo.status).toBe("Accepted");
    expect(sessions(db)).toEqual([{ user_id: "kofi", status: "charging", energy_wh: 0, order_no: CARD }]);
    expect(points(db)[0]).toMatchObject({ status: "charging" });
    // A second card swipe while it runs is refused.
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag: CARD })).toEqual({ idTagInfo: { status: "ConcurrentTx" } });
    await handleOcppCall(d1, ID, "StopTransaction", { transactionId: tx.transactionId, meterStop: 6500, timestamp: new Date().toISOString(), reason: "Local" });
    expect(sessions(db)).toEqual([{ user_id: "kofi", status: "stopped", energy_wh: 1500, order_no: CARD }]);
    // Not paid yet: the card waits until it is.
    expect(await handleOcppCall(d1, ID, "Authorize", { idTag: CARD })).toEqual({ idTagInfo: { status: "Blocked" } });
    expect((await start(d1, CARD, 2)).idTagInfo.status).toBe("Blocked");
  });

  it("refuse a blocked card, and one whose outlet is taken", async () => {
    const { db, d1 } = await withCard();
    await link(d1, CARD);
    db.prepare("insert into users (id, phone, full_name, role, created_at) values ('ama', '+22896000000', 'Ama', 'rider', ?)").run(new Date().toISOString());
    await link(d1, "CARD2", "+22896000000");
    expect((await start(d1, "CARD2", 1)).idTagInfo.status).toBe("Accepted");
    expect((await start(d1, CARD, 1)).idTagInfo.status).toBe("Invalid");
    await setChargeCardBlocked(d1, ADMIN, CARD, new Request("https://x", { method: "POST", body: JSON.stringify({ blocked: true }) }));
    expect((await start(d1, CARD, 2)).idTagInfo.status).toBe("Blocked");
    expect(db.prepare("select count(*) n from charging_sessions where user_id = 'kofi'").get()).toEqual({ n: 0 });
  });

  it("refuse to register our own remote start tags or an unknown customer", async () => {
    const { d1 } = await withCard();
    await expect(link(d1, "PDR123")).rejects.toMatchObject({ code: "card_invalid" });
    await expect(link(d1, CARD, "+22899999999")).rejects.toMatchObject({ code: "recipient_not_found" });
    await expect(deleteChargeCard(d1, ADMIN, CARD)).rejects.toMatchObject({ code: "not_found" });
  });
});
