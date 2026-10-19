import { beforeAll, describe, expect, it } from "vitest";
import { chargePrice, customerCode, type ChargeSession, type StationCharging } from "../src/lib/charging";
import type { Profile } from "../src/lib/types";
import { hashPin } from "./auth";
import { creditFollowUp, payCash, payWithMobile, payWithWallet, myCharges, saveChargeTariff, settlePrepaidCharges, stopCharge } from "./charging";
import { deleteDevice, ingest } from "./devices";
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

const BOX_ST = "0123456789abcdef0123456789abcdef";
const BOX_OTHER = "fedcba9876543210fedcba9876543210";

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  for (const u of [STAFF, KOFI, ADMIN]) {
    // Signed into the app once: charges earn greenpoints (hasApp in greenpoint.ts).
    db.prepare("insert into users (id, phone, email, full_name, role, created_at, pin_hash, last_sign_in_at) values (?, ?, ?, ?, ?, ?, ?, ?)").run(
      u.id,
      u.phone,
      u.email,
      u.fullName,
      roleToDb(u.role),
      now,
      pinHash,
      now,
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
    insert into station_staff (station_id, user_id) values ('st', 'staff');
    update stations set green_credit = 1, phone = '+22822000001' where id = 'st';
    insert into devices (external_id, station_id, vendor, link, outlets, last_seen_at, qr_token, created_at) values
      ('123456', 'st', 'Xingke', 'own_server', 2, '${now}', '${BOX_ST}', '${now}'),
      ('654321', 'other', 'Xingke', 'own_server', 1, '${now}', '${BOX_OTHER}', '${now}');
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
      // The station the person works at now (R7): the one the path names.
      headers: { Authorization: `Bearer ${TOKENS[who]}`, "Content-Type": "application/json", "X-Active-Station": /^\/api\/stations\/([\w-]+)/.exec(path)?.[1] ?? "" },
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

/** Green Credit on the customer's account (0047), so QR charges can start. */
function fund(db: { exec(sql: string): void }, user = "kofi", balance = 1000) {
  db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('${user}', ${balance}, 'x', 'x')`);
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

  it("refuses a new charge where the station is locked for motorbike outlets (R8)", async () => {
    const { db, env } = await setup();
    db.exec("update station_services set unlocked = 0 where station_id = 'st' and service = 'charging'");
    expect((await start(env, { pointId: "p1" })).data.error).toBe("service_not_offered");
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

  it("writes one audit row when staff tap stop or cash twice at once", async () => {
    const { db, env } = await setup();
    const { data } = await start(env, { pointId: "p1" });
    await read(env, [{ outlet: 1, status: "charging", energy_wh: 1000 }]);
    const audits = (status: string) =>
      db.prepare("select count(*) as n from audit_log where table_name = 'charging_sessions' and changes like ?").get(`%"${status}"]%`);
    // The staff check waits for both taps, so both read the charge before either one changes it.
    function bothTaps() {
      let release = () => {};
      const ready = new Promise<void>((resolve) => (release = resolve));
      let waiting = 0;
      return async () => {
        if (++waiting === 2) release();
        await ready;
        return true;
      };
    }
    const stopCheck = bothTaps();
    const stops = await Promise.all([1, 2].map(() => stopCharge(env, STAFF, stopCheck, "st", data.id)));
    expect(stops.map((c) => c.status)).toEqual(["stopped", "stopped"]);
    expect(audits("stopped")).toEqual({ n: 1 });
    const payCheck = bothTaps();
    const pays = await Promise.all([1, 2].map(() => code(payCash(env, STAFF, payCheck, "st", data.id))));
    expect(pays.sort()).toEqual(["charge_wrong_status", "ok"]);
    expect(audits("paid")).toEqual({ n: 1 });
    expect(db.prepare("select status, payment_method from charging_sessions where id = ?").get(data.id)).toEqual({ status: "paid", payment_method: "cash" });
  });

  it("keeps a socket that is charging from being deleted", async () => {
    const { db, env } = await setup();
    const { data } = await start(env, { pointId: "p2" });
    expect(await code(deleteDevice(env.DB, "123456", ADMIN.id))).toBe("charge_busy");
    expect(db.prepare("select count(*) as n from charging_points where device_id = '123456'").get()).toEqual({ n: 2 });
    // Once the charge is stopped (paid later at the counter) the socket can go.
    await act(env, data.id, "stop");
    expect(await code(deleteDevice(env.DB, "123456", ADMIN.id))).toBe("ok");
    expect(db.prepare("select count(*) as n from devices where external_id = '123456'").get()).toEqual({ n: 0 });
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

  it("is offered for our socket at a partner's station: the money follows the socket (0039)", async () => {
    const { db, env } = await setup();
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 1000, 'x', 'x')`);
    // Staff work at one station (W2): this one now. Green Credit pays there once designated.
    db.exec("update station_staff set station_id = 'other' where user_id = 'staff'; update stations set green_credit = 1 where id = 'other'");
    await stoppedCharge(env, 1000, "q1", "other");
    expect((await myCharges(env, KOFI))[0].payOptions).toEqual({ wallet: true, mobile: false });
  });

  it("is not offered for a point partner's socket, paid at the counter only", async () => {
    const { db, env } = await setup();
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 1000, 'x', 'x')`);
    db.exec(`insert into point_partners (id, name, created_at) values ('pp', 'Solaire Togo', 'x'); update devices set partner_id = 'pp' where external_id = '123456'`);
    const id = await stoppedCharge(env);
    expect(db.prepare("select partner_id from charging_sessions where id = ?").get(id)).toEqual({ partner_id: "pp" });
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

describe("charging by QR code", () => {
  // Each box has one QR code; the customer picks the outlet on it.
  const boxOf = (point: string) => (point.startsWith("q") ? BOX_OTHER : BOX_ST);
  const info = async (env: Env, point: string, who = "kofi") => {
    const { status, data } = await api<{ stationName: string; outlets: { pointId: string; label: string; state: string }[] }>(env, who, "GET", `/api/charging/outlets/${boxOf(point)}`);
    const outlet = data.outlets.find((o) => o.pointId === point)!;
    return { status, data: { state: outlet.state, label: outlet.label, stationName: data.stationName } };
  };
  const selfStart = (env: Env, point: string, who = "kofi") =>
    api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/outlets/${boxOf(point)}/start`, { pointId: point, pin: PIN });
  const selfStop = (env: Env, id: string, who = "kofi") => api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/${id}/stop`, {});
  const allow = (env: Env, point: string, enabled: boolean, who = "admin") => api<{ ok?: boolean; error?: string }>(env, who, "POST", `/api/admin/charging-points/${point}/qr`, { enabled });

  it("is off until an admin switches it on for the outlet", async () => {
    const { db, env } = await setup();
    expect((await info(env, "p1")).data).toMatchObject({ state: "disabled", label: "3456-1", stationName: "Bè" });
    expect((await selfStart(env, "p1")).data.error).toBe("charge_qr_disabled");
    // Only admins switch it.
    expect((await allow(env, "p1", true, "staff")).status).toBe(403);
    expect((await allow(env, "p1", true)).data).toEqual({ ok: true });
    expect(db.prepare("select qr_start from charging_points where id = 'p1'").get()).toEqual({ qr_start: 1 });
    expect(db.prepare("select changes from audit_log where table_name = 'charging_points'").get()).toEqual({ changes: '{"qr_start":[false,true]}' });
    expect((await info(env, "p1")).data.state).toBe("free");
    // The other outlet stays off.
    expect((await info(env, "p2")).data.state).toBe("disabled");
    // The outlet's page is readable before signing in.
    const anonymous = await handleApi(new Request(`https://app.poinderecharge.com/api/charging/outlets/${BOX_ST}`), env);
    expect(((await anonymous.json()) as { outlets: { state: string }[] }).outlets[0]).toMatchObject({ state: "free" });
    // A per-outlet code (stickers before one code per box) no longer opens anything.
    expect((await handleApi(new Request("https://app.poinderecharge.com/api/charging/points/p1"), env)).status).toBe(404);
  });

  it("lets the customer start, follow and stop a charge without staff, paid from Green Credit", async () => {
    const { db, env } = await setup();
    fund(db);
    await allow(env, "p1", true);
    const started = await selfStart(env, "p1");
    expect(started.status).toBe(200);
    expect(started.data).toMatchObject({ status: "charging", customer: "Kofi M.", pointLabel: "3456-1", selfStarted: true });
    expect(db.prepare("select kind, outlet from device_commands").get()).toEqual({ kind: "start", outlet: 1 });
    expect(db.prepare("select started_by, user_id, credit_limit_xof from charging_sessions").get()).toEqual({ started_by: "kofi", user_id: "kofi", credit_limit_xof: 1000 });
    // Busy for everyone now, and staff see the charge too.
    expect((await info(env, "p1")).data.state).toBe("busy");
    expect((await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging")).data.open).toHaveLength(1);

    // One charge at a time.
    await allow(env, "p2", true);
    expect((await selfStart(env, "p2")).data.error).toBe("charge_unpaid");
    await read(env, [{ outlet: 1, status: "charging", power_watts: 180, energy_wh: 1000 }]);
    // Another customer cannot stop it.
    expect((await selfStop(env, started.data.id, "admin")).status).toBe(404);
    const stopped = await selfStop(env, started.data.id);
    expect(stopped.data).toMatchObject({ amountXof: 150, payOptions: { wallet: false, mobile: false } });
    expect(db.prepare("select count(*) as n from device_commands where kind = 'stop'").get()).toEqual({ n: 1 });
    // Paid in advance: never cash at the counter.
    expect((await act(env, started.data.id, "pay")).data.error).toBe("charge_wrong_status");

    // The next start takes the ended charge from the credit first.
    expect((await selfStart(env, "p2")).status).toBe(200);
    expect(db.prepare("select status, payment_method from charging_sessions where id = ?").get(started.data.id)).toEqual({ status: "paid", payment_method: "wallet" });
    expect(db.prepare("select balance_xof from wallets where user_id = 'kofi'").get()).toEqual({ balance_xof: 850 });
  });

  it("cannot stop a charge staff started", async () => {
    const { env } = await setup();
    const { data } = await start(env, { pointId: "p1", contact: KOFI.phone });
    expect(data.selfStarted).toBeUndefined();
    expect((await selfStop(env, data.id)).status).toBe(403);
  });

  it("refuses offline, busy and reserved outlets, and uses the customer's own reservation", async () => {
    const { db, env } = await setup();
    fund(db);
    fund(db, "admin");
    await allow(env, "p1", true);
    await allow(env, "p2", true);
    const later = new Date(Date.now() + 600_000).toISOString();
    const now = new Date().toISOString();
    // Someone else reserved outlet 1.
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, target, status, created_at, expires_at, pickup_code)
             values ('r-admin', 'admin', 'st', 'slot', 'charging_point', 'p1', 'active', '${now}', '${later}', '1234')`);
    expect((await info(env, "p1")).data.state).toBe("reserved");
    expect((await selfStart(env, "p1")).data.error).toBe("point_reserved");
    // Its owner may use it.
    expect((await info(env, "p1", "admin")).data.state).toBe("free");

    // Kofi's own reservation of outlet 2 is used by his charge.
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, target, status, created_at, expires_at, pickup_code)
             values ('r-kofi', 'kofi', 'st', 'slot', 'charging_point', 'p2', 'active', '${now}', '${later}', '4321')`);
    expect((await selfStart(env, "p2")).status).toBe(200);
    expect(db.prepare("select status, charging_point_id from reservations where id = 'r-kofi'").get()).toEqual({ status: "completed", charging_point_id: "p2" });
    expect((await selfStart(env, "p2", "admin")).data.error).toBe("charge_busy");

    // A socket that stopped reporting is offline.
    db.exec(`update charging_points set last_seen_at = '2020-01-01T00:00:00.000Z' where id = 'p1'`);
    expect((await info(env, "p1", "admin")).data.state).toBe("offline");
    expect((await selfStart(env, "p1", "admin")).data.error).toBe("device_offline");
  });

  it("needs the station's charging service", async () => {
    const { db, env } = await setup();
    fund(db);
    await allow(env, "p1", true);
    db.exec("update station_services set unlocked = 0 where station_id = 'st' and service = 'charging'");
    expect((await selfStart(env, "p1")).data.error).toBe("service_not_offered");
  });
});

