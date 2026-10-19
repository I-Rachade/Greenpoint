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
    -- QR charges are paid in advance from Green Credit (0047).
    update stations set green_credit = 1 where id = 'st';
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 5000, '${now}', '${now}'), ('ama', 5000, '${now}', '${now}');
    insert into devices (external_id, station_id, vendor, link, outlets, vendor_ref, last_seen_at, qr_token, created_at) values ('${DEV.toUpperCase()}', 'st', 'Xingke', 'vendor_cloud', 2, '${DEV}', '${now}', '${BOX}', '${now}');
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
// The box's one QR code (devices.qr_token); the customer picks the outlet.
const BOX = "0123456789abcdef0123456789abcdef";
const selfStart = (env: Env, p: string, who = "kofi") => api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/outlets/${BOX}/start`, { pointId: p, pin: "2580" });
const selfStop = (env: Env, id: string, who = "kofi") => api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/${id}/stop`, {});
const info = async (env: Env, p: string, who = "ama") => {
  const { data } = await api<{ outlets: { pointId: string; state: string }[] }>(env, who, "GET", `/api/charging/outlets/${BOX}`);
  return { data: data.outlets.find((o) => o.pointId === p)! };
};
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

// Cards on Xingke sockets (worker/xingke.ts cardFollowUp): the same cards as at OCPP charge
// points, linked to an account and paying with its Green Credit.
const CARD = "3105713408";
async function cardSetup(balance = 5000) {
  const s = await setup();
  s.db.exec(`insert into charge_cards (id_tag, user_id, created_at) values ('${CARD}', 'kofi', '${new Date().toISOString()}');
             update wallets set balance_xof = ${balance} where user_id = 'kofi';`);
  return s;
}
/** `connectorId` null: held to the device, not an outlet. */
async function swipe(env: Env, intent: string, idTag = CARD, connectorId: number | null = 1, expiresInMs = 30_000) {
  const messageId = `card${++n}`;
  await cb(env, "CardPresented", { ...(connectorId ? { connectorId } : {}), idTag, intent, expiresAt: new Date(Date.now() + expiresInMs).toISOString() }, messageId);
  return messageId;
}
const answered = (env: Env, messageId: string, status: string) =>
  cb(env, "CommandResult", { requestAction: "AuthorizeResponse", status, code: status.toUpperCase(), result: { connectorId: 1 } }, messageId);

