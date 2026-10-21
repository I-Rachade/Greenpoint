import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDevice, handleDeviceCommands, recountSilentFreeSlots, startOutlet, stopOutlet } from "./devices";
import type { Env } from "./env";
import { handleXingkeCallback } from "./xingke";

// --- A minimal D1 on top of SQLite, with the real migrations -------------------

type Value = string | number | null;

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : (p as Value))));
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run() {
    return this.db.prepare(this.sql).run(...this.params);
  }
}

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  const dir = new URL("./migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("begin");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("commit");
        return out;
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
    },
  };
  return { db, d1 };
}

const DEVICE = "XK16-Demo-000001"; // mixed case: the vendor's API is case-sensitive

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('op', 'Op', 1, '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values ('st', 'op', 'Déckon', 6.1, 1.2, 'charging', '${now}');
    insert into station_status (station_id, is_open, free_slots, updated_at) values ('st', 1, 0, '${now}');
  `);
  const env = {
    DB: d1,
    XINGKE_API_HOST: "xingke.example",
    XINGKE_API_TOKEN: "api-token",
    XINGKE_CALLBACK_TOKEN: "callback-token",
    DEVICE_WEBHOOK_SECRET: "bridge-key",
  } as unknown as Env;
  await createDevice(d1 as unknown as D1Database, { externalId: DEVICE, stationId: "st", outlets: 2, link: "vendor_cloud", vendor: "Xingke" }, "admin");
  return { db, d1, env };
}

function platform(status = 202, body: object = { code: "ACCEPTED" }) {
  const calls: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  });
  return calls;
}

function callback(body: object, token = "callback-token") {
  return new Request("https://app.poinderecharge.com/api/devices/xingke", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

const event = (action: string, data: object, messageId: string) => ({
  messageId,
  deviceId: DEVICE,
  action,
  timestamp: new Date().toISOString(),
  data,
});

afterEach(() => vi.unstubAllGlobals());

describe("Xingke cloud", () => {
  it("sends a start to the vendor platform with the device id as registered", async () => {
    const { db, env } = await setup();
    const calls = platform();
    const { order } = await startOutlet(env, DEVICE.toUpperCase(), 2, "admin");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`https://xingke.example/openapi/v1/devices/${DEVICE}/commands`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer api-token");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body).toMatchObject({
      action: "RemoteStartTransaction",
      data: { connectorId: 2, transactionId: order, startSource: "Remote", chargingMode: "AutoStop" },
    });
    expect(order).toMatch(/^\d{20}$/);
    const row = db.prepare("select status, message_id from device_commands").get() as { status: string; message_id: string };
    expect(row).toEqual({ status: "sent", message_id: body.messageId });
  });

  it("is not handed to the text-line bridge", async () => {
    const { env } = await setup();
    platform();
    await startOutlet(env, DEVICE, 1, "admin");
    const res = await handleDeviceCommands(
      new Request("https://app.poinderecharge.com/api/devices/commands", { headers: { "X-Device-Key": "bridge-key" } }),
      env,
    );
    expect(await res.text()).toBe("");
  });

  it("closes the command on its result and shows the outlet charging", async () => {
    const { db, env } = await setup();
    const calls = platform();
    await startOutlet(env, DEVICE, 1, "admin");
    const { messageId } = JSON.parse(String(calls[0].init.body));
    const result = event(
      "CommandResult",
      { requestAction: "RemoteStartTransaction", status: "Succeeded", code: "OK", message: "", result: { connectorId: 1 } },
      messageId,
    );
    const res = await handleXingkeCallback(callback(result), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ code: "OK" });
    expect(db.prepare("select status, result from device_commands").get()).toEqual({ status: "done", result: "OK" });
    expect(db.prepare("select status from charging_points where outlet = 1").get()).toEqual({ status: "charging" });

    // A late Unknown does not undo the confirmed result.
    await handleXingkeCallback(callback({ ...result, data: { ...result.data, status: "Unknown", code: "TIMEOUT" } }), env);
    expect(db.prepare("select status, result from device_commands").get()).toEqual({ status: "done", result: "OK" });
  });

  it("stops the outlet's last charge with the same transaction id", async () => {
    const { env } = await setup();
    const calls = platform();
    const { order } = await startOutlet(env, DEVICE, 1, "admin");
    await stopOutlet(env, DEVICE, 1, "admin");
    expect(JSON.parse(String(calls[1].init.body))).toMatchObject({
      action: "RemoteStopTransaction",
      data: { connectorId: 1, transactionId: order, stopSource: "Remote" },
    });
  });

  it("reports an offline device and records the refusal with the platform's reason", async () => {
    const { db, env } = await setup();
    platform(409, { code: "DEVICE_OFFLINE", message: "offline" });
    await expect(startOutlet(env, DEVICE, 1, "admin")).rejects.toMatchObject({ code: "device_offline" });
    expect(db.prepare("select status, result from device_commands").get()).toEqual({ status: "failed", result: "DEVICE_OFFLINE: offline" });
  });

  it("tolerates a pasted https:// in the host and Bearer in the token", async () => {
    const { env } = await setup();
    Object.assign(env, { XINGKE_API_HOST: " https://xingke.example/ ", XINGKE_API_TOKEN: "Bearer api-token " });
    const calls = platform();
    await startOutlet(env, DEVICE, 1, "admin");
    expect(calls[0].url).toBe(`https://xingke.example/openapi/v1/devices/${DEVICE}/commands`);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer api-token");
  });

  it("needs the platform settings", async () => {
    const { env } = await setup();
    delete (env as Partial<Env>).XINGKE_API_HOST;
    await expect(startOutlet(env, DEVICE, 1, "admin")).rejects.toMatchObject({ code: "device_not_configured" });
  });

  it("applies status reports once, with energy in Wh and the station's free count", async () => {
    const { db, env } = await setup();
    const status = event(
      "StatusNotification",
      {
        connectors: [
          { connectorId: 1, status: "Available", errorCode: "NoError", vendorCode: "00" },
          { connectorId: 2, status: "Charging", errorCode: "NoError", vendorCode: "01" },
        ],
      },
      "evt-0021",
    );
    expect((await handleXingkeCallback(callback(status), env)).status).toBe(200);
    expect(db.prepare("select outlet, status from charging_points order by outlet").all()).toEqual([
      { outlet: 1, status: "free" },
      { outlet: 2, status: "charging" },
    ]);
    expect(db.prepare("select free_slots from station_status").get()).toEqual({ free_slots: 1 });

    await handleXingkeCallback(
      callback(
        event(
          "ChargingStatusNotification",
          { connectorId: 2, transactionId: "1", status: "Stopped", reason: "Completed", vendorCode: "03", power: 0, energy: 1.5 },
          "evt-0020",
        ),
      ),
      env,
    );
    expect(db.prepare("select status, energy_wh from charging_points where outlet = 2").get()).toEqual({ status: "done", energy_wh: 1500 });

    // The same delivery again changes nothing.
    db.exec("update charging_points set status = 'fault' where outlet = 1");
    expect((await handleXingkeCallback(callback(status), env)).status).toBe(200);
    expect(db.prepare("select status from charging_points where outlet = 1").get()).toEqual({ status: "fault" });
  });

  it("takes outlets out when the device goes offline", async () => {
    const { db, env } = await setup();
    await handleXingkeCallback(callback(event("DeviceOnline", { reason: "Connected" }, "evt-0024")), env);
    expect(db.prepare("select count(*) n from charging_points where last_seen_at is not null").get()).toEqual({ n: 2 });
    expect(db.prepare("select free_slots from station_status").get()).toEqual({ free_slots: 2 });
    await handleXingkeCallback(callback(event("DeviceOffline", { reason: "HeartbeatTimeout" }, "evt-0025")), env);
    expect(db.prepare("select count(*) n from charging_points where last_seen_at is not null").get()).toEqual({ n: 0 });
    expect(db.prepare("select free_slots from station_status").get()).toEqual({ free_slots: 0 });
  });

  it("takes the places of a socket that fell silent out of the free places (minute cron)", async () => {
    const { db, d1, env } = await setup();
    await handleXingkeCallback(callback(event("DeviceOnline", { reason: "Connected" }, "evt-0026")), env);
    expect(db.prepare("select free_slots from station_status").get()).toEqual({ free_slots: 2 });
    db.exec(`update charging_points set last_seen_at = '${new Date(Date.now() - 20 * 60_000).toISOString()}' where outlet = 1`);
    await recountSilentFreeSlots(d1 as unknown as D1Database);
    expect(db.prepare("select free_slots from station_status").get()).toEqual({ free_slots: 1 });
  });

  it("rejects wrong credentials and broken bodies", async () => {
    const { env } = await setup();
    expect((await handleXingkeCallback(callback(event("DeviceOnline", {}, "e1"), "wrong"), env)).status).toBe(401);
    const bad = await handleXingkeCallback(callback({ deviceId: DEVICE }), env);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("acknowledges events of unknown devices so they are not retried", async () => {
    const { db, env } = await setup();
    const res = await handleXingkeCallback(callback({ ...event("DeviceOnline", { reason: "Connected" }, "e2"), deviceId: "OTHER-1" }), env);
    expect(res.status).toBe(200);
    expect(db.prepare("select external_id from device_messages").get()).toEqual({ external_id: "OTHER-1" });
  });
});