describe("one QR code per socket box", () => {
  const BOX = BOX_ST;
  const OTHER = BOX_OTHER;
  type Box = { label: string; stationName: string; outlets: { pointId: string; label: string; outlet: number; state: string; yours?: boolean }[]; error?: string };
  const box = (env: Env, token = BOX, who = "kofi") => api<Box>(env, who, "GET", `/api/charging/outlets/${token}`);
  const startAt = (env: Env, pointId: string, token = BOX, who = "kofi") =>
    api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/outlets/${token}/start`, { pointId, pin: PIN });
  const allow = (env: Env, point: string) => api(env, "admin", "POST", `/api/admin/charging-points/${point}/qr`, { enabled: true });
  async function boxes() {
    const t = await setup();
    fund(t.db);
    fund(t.db, "admin");
    t.db.exec(`update devices set qr_token = '${BOX}' where external_id = '123456'; update devices set qr_token = '${OTHER}' where external_id = '654321';`);
    await allow(t.env, "p1");
    await allow(t.env, "p2");
    await allow(t.env, "q1");
    return t;
  }

  it("lists every outlet of the box with whether it can start, before signing in and without anyone's name", async () => {
    const { db, env } = await boxes();
    db.exec("update charging_points set qr_start = 0 where id = 'p2'");
    const anonymous = await handleApi(new Request(`https://app.poinderecharge.com/api/charging/outlets/${BOX}`), env);
    const data = (await anonymous.json()) as Box;
    expect(data).toMatchObject({ label: "3456", stationName: "Bè" });
    expect(data.outlets).toEqual([
      { pointId: "p1", label: "3456-1", outlet: 1, state: "free" },
      { pointId: "p2", label: "3456-2", outlet: 2, state: "disabled" },
    ]);
    expect(JSON.stringify(data)).not.toContain("123456");
    // Unknown or malformed tokens look the same: nothing to find.
    expect((await box(env, "ffffffffffffffffffffffffffffffff")).status).toBe(404);
    expect((await box(env, "123456")).status).toBe(404);
  });

  it("starts only the outlet picked, and only on the scanned box", async () => {
    const { db, env } = await boxes();
    // An outlet of another box, or a disabled one, cannot be started through this code.
    expect((await startAt(env, "q1")).status).toBe(404);
    db.exec("update charging_points set qr_start = 0 where id = 'p2'");
    expect((await startAt(env, "p2")).data.error).toBe("charge_qr_disabled");
    const started = await startAt(env, "p1");
    expect(started.data).toMatchObject({ status: "charging", pointLabel: "3456-1", selfStarted: true });
    expect(db.prepare("select kind, outlet from device_commands").get()).toEqual({ kind: "start", outlet: 1 });
    // In use for the next customer, who cannot pick it.
    expect((await box(env, BOX, "admin")).data.outlets[0].state).toBe("busy");
    expect((await startAt(env, "p1", BOX, "admin")).data.error).toBe("charge_busy");
  });

  it("marks outlets reserved by others, and the customer's own reservation", async () => {
    const { db, env } = await boxes();
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, target, status, created_at, expires_at, pickup_code)
             values ('r-admin', 'admin', 'st', 'slot', 'charging_point', 'p1', 'active', '${now}', '${later}', '1234')`);
    expect((await box(env)).data.outlets.map((o) => [o.state, o.yours])).toEqual([
      ["reserved", undefined],
      ["free", undefined],
    ]);
    expect((await startAt(env, "p1")).data.error).toBe("point_reserved");
    expect((await box(env, BOX, "admin")).data.outlets[0]).toMatchObject({ state: "free", yours: true });
  });

  // Two starts sent at once both pass the early "no open charge" read before either writes:
  // here that read is made to miss, as it would for the second request.
  function racing(env: Env): Env {
    const d1 = env.DB;
    const miss = { first: async () => null };
    const DB = new Proxy(d1, {
      get(target, key) {
        if (key === "prepare") {
          return (sql: string) => (/^select 1 from charging_sessions where user_id = \? and status in/.test(sql) ? { bind: () => miss } : target.prepare(sql));
        }
        const v = Reflect.get(target, key);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    return { ...env, DB } as Env;
  }

  it("starts one charge only when the customer sends two starts at once", async () => {
    const { db, env } = await boxes();
    expect((await startAt(env, "p1")).status).toBe(200);
    const second = await startAt(racing(env), "p2");
    expect(second).toMatchObject({ status: 409, data: { error: "charge_unpaid" } });
    expect(db.prepare("select count(*) as n from charging_sessions where user_id = 'kofi'").get()).toEqual({ n: 1 });
    expect(db.prepare("select count(*) as n from device_commands").get()).toEqual({ n: 1 });
  });

  it("does not use up the customer's reservation when the start is refused", async () => {
    const { db, env } = await boxes();
    expect((await startAt(env, "p1")).status).toBe(200);
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, target, status, created_at, expires_at, pickup_code)
             values ('r-kofi', 'kofi', 'st', 'slot', 'charging_point', 'p2', 'active', '${now}', '${later}', '4321')`);
    expect((await startAt(racing(env), "p2")).status).toBe(409);
    expect(db.prepare("select status from reservations where id = 'r-kofi'").get()).toEqual({ status: "active" });
  });

  it("gives new boxes a code and lets only an admin renew it, which voids the old sticker", async () => {
    const { db, env } = await boxes();
    expect((await api(env, "staff", "POST", "/api/admin/devices/123456/qr", {})).status).toBe(403);
    const renewed = await api<{ qrToken: string }>(env, "admin", "POST", "/api/admin/devices/123456/qr", {});
    expect(renewed.data.qrToken).toMatch(/^[0-9a-f]{32}$/);
    expect((await box(env)).status).toBe(404);
    expect((await box(env, renewed.data.qrToken)).data.outlets).toHaveLength(2);
    expect(db.prepare("select changes from audit_log where table_name = 'devices'").get()).toEqual({ changes: '{"qr_token":"renewed"}' });

    await api(env, "admin", "POST", "/api/admin/devices", { externalId: "a1b2c3d4e5f60708", stationId: "st", outlets: 3 });
    const fresh = db.prepare("select qr_token from devices where external_id = 'A1B2C3D4E5F60708'").get() as { qr_token: string } | undefined;
    expect(fresh?.qr_token).toMatch(/^[0-9a-f]{32}$/);
    expect(fresh?.qr_token).not.toBe(renewed.data.qrToken);
  });
});

