import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { ChargeSession } from "../src/lib/charging";
import type { Profile } from "../src/lib/types";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";
import { handleApi } from "./api";
import { sha256 } from "./http";
import { handleXingkeCallback } from "./xingke";

const OPERATOR = "00000000-0000-4000-8000-000000000001";
const DEV = "XK16-A-0001";
const users: Profile[] = [
  { id: "staff", phone: "+22890000002", email: null, fullName: "Afi", role: "operator" },
  { id: "kofi", phone: "+22896123456", email: null, fullName: "Kofi Mensah", role: "customer" },
  { id: "ama", phone: "+22896123457", email: null, fullName: "Ama", role: "customer" },
  { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" },
];
const tok = (id: string) => `${id}-session-token-0123456789`;
let pinHash = "";
beforeAll(async () => { pinHash = await hashPin("2580"); });
afterEach(() => vi.unstubAllGlobals());

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let sent: any[] = [];
let mode: "ok" | "timeout" = "ok";
afterEach(() => {
  mode = "ok";
});
function platform() {
  sent = [];
  vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    if (mode === "timeout") throw new Error("timeout");
    return new Response(JSON.stringify({ code: "ACCEPTED" }), { status: 202, headers: { "Content-Type": "application/json" } });
  });
}

// Charging through the Xingke cloud API (worker/xingke.ts): the device's answers decide
// whether a charge runs, and readings only count for the charge they belong to.

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  for (const u of users) {
    db.prepare("insert into users (id, phone, email, full_name, role, created_at, pin_hash, last_sign_in_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(u.id, u.phone, u.email, u.fullName, roleToDb(u.role), now, pinHash, now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(tok(u.id)), u.id, now, new Date(Date.now() + 3_600_000).toISOString());
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, is_solar, created_at) values ('st', '${OPERATOR}', 'Bè', 6.13, 1.22, 'charging', 0, 1, '${now}');
    insert into station_status (station_id, free_slots, full_batteries, updated_at) values ('st', 2, 0, '${now}');
    insert into station_staff (station_id, user_id) values ('st', 'staff');
    insert into devices (external_id, station_id, vendor, link, outlets, vendor_ref, last_seen_at, created_at) values ('${DEV.toUpperCase()}', 'st', 'Xingke', 'vendor_cloud', 2, '${DEV}', '${now}', '${now}');
    insert into charging_points (id, station_id, label, status, device_id, outlet, last_seen_at, qr_start, created_at) values
      ('p1', 'st', 'A-1', 'free', '${DEV.toUpperCase()}', 1, '${now}', 1, '${now}'),
      ('p2', 'st', 'A-2', 'free', '${DEV.toUpperCase()}', 2, '${now}', 1, '${now}');
  `);
  const env = { DB: d1, XINGKE_API_HOST: "xk.example", XINGKE_API_TOKEN: "t", XINGKE_CALLBACK_TOKEN: "cb" } as unknown as Env;
  platform();
  return { db, env };
}

async function api<T>(env: Env, who: string, method: string, path: string, body?: unknown) {
  const res = await handleApi(new Request(`https://app.poinderecharge.com${path}`, {
    method, headers: { Authorization: `Bearer ${tok(who)}`, "Content-Type": "application/json", "X-Active-Station": /^\/api\/stations\/([\w-]+)/.exec(path)?.[1] ?? "" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }), env);
  return { status: res.status, data: (await res.json()) as T };
}
let n = 0;
async function cb(env: Env, action: string, data: object, messageId = `ev${++n}`) {
  const res = await handleXingkeCallback(new Request("https://x/api/devices/xingke", { method: "POST", headers: { Authorization: "Bearer cb", "Content-Type": "application/json" }, body: JSON.stringify({ messageId, deviceId: DEV, action, timestamp: new Date().toISOString(), data }) }), env);
  expect(res.status).toBe(200);
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const result = (env: Env, cmd: any, status: string, code: string) => cb(env, "CommandResult", { requestAction: cmd.action, status, code, result: { connectorId: cmd.data.connectorId, transactionId: cmd.data.transactionId } }, cmd.messageId);
const reading = (env: Env, outlet: number, tx: string, status: string, energy: number, reason = "None") => cb(env, "ChargingStatusNotification", { connectorId: outlet, transactionId: tx, status, reason, power: 150, energy });
const selfStart = (env: Env, p: string, who = "kofi") => api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/points/${p}/start`, {});
const selfStop = (env: Env, id: string, who = "kofi") => api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/${id}/stop`, {});
const info = (env: Env, p: string, who = "ama") => api<{ state: string }>(env, who, "GET", `/api/charging/points/${p}`);
const sess = (db: { prepare(sql: string): { all(): unknown[] } }) => db.prepare("select id, user_id, status, energy_wh from charging_sessions order by started_at").all();

