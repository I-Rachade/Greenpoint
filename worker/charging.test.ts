import { beforeAll, describe, expect, it } from "vitest";
import { chargePrice, customerCode, type ChargeSession, type StationCharging } from "../src/lib/charging";
import type { Profile } from "../src/lib/types";
import { hashPin } from "./auth";
import { payWithMobile, payWithWallet, myCharges, saveChargeTariff } from "./charging";
import { ingest } from "./devices";
import type { Env } from "./env";
import { ApiError } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";
import { handleApi } from "./api";
import { sha256 } from "./http";
import { refreshPayment } from "./payments";

// Charging at a socket run by station staff: start, live readings, stop, cash or app payment.
// Uses a Xingke text-line socket (6-digit id), whose commands are only queued, so no network.

const OPERATOR = "00000000-0000-4000-8000-000000000001"; // poinderecharge itself (is_own), from 0001_init.sql
const PIN = "2580";
const STAFF: Profile = { id: "staff", phone: "+22890000002", email: null, fullName: "Afi", role: "operator" };
const KOFI: Profile = { id: "kofi", phone: "+22896123456", email: null, fullName: "Kofi Mensah", role: "customer" };
const ADMIN: Profile = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" };
const TOKENS: Record<string, string> = { staff: "staff-session-token-0123456789", kofi: "kofi-session-token-0123456789", admin: "admin-session-token-0123456789" };

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  for (const u of [STAFF, KOFI, ADMIN]) {
    db.prepare("insert into users (id, phone, email, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?, ?)").run(
      u.id,
      u.phone,
      u.email,
      u.fullName,
      roleToDb(u.role),
      now,
      pinHash,
    );
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(TOKENS[u.id]),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('partner', 'Partenaire', 0, '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, is_solar, created_at) values
      ('st', '${OPERATOR}', 'Bè', 6.13, 1.22, 'charging', 0, 1, '${now}'),
      ('other', 'partner', 'Partenaire', 6.14, 1.23, 'charging', 0, 0, '${now}');
    insert into station_status (station_id, free_slots, full_batteries, updated_at) values ('st', 2, 0, '${now}'), ('other', 1, 0, '${now}');
    insert into station_staff (station_id, user_id) values ('st', 'staff'), ('other', 'staff');
    insert into devices (external_id, station_id, vendor, link, outlets, last_seen_at, created_at) values
      ('123456', 'st', 'Xingke', 'own_server', 2, '${now}', '${now}'),
      ('654321', 'other', 'Xingke', 'own_server', 1, '${now}', '${now}');
    insert into charging_points (id, station_id, label, status, device_id, outlet, last_seen_at, created_at) values
      ('p1', 'st', '3456-1', 'free', '123456', 1, '${now}', '${now}'),
      ('p2', 'st', '3456-2', 'free', '123456', 2, '${now}', '${now}'),
      ('q1', 'other', '4321-1', 'free', '654321', 1, '${now}', '${now}');
  `);
  const env = { DB: d1 } as unknown as Env;
  return { db, env };
}

async function api<T>(env: Env, who: string, method: string, path: string, body?: unknown): Promise<{ status: number; data: T }> {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { Authorization: `Bearer ${TOKENS[who]}`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, data: (await res.json()) as T };
}

const start = (env: Env, body: unknown, who = "staff", station = "st") => api<ChargeSession & { error?: string }>(env, who, "POST", `/api/stations/${station}/charging`, body);
const act = (env: Env, id: string, action: "stop" | "cancel" | "pay", station = "st") =>
  api<ChargeSession & { error?: string }>(env, "staff", "POST", `/api/stations/${station}/charging/${id}/${action}`);
const read = (env: Env, outlets: object[], device = "123456") => ingest(env.DB)(device, outlets as never, {});

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    return err instanceof ApiError ? err.code : String(err);
  }
}

function walletReq(body: unknown) {
  return new Request("https://app.poinderecharge.com/api/charging/x/pay/wallet", { method: "POST", body: JSON.stringify(body) });
}

describe("chargePrice", () => {
  it("is kWh times the price, rounded up to 5 FCFA, at least the minimum, nothing without energy", () => {
    const t = { kwhXof: 150, minXof: 100 };
    expect(chargePrice(0, t)).toBe(0);
    expect(chargePrice(100, t)).toBe(100); // 15 FCFA → minimum
    expect(chargePrice(700, t)).toBe(105);
    expect(chargePrice(1234, t)).toBe(190); // 185.1 → 190
  });
});

describe("a charge at the counter", () => {
  it("runs from start to cash payment, with live values, greenpoints and today's takings", async () => {
    const { db, env } = await setup();
    // Kofi shows his QR code; staff start outlet 1.
    const started = await start(env, { pointId: "p1", contact: customerCode(KOFI.phone!) });
    expect(started.status).toBe(200);
    expect(started.data).toMatchObject({ status: "charging", customer: "Kofi M.", pointLabel: "3456-1", energyWh: 0, amountXof: 0, tariff: { kwhXof: 150, minXof: 100 } });
    const command = db.prepare("select kind, outlet, status from device_commands").get();
    expect(command).toMatchObject({ kind: "start", outlet: 1, status: "pending" });

    // The same outlet cannot start twice; customers cannot start at all.
    expect((await start(env, { pointId: "p1" })).data.error).toBe("charge_busy");
    expect((await start(env, { pointId: "p2" }, "kofi")).status).toBe(403);

    // The socket reports: power and energy add up.
    await read(env, [{ outlet: 1, status: "charging", power_watts: 180, energy_wh: 200 }]);
    await read(env, [{ outlet: 1, status: "charging", power_watts: 175, energy_wh: 700 }]);
    const live = await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging");
    expect(live.data.open).toHaveLength(1);
    expect(live.data.open[0]).toMatchObject({ powerWatts: 175, energyWh: 700, amountXof: 105 });
    // Kofi sees the same charge in the app.
    expect((await myCharges(env, KOFI))[0]).toMatchObject({ status: "charging", energyWh: 700, amountXof: 105 });

    // Paying before the stop is refused.
    expect((await act(env, started.data.id, "pay")).data.error).toBe("charge_wrong_status");
    const stopped = await act(env, started.data.id, "stop");
    expect(stopped.data).toMatchObject({ status: "stopped", amountXof: 105, powerWatts: 0, endedByDevice: false });
    expect(db.prepare("select count(*) as n from device_commands where kind = 'stop'").get()).toEqual({ n: 1 });
    // A last reading after the stop still counts.
    await read(env, [{ outlet: 1, status: "free", energy_wh: 750 }]);

    const paid = await act(env, started.data.id, "pay");
    expect(paid.data).toMatchObject({ status: "paid", paymentMethod: "cash", energyWh: 750, amountXof: 115, greenpoints: 7 });
    // Paid twice is still one payment and one ledger row.
    expect((await act(env, started.data.id, "pay")).data.status).toBe("paid");
    expect(db.prepare("select count(*) as n, sum(points) as p from greenpoint_ledger where charging_session_id is not null").get()).toEqual({ n: 1, p: 7 });
    // Readings after the payment change nothing.
    await read(env, [{ outlet: 1, status: "free", energy_wh: 900 }]);
    const after = await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging");
    expect(after.data.open).toHaveLength(0);
    expect(after.data.today[0]).toMatchObject({ status: "paid", amountXof: 115, energyWh: 750 });
    expect(after.data.takings).toEqual({ cashXof: 115, appXof: 0, count: 1 });
    expect((await myCharges(env, KOFI))[0]).toMatchObject({ status: "paid", paymentMethod: "cash", greenpoints: 7 });
  });

  it("ends by itself when the socket reports the battery full, and a cash customer earns nothing", async () => {
    const { db, env } = await setup();
    const { data } = await start(env, { pointId: "p2" });
    expect(data.customer).toBeNull();
    // "free" before the outlet ever drew power does not end it (the socket has not switched yet).
    await read(env, [{ outlet: 2, status: "free" }]);
    expect((await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging")).data.open[0].status).toBe("charging");
    await read(env, [{ outlet: 2, status: "charging", power_watts: 200, energy_wh: 1000 }]);
    await read(env, [{ outlet: 2, status: "done", energy_wh: 1500 }]);
    const open = (await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging")).data.open[0];
    expect(open).toMatchObject({ status: "stopped", endedByDevice: true, energyWh: 1500, amountXof: 225 });
    expect((await act(env, data.id, "pay")).data).toMatchObject({ status: "paid", greenpoints: 0 });
    expect(db.prepare("select count(*) as n from greenpoint_ledger").get()).toEqual({ n: 0 });
  });

  it("closes a charge without energy instead of taking money", async () => {
    const { env } = await setup();
    const { data } = await start(env, { pointId: "p1" });
    await act(env, data.id, "stop");
    expect((await act(env, data.id, "pay")).data.error).toBe("charge_wrong_status");
    expect((await act(env, data.id, "cancel")).data.status).toBe("cancelled");
  });

  it("refuses offline outlets, unknown customers and other stations' staff", async () => {
    const { db, env } = await setup();
    db.exec("update charging_points set last_seen_at = '2020-01-01T00:00:00.000Z' where id = 'p2'");
    expect((await start(env, { pointId: "p2" })).data.error).toBe("device_offline");
    expect((await start(env, { pointId: "p1", contact: "+22899999999" })).data.error).toBe("recipient_not_found");
    expect((await start(env, { pointId: "q1" })).data.error).toBe("not_found"); // outlet of another station
    db.exec("delete from station_staff where station_id = 'st'");
    expect((await start(env, { pointId: "p1" })).status).toBe(403);
  });

  it("uses the station's own price, copied at the start", async () => {
    const { env } = await setup();
    await saveChargeTariff(env, ADMIN, new Request("https://x", { method: "POST", body: JSON.stringify({ stationId: "st", kwhXof: 200, minXof: 50 }) }));
    const { data } = await start(env, { pointId: "p1" });
    expect(data.tariff).toEqual({ kwhXof: 200, minXof: 50 });
    await saveChargeTariff(env, ADMIN, new Request("https://x", { method: "POST", body: JSON.stringify({ stationId: "st", kwhXof: 300, minXof: 50 }) }));
    await read(env, [{ outlet: 1, status: "charging", energy_wh: 1000 }]);
    expect((await act(env, data.id, "stop")).data.amountXof).toBe(200);
    expect(await code(saveChargeTariff(env, ADMIN, new Request("https://x", { method: "POST", body: JSON.stringify({ kwhXof: 152, minXof: 0 }) })))).toBe("bad_request");
  });
});

describe("paying in the app", () => {
  async function stoppedCharge(env: Env, energyWh = 1000, point = "p1", station = "st") {
    const device = point === "q1" ? "654321" : "123456";
    const outlet = point === "p2" ? 2 : 1;
    const { data } = await start(env, { pointId: point, contact: KOFI.phone }, "staff", station);
    await read(env, [{ outlet, status: "charging", energy_wh: energyWh }], device);
    await act(env, data.id, "stop", station);
    return data.id;
  }

  it("takes the price from the wallet once, with the PIN", async () => {
    const { db, env } = await setup();
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 1000, 'x', 'x')`);
    const id = await stoppedCharge(env);
    const [view] = await myCharges(env, KOFI);
    expect(view.payOptions).toEqual({ wallet: true, mobile: false }); // the simulated Flooz/T-Money provider is never offered

    expect(await code(payWithWallet(env, KOFI, id, walletReq({ pin: "1111", idempotencyKey: "key-00000001" })))).toBe("invalid_pin");
    const paid = await payWithWallet(env, KOFI, id, walletReq({ pin: PIN, idempotencyKey: "key-00000001" }));
    expect(paid).toMatchObject({ status: "paid", paymentMethod: "wallet", amountXof: 150 });
    expect(await payWithWallet(env, KOFI, id, walletReq({ pin: PIN, idempotencyKey: "key-00000002" }))).toMatchObject({ status: "paid" });
    expect(db.prepare("select balance_xof from wallets where user_id = 'kofi'").get()).toEqual({ balance_xof: 850 });
    expect(db.prepare("select type, attribute, amount_xof, counterparty_label from wallet_transactions").all()).toEqual([
      { type: "charge", attribute: "send", amount_xof: 150, counterparty_label: "Bè" },
    ]);
    // Staff see it as paid in the app.
    expect((await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging")).data.takings).toEqual({ cashXof: 0, appXof: 150, count: 1 });
  });

  it("leaves the charge unpaid when the balance is too low", async () => {
    const { db, env } = await setup();
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 100, 'x', 'x')`);
    const id = await stoppedCharge(env);
    expect(await code(payWithWallet(env, KOFI, id, walletReq({ pin: PIN, idempotencyKey: "key-00000001" })))).toBe("insufficient_balance");
    expect((await myCharges(env, KOFI))[0].status).toBe("stopped");
    expect(db.prepare("select balance_xof from wallets where user_id = 'kofi'").get()).toEqual({ balance_xof: 100 });
  });

  it("is not offered at a partner's station, where only cash is taken", async () => {
    const { db, env } = await setup();
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 1000, 'x', 'x')`);
    const id = await stoppedCharge(env, 1000, "q1", "other");
    expect((await myCharges(env, KOFI))[0].payOptions).toEqual({ wallet: false, mobile: false });
    expect(await code(payWithWallet(env, KOFI, id, walletReq({ pin: PIN, idempotencyKey: "key-00000001" })))).toBe("payment_not_offered");
  });

  it("marks the charge paid once Flooz/T-Money confirms", async () => {
    const { db, env } = await setup();
    // Admins may test against the simulated provider; make the admin the customer.
    const { data } = await start(env, { pointId: "p1", contact: ADMIN.phone });
    await read(env, [{ outlet: 1, status: "charging", energy_wh: 2000 }]);
    await act(env, data.id, "stop");
    const payment = await payWithMobile(env, ADMIN, data.id, new Request("https://x", { method: "POST", body: JSON.stringify({ network: "tmoney", phone: "+22890123456" }) }));
    expect(payment).toMatchObject({ amountXof: 300, status: "pending" });
    expect((await myCharges(env, ADMIN))[0]).toMatchObject({ status: "stopped", pendingPaymentId: payment.id });
    await refreshPayment(env, ADMIN, payment.id);
    expect((await myCharges(env, ADMIN))[0]).toMatchObject({ status: "paid", paymentMethod: "tmoney", amountXof: 300 });
    expect(db.prepare("select status from payments").get()).toEqual({ status: "succeeded" });
  });
});