describe("Green Credit pays QR charges (0047)", () => {
  const startAt = (env: Env, pointId: string, token = BOX_ST, pin = PIN) =>
    api<ChargeSession & { error?: string }>(env, "kofi", "POST", `/api/charging/outlets/${token}/start`, { pointId, pin });
  const allow = (env: Env, point: string) => api(env, "admin", "POST", `/api/admin/charging-points/${point}/qr`, { enabled: true });
  const box = (env: Env, token: string) => api<{ creditAccepted: boolean; balanceXof?: number; outlets: { state: string }[] }>(env, "kofi", "GET", `/api/charging/outlets/${token}`);

  it("only on our sockets at a Green Credit station", async () => {
    const { db, env } = await setup();
    fund(db);
    await allow(env, "p1");
    await allow(env, "q1");
    // The partner's station is no Green Credit station.
    expect((await box(env, BOX_OTHER)).data).toMatchObject({ creditAccepted: false, outlets: [{ state: "disabled" }] });
    expect((await startAt(env, "q1", BOX_OTHER)).data.error).toBe("credit_not_accepted");
    // A point partner's socket at a Green Credit station is paid at the counter only.
    db.exec(`insert into point_partners (id, name, created_at) values ('pp', 'Solaire Togo', 'x'); update devices set partner_id = 'pp' where external_id = '123456'`);
    expect((await box(env, BOX_ST)).data.creditAccepted).toBe(false);
    expect((await startAt(env, "p1")).data.error).toBe("credit_not_accepted");
    expect(db.prepare("select count(*) as n from charging_sessions").get()).toEqual({ n: 0 });
  });

  it("needs the PIN and a credit that covers the minimum price", async () => {
    const { db, env } = await setup();
    await allow(env, "p1");
    // No credit at all, then less than the 100 FCFA minimum.
    expect((await startAt(env, "p1")).data.error).toBe("insufficient_balance");
    fund(db, "kofi", 50);
    expect((await box(env, BOX_ST)).data).toMatchObject({ creditAccepted: true, balanceXof: 50 });
    expect((await startAt(env, "p1")).data.error).toBe("insufficient_balance");
    db.exec("update wallets set balance_xof = 1000 where user_id = 'kofi'");
    expect((await startAt(env, "p1", BOX_ST, "1111")).data.error).toBe("invalid_pin");
    expect((await startAt(env, "p1")).status).toBe(200);
  });

  it("stops at the credit and takes at most the balance when the charge ends", async () => {
    const { db, env } = await setup();
    fund(db, "kofi", 120);
    await allow(env, "p1");
    const { data } = await startAt(env, "p1");
    // 2 kWh cost 300 FCFA, more than the 120 FCFA credit: the socket is switched off.
    await read(env, [{ outlet: 1, status: "charging", energy_wh: 2000 }]);
    await creditFollowUp(env, "123456");
    expect(db.prepare("select status from charging_sessions where id = ?").get(data.id)).toEqual({ status: "stopped" });
    expect(db.prepare("select count(*) as n from device_commands where kind = 'stop'").get()).toEqual({ n: 1 });
    await settlePrepaidCharges(env.DB, { userId: "kofi" });
    await settlePrepaidCharges(env.DB, { userId: "kofi" });
    expect(db.prepare("select status, payment_method from charging_sessions where id = ?").get(data.id)).toEqual({ status: "paid", payment_method: "wallet" });
    expect(db.prepare("select balance_xof from wallets where user_id = 'kofi'").get()).toEqual({ balance_xof: 0 });
    expect(db.prepare("select type, attribute, amount_xof, balance_after_xof from wallet_transactions").all()).toEqual([
      { type: "charge", attribute: "send", amount_xof: 120, balance_after_xof: 0 },
    ]);
  });
});