describe("card charging through the Xingke cloud", () => {
  it("answers a balance inquiry with the account's Green Credit, in hundredths, and starts nothing", async () => {
    const { db, env } = await cardSetup();
    const id = await swipe(env, "BalanceInquiry");
    expect(sent).toEqual([{ messageId: id, action: "AuthorizeResponse", data: { connectorId: 1, idTag: CARD, status: "Accepted", cardType: "Balance", balance: 500_000 } }]);
    await answered(env, id, "Sent");
    expect(sent).toHaveLength(1);
    expect(sess(db)).toEqual([]);
    // A card nobody linked yet is refused, and kept so an admin can link it.
    const other = await swipe(env, "BalanceInquiry", "0000000042");
    expect(sent[1]).toEqual({ messageId: other, action: "AuthorizeResponse", data: { connectorId: 1, idTag: "0000000042", status: "Invalid" } });
    expect(db.prepare("select count(*) as n from charge_cards").get()).toEqual({ n: 2 });
    // Held to the device, not an outlet (API 1.2): the answer names no outlet either.
    const device = await swipe(env, "BalanceInquiry", CARD, null);
    expect(sent[2]).toEqual({ messageId: device, action: "AuthorizeResponse", data: { idTag: CARD, status: "Accepted", cardType: "Balance", balance: 500_000 } });
    await cb(env, "CommandResult", { requestAction: "AuthorizeResponse", status: "Unknown", code: "DELIVERY_UNCERTAIN", result: {} }, device);
    expect(sent).toHaveLength(3);
    expect(sess(db)).toEqual([]);
  });

  it("starts the outlet once the device got the answer, stops when the credit is used up and pays from it", async () => {
    const { db, env } = await cardSetup(300);
    const id = await swipe(env, "StartCharging");
    expect(sent[0].data).toMatchObject({ status: "Accepted", balance: 30_000 });
    expect(sess(db)).toMatchObject([{ user_id: "kofi", status: "charging" }]);
    expect(sent).toHaveLength(1);
    // What the platform reports for every card answer today (no receipt from the device).
    await answered(env, id, "Unknown");
    expect(sent[1]).toMatchObject({ action: "RemoteStartTransaction", data: { connectorId: 1, startSource: "Card", chargingMode: "AutoStop" } });
    const tx = sent[1].data.transactionId;
    expect(db.prepare("select order_no, charge_card, credit_limit_xof from charging_sessions").get()).toEqual({ order_no: tx, charge_card: CARD, credit_limit_xof: 300 });
    await result(env, sent[1], "Succeeded", "OK");
    await reading(env, 1, tx, "Charging", 1.0);
    expect(sent).toHaveLength(2);
    // 2 kWh at 150 FCFA use up the 300.
    await reading(env, 1, tx, "Charging", 2.0);
    expect(sent[2]).toMatchObject({ action: "RemoteStopTransaction", data: { connectorId: 1, transactionId: tx } });
    await result(env, sent[2], "Succeeded", "OK");
    await reading(env, 1, tx, "Stopped", 2.0, "Completed");
    db.exec(`update charging_sessions set stopped_at = '${new Date(Date.now() - 120_000).toISOString()}'`);
    await cb(env, "StatusNotification", { connectors: [{ connectorId: 1, status: "Available" }] });
    expect(db.prepare("select status, energy_wh, amount_xof, payment_method from charging_sessions").get()).toEqual({ status: "paid", energy_wh: 2000, amount_xof: 300, payment_method: "wallet" });
    expect(db.prepare("select balance_xof from wallets where user_id = 'kofi'").get()).toEqual({ balance_xof: 0 });
  });

  it("refuses a second start while the card charges, and a card without enough credit", async () => {
    const { db, env } = await cardSetup();
    await answered(env, await swipe(env, "StartCharging"), "Sent");
    await swipe(env, "StartCharging", CARD, 2);
    expect(sent[2]).toMatchObject({ action: "AuthorizeResponse", data: { connectorId: 2, status: "Invalid" } });
    expect(sess(db)).toHaveLength(1);
    db.exec("update charging_sessions set status = 'cancelled'; update wallets set balance_xof = 4 where user_id = 'kofi'");
    await swipe(env, "StartCharging");
    expect(sent[3].data).toEqual({ connectorId: 1, idTag: CARD, status: "Invalid" });
  });

  it("acknowledges the card event before answering the card", async () => {
    const { db, env } = await cardSetup();
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      await held;
      sent.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ code: "ACCEPTED" }), { status: 202 });
    });
    const later: Promise<unknown>[] = [];
    const body = { messageId: "slow1", deviceId: DEV, action: "CardPresented", timestamp: new Date().toISOString(),
      data: { idTag: CARD, intent: "BalanceInquiry", expiresAt: new Date(Date.now() + 30_000).toISOString() } };
    const res = await handleXingkeCallback(new Request("https://x/api/devices/xingke", { method: "POST", headers: { Authorization: "Bearer cb" }, body: JSON.stringify(body) }), env, (w) => later.push(w));
    expect(await res.json()).toEqual({ code: "OK" });
    expect(sent).toEqual([]);
    release();
    await Promise.all(later);
    expect(sent[0]).toMatchObject({ messageId: "slow1", data: { status: "Accepted" } });
    expect(JSON.parse(String((db.prepare("select payload from device_messages order by id desc limit 1").get() as { payload: string }).payload))).toMatchObject({ result: { ok: true } });
  });

  it("keeps an expired card event without answering it", async () => {
    const { db, env } = await cardSetup();
    await swipe(env, "StartCharging", CARD, 1, -1_000);
    expect(sent).toEqual([]);
    expect(sess(db)).toEqual([]);
  });

  it("starts the outlet itself when the platform has not confirmed card authorization for the device", async () => {
    const { db, env } = await cardSetup();
    // Start refused as well: cancelled at no cost.
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "PROFILE_UNCONFIRMED" }), { status: 422 }));
    await swipe(env, "StartCharging");
    expect(sess(db)).toMatchObject([{ status: "cancelled" }]);

    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push(body);
      if (body.action === "AuthorizeResponse") return new Response(JSON.stringify({ code: "PROFILE_UNCONFIRMED" }), { status: 422 });
      return new Response(JSON.stringify({ code: "ACCEPTED" }), { status: 202 });
    });
    await swipe(env, "StartCharging");
    expect(sent.map((m) => m.action)).toEqual(["AuthorizeResponse", "RemoteStartTransaction"]);
    expect(sent[1]).toMatchObject({ data: { connectorId: 1, startSource: "Card" } });
    expect(sess(db)[1]).toMatchObject({ status: "charging" });
  });

  it("cancels the card charge at no cost when the answer fails, the start is refused, or no result comes", async () => {
    const { db, env } = await cardSetup();
    await answered(env, await swipe(env, "StartCharging"), "Failed");
    expect(sess(db)).toMatchObject([{ status: "cancelled" }]);

    // The platform has not enabled card starts for this model.
    const id = await swipe(env, "StartCharging");
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ code: "PROFILE_UNCONFIRMED" }), { status: 422 }));
    await answered(env, id, "Sent");
    expect(sess(db)).toMatchObject([{ status: "cancelled" }, { status: "cancelled" }]);
    expect(db.prepare("select status, result from device_commands").get()).toEqual({ status: "failed", result: "PROFILE_UNCONFIRMED" });

    // No result for the answer at all.
    platform();
    await swipe(env, "StartCharging");
    expect(sess(db)[2]).toMatchObject({ status: "charging" });
    db.exec(`update charging_sessions set started_at = '${new Date(Date.now() - 180_000).toISOString()}' where status = 'charging'`);
    await cb(env, "StatusNotification", { connectors: [{ connectorId: 1, status: "Available" }] });
    expect(sess(db)[2]).toMatchObject({ status: "cancelled" });
  });
});