describe("charging through the Xingke cloud", () => {
  it("cancels a charge the device refuses to start, at no cost, and gives the reservation back", async () => {
    const { db, env } = await setup();
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, target, status, created_at, expires_at, pickup_code)
             values ('r-kofi', 'kofi', 'st', 'slot', 'charging_point', 'p1', 'active', '${now}', '${later}', '4321')`);
    expect((await selfStart(env, "p1")).status).toBe(200);
    expect(db.prepare("select status from reservations").get()).toEqual({ status: "completed" });
    await result(env, sent[0], "Failed", "DEVICE_REJECTED");
    expect(sess(db)).toMatchObject([{ user_id: "kofi", status: "cancelled", energy_wh: 0 }]);
    expect(db.prepare("select status, charging_point_id from reservations").get()).toEqual({ status: "active", charging_point_id: null });
    // The outlet is free again and Kofi can charge.
    db.exec("delete from reservations");
    expect((await info(env, "p1")).data.state).toBe("free");
    expect((await selfStart(env, "p1")).status).toBe(200);
  });

  it("lets a charge run on when the device does not carry out the stop, so it can be stopped again", async () => {
    const { db, env } = await setup();
    const s = await selfStart(env, "p1");
    await result(env, sent[0], "Succeeded", "OK");
    const tx = sent[0].data.transactionId;
    await reading(env, 1, tx, "Charging", 0.5);
    expect((await selfStop(env, s.data.id)).data).toMatchObject({ status: "stopped", amountXof: 100 });
    await result(env, sent[1], "Failed", "DEVICE_FAULT");
    expect(sess(db)).toMatchObject([{ status: "charging", energy_wh: 500 }]);
    await reading(env, 1, tx, "Charging", 3.0);
    // The second stop is sent to the device again.
    expect((await selfStop(env, s.data.id)).data).toMatchObject({ status: "stopped", energyWh: 3000, amountXof: 450 });
    expect(sent).toHaveLength(3);
    expect(sent[2]).toMatchObject({ action: "RemoteStopTransaction", data: { transactionId: tx } });
  });

  it("does not reopen a stopped charge the device already ended", async () => {
    const { db, env } = await setup();
    const s = await selfStart(env, "p1");
    await result(env, sent[0], "Succeeded", "OK");
    const tx = sent[0].data.transactionId;
    await reading(env, 1, tx, "Charging", 0.5);
    await selfStop(env, s.data.id);
    await reading(env, 1, tx, "Stopped", 0.6, "Completed");
    await result(env, sent[1], "Failed", "DEVICE_REJECTED");
    expect(sess(db)).toMatchObject([{ status: "stopped", energy_wh: 600 }]);
  });

  it("keeps the charge open when the start's delivery is uncertain, and lets the device decide", async () => {
    const { db, env } = await setup();
    mode = "timeout";
    const s = await selfStart(env, "p1");
    mode = "ok";
    expect(s.data).toMatchObject({ status: "charging" });
    expect(db.prepare("select status from device_commands").get()).toEqual({ status: "sent" });
    // The device did start: its energy is billed to the charge.
    await result(env, sent[0], "Succeeded", "OK");
    await reading(env, 1, sent[0].data.transactionId, "Charging", 2.0);
    expect(sess(db)).toMatchObject([{ status: "charging", energy_wh: 2000 }]);
    expect((await info(env, "p1")).data.state).toBe("busy");
  });

  it("keeps a stopped, unpaid charge apart from the next customer's on the same outlet", async () => {
    const { db, env } = await setup();
    const k = await selfStart(env, "p1");
    await result(env, sent[0], "Succeeded", "OK");
    await reading(env, 1, sent[0].data.transactionId, "Charging", 1.0);
    await selfStop(env, k.data.id);
    await result(env, sent[1], "Succeeded", "OK");
    expect((await selfStart(env, "p1", "ama")).status).toBe(200);
    await result(env, sent[2], "Succeeded", "OK");
    await reading(env, 1, sent[2].data.transactionId, "Charging", 2.0);
    expect(sess(db)).toMatchObject([
      { user_id: "kofi", status: "stopped", energy_wh: 1000 },
      { user_id: "ama", status: "charging", energy_wh: 2000 },
    ]);
  });

  it("ignores readings of another charge", async () => {
    const { db, env } = await setup();
    await selfStart(env, "p1");
    await result(env, sent[0], "Succeeded", "OK");
    await reading(env, 1, "99999999999999999999", "Charging", 4.0);
    expect(sess(db)).toMatchObject([{ status: "charging", energy_wh: 0 }]);
    await reading(env, 1, sent[0].data.transactionId, "Charging", 0.3);
    expect(sess(db)).toMatchObject([{ status: "charging", energy_wh: 300 }]);
  });

  it("does not hold a charge that took no energy against the customer", async () => {
    const { db, env } = await setup();
    const k = await selfStart(env, "p1");
    await result(env, sent[0], "Succeeded", "OK");
    expect((await selfStop(env, k.data.id)).data).toMatchObject({ status: "stopped", amountXof: 0 });
    await result(env, sent[1], "Succeeded", "OK");
    expect((await selfStart(env, "p2")).status).toBe(200);
    expect(sess(db)).toMatchObject([{ status: "cancelled", energy_wh: 0 }, { status: "charging" }]);
  });

  it("keeps the charge running when the stop cannot be sent", async () => {
    const { db, env } = await setup();
    const k = await selfStart(env, "p1");
    await result(env, sent[0], "Succeeded", "OK");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "DEVICE_OFFLINE" }), { status: 409 }));
    expect((await selfStop(env, k.data.id)).data.error).toBe("device_offline");
    expect(sess(db)).toMatchObject([{ status: "charging" }]);
  });
});