describe("car chargers linked to a connected outlet (0048)", () => {
  const BOX_EV = "abcdefabcdefabcdefabcdefabcdefab";
  type Box = { tariff: { kwhXof: number; minXof: number }; outlets: { pointId: string; label: string; state: string; ev?: { name: string; connector: string; powerKw: number } }[] };
  const saveCharger = (env: Env, id: string | null, input: object) => api<{ error?: string }>(env, "admin", "POST", "/api/admin/ev-chargers", { id, input });
  const charger = { name: "Borne VE 1", connector: "type2", powerKw: 22, stationId: "st", isActive: true };
  const startAt = (env: Env, pointId: string, who = "kofi") =>
    api<ChargeSession & { error?: string }>(env, who, "POST", `/api/charging/outlets/${BOX_EV}/start`, { pointId, pin: PIN });

  /** A one-outlet box at the station (a socket like the motorbike ones, commands only queued), linked to a car charger. */
  async function linked() {
    const t = await setup();
    const now = new Date().toISOString();
    t.db.exec(`
      insert into devices (external_id, station_id, vendor, link, outlets, last_seen_at, qr_token, created_at) values ('777777', 'st', 'Xingke', 'own_server', 1, '${now}', '${BOX_EV}', '${now}');
      insert into charging_points (id, station_id, label, status, device_id, outlet, last_seen_at, qr_start, created_at) values ('e1', 'st', '7777-1', 'free', '777777', 1, '${now}', 1, '${now}');
    `);
    expect((await saveCharger(t.env, null, { ...charger, pointId: "e1" })).status).toBe(200);
    const { id } = t.db.prepare("select id from ev_chargers").get() as { id: string };
    return { ...t, evId: id };
  }

  it("links only an outlet of a connected device at the same station, and one charger per outlet", async () => {
    const { db, env, evId } = await linked();
    expect(db.prepare("select point_id from ev_chargers where id = ?").get(evId)).toEqual({ point_id: "e1" });
    // Another station's outlet, or no station at all.
    expect((await saveCharger(env, evId, { ...charger, pointId: "q1" })).status).toBe(400);
    expect((await saveCharger(env, evId, { ...charger, stationId: null, pointId: "e1" })).status).toBe(400);
    // A second charger cannot take the same outlet.
    expect((await saveCharger(env, null, { ...charger, name: "Borne VE 2", pointId: "e1" })).data.error).toBe("outlet_busy");
    // Unlinking keeps the charger, listed only.
    expect((await saveCharger(env, evId, { ...charger, pointId: null })).status).toBe(200);
    expect(db.prepare("select point_id from ev_chargers where id = ?").get(evId)).toEqual({ point_id: null });
  });

  it("shows the outlet on its charger, not among the motorbike places", async () => {
    const { env } = await linked();
    const { data } = await api<{ id: string; chargingPoints: { id: string }[]; evChargers: { name: string; point?: { id: string; status: string; qrStart?: boolean } }[] }[]>(
      env,
      "kofi",
      "GET",
      "/api/stations",
    );
    const st = data.find((s) => s.id === "st")!;
    expect(st.chargingPoints.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(st.evChargers).toEqual([expect.objectContaining({ name: "Borne VE 1", point: expect.objectContaining({ id: "e1", status: "free", qrStart: true }) })]);
  });

  it("is reserved as the car charger, never as a motorbike outlet, and only while its outlet is free", async () => {
    const { db, env, evId } = await linked();
    const reserve = (target: string) => api<{ error?: string; targetKind?: string }>(env, "kofi", "POST", "/api/reservations", { stationId: "st", kind: "charging_point", target });
    expect((await reserve("e1")).status).not.toBe(200);
    db.exec("update charging_points set status = 'charging' where id = 'e1'");
    expect((await reserve(evId)).data.error).toBe("outlet_busy");
    db.exec("update charging_points set status = 'free' where id = 'e1'");
    const ok = await reserve(evId);
    expect(ok.status).toBe(200);
    expect(ok.data.targetKind).toBe("ev");
  });

  it("starts by QR code at the car price under the charger's name, paid from Green Credit", async () => {
    const { db, env } = await linked();
    // The car minimum is 500 FCFA (DEFAULT_EV_TARIFF): 300 FCFA of credit is not enough.
    fund(db, "kofi", 300);
    const box = await api<Box>(env, "kofi", "GET", `/api/charging/outlets/${BOX_EV}`);
    expect(box.data.tariff).toEqual({ kwhXof: 200, minXof: 500 });
    expect(box.data.outlets).toEqual([expect.objectContaining({ pointId: "e1", label: "Borne VE 1", state: "free", ev: { name: "Borne VE 1", connector: "type2", powerKw: 22 } })]);
    expect((await startAt(env, "e1")).data.error).toBe("insufficient_balance");
    db.exec("update wallets set balance_xof = 5000 where user_id = 'kofi'");
    // Motorbike charging switched off at the station does not stop the car charger.
    db.exec("update station_services set unlocked = 0 where station_id = 'st' and service = 'charging'");
    const started = await startAt(env, "e1");
    expect(started.status).toBe(200);
    expect(started.data).toMatchObject({ pointLabel: "Borne VE 1", tariff: { kwhXof: 200, minXof: 500 }, creditLimitXof: 5000 });
    expect(db.prepare("select kind, outlet from device_commands").get()).toMatchObject({ kind: "start", outlet: 1 });
    // The car charger needs the "ev" service.
    db.exec("update station_services set unlocked = 0 where station_id = 'st' and service = 'ev'");
    db.exec("update charging_sessions set status = 'cancelled'");
    expect((await startAt(env, "e1")).data.error).toBe("service_not_offered");
  });

  it("lets staff start it from the customer's reservation of the charger, at the station's own car price", async () => {
    const { db, env, evId } = await linked();
    expect((await api(env, "admin", "POST", "/api/admin/charging/tariff", { ev: true, stationId: "st", kwhXof: 250, minXof: 1000 })).status).toBe(200);
    expect(db.prepare("select ev_kwh_xof, ev_min_xof from stations where id = 'st'").get()).toEqual({ ev_kwh_xof: 250, ev_min_xof: 1000 });
    const now = new Date().toISOString();
    const later = new Date(Date.now() + 600_000).toISOString();
    db.exec(`insert into reservations (id, user_id, station_id, type, kind, target, status, created_at, expires_at, pickup_code)
             values ('r-car', 'kofi', 'st', 'slot', 'charging_point', '${evId}', 'active', '${now}', '${later}', '4321')`);
    // A motorbike outlet cannot use the car charger's reservation.
    expect((await start(env, { pointId: "p1", reservationId: "r-car", pickupCode: "4321" })).status).toBe(403);
    const started = await start(env, { pointId: "e1", reservationId: "r-car", pickupCode: "4321" });
    expect(started.status).toBe(200);
    expect(started.data).toMatchObject({ pointLabel: "Borne VE 1", customer: "Kofi M.", tariff: { kwhXof: 250, minXof: 1000 } });
    expect(db.prepare("select status from reservations where id = 'r-car'").get()).toEqual({ status: "completed" });
    const view = await api<StationCharging>(env, "staff", "GET", "/api/stations/st/charging");
    expect(view.data).toMatchObject({ tariff: { kwhXof: 150, minXof: 100 }, evTariff: { kwhXof: 250, minXof: 1000 } });
  });

  it("keeps the network car price apart from the motorbike one", async () => {
    const { db, env } = await linked();
    expect((await api(env, "admin", "POST", "/api/admin/charging/tariff", { ev: true, stationId: null, kwhXof: 300, minXof: 600 })).status).toBe(200);
    expect(db.prepare("select value from app_settings where key = 'ev_tariff'").get()).toEqual({ value: '{"kwhXof":300,"minXof":600}' });
    const admin = await api<{ defaultTariff: object; evTariff: object; stations: { id: string; outlets: number; evChargers: number }[] }>(env, "admin", "GET", "/api/admin/charging");
    expect(admin.data.defaultTariff).toEqual({ kwhXof: 150, minXof: 100 });
    expect(admin.data.evTariff).toEqual({ kwhXof: 300, minXof: 600 });
    expect(admin.data.stations.find((s) => s.id === "st")).toMatchObject({ outlets: 2, evChargers: 1 });
  });
});
