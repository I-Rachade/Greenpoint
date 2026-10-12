import { afterEach, describe, expect, it, vi } from "vitest";
import type { Env } from "./env";
import {
  detectNetwork,
  mockProvider,
  paygateProvider,
  providerFromEnv,
  safeEqual,
} from "./payment-providers";
import { myPayments, paymentCallback, refreshPayment, startPayment } from "./payments";
import type { Profile } from "../src/lib/types";
import { fakeD1 } from "./test-d1";

const OWN_OPERATOR = "00000000-0000-4000-8000-000000000001";
const RIDER: Profile = { id: "rider-1", phone: "+22896123456", fullName: null, role: "rider" };
const OTHER: Profile = { id: "rider-2", phone: "+22890123456", fullName: null, role: "rider" };

function setup(settings: Partial<Env> = {}) {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 20 * 60_000).toISOString();
  db.exec(`
    insert into users (id, phone, created_at) values ('rider-1', '+22896123456', '${now}'), ('rider-2', '+22890123456', '${now}');
    insert into operators (id, name, is_own, created_at) values ('other-op', 'Autre', 0, '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at, price_battery_xof)
      values ('own', '${OWN_OPERATOR}', 'A', 6.1, 1.2, 'both', '${now}', 500),
             ('foreign', 'other-op', 'B', 6.1, 1.2, 'both', '${now}', 500);
    insert into reservations (id, user_id, station_id, type, created_at, expires_at, pickup_code)
      values ('res-battery', 'rider-1', 'own', 'battery', '${now}', '${later}', '1234'),
             ('res-foreign', 'rider-2', 'foreign', 'battery', '${now}', '${later}', '1234');
  `);
  const env = { DB: d1, PAYMENT_CALLBACK_SECRET: "callback-secret", ...settings } as unknown as Env;
  return { db, env };
}

function post(path: string, body: unknown, type = "application/json") {
  return new Request(`https://app.poinderecharge.com${path}`, {
    method: "POST",
    headers: { "Content-Type": type },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const start = (env: Env, body: unknown, user = RIDER) => startPayment(env, user, post("/api/payments", body));

afterEach(() => vi.unstubAllGlobals());

// --- Providers -------------------------------------------------------------------

describe("detectNetwork", () => {
  it("recognises T-Money (Togocom) and Flooz (Moov) prefixes", () => {
    expect(detectNetwork("+22890123456")).toBe("tmoney");
    expect(detectNetwork("+22870123456")).toBe("tmoney");
    expect(detectNetwork("+22896123456")).toBe("flooz");
    expect(detectNetwork("+22879123456")).toBe("flooz");
  });

  it("returns null for unknown prefixes and malformed numbers", () => {
    expect(detectNetwork("+22822123456")).toBeNull();
    expect(detectNetwork("90123456")).toBeNull();
    expect(detectNetwork("+33612345678")).toBeNull();
  });
});

describe("providerFromEnv", () => {
  it("simulates unless PayGate is explicitly enabled with a token", () => {
    const env = (values: Record<string, string>) => (key: string) => values[key];
    expect(providerFromEnv(env({})).name).toBe("mock");
    expect(providerFromEnv(env({ PAYMENTS_PROVIDER: "paygate" })).name).toBe("mock");
    expect(providerFromEnv(env({ PAYGATE_AUTH_TOKEN: "t" })).name).toBe("mock");
    expect(providerFromEnv(env({ PAYMENTS_PROVIDER: "paygate", PAYGATE_AUTH_TOKEN: "t" })).name).toBe("paygate");
  });
});

describe("paygateProvider", () => {
  it("sends local digits and the network name, and reads tx_reference", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ tx_reference: 12345, status: 0 }));
    const provider = paygateProvider("secret-token", fetchMock as unknown as typeof fetch);
    const result = await provider.start({
      identifier: "pdr_1",
      amountXof: 500,
      phone: "+22890123456",
      network: "tmoney",
      description: "poinderecharge",
    });
    expect(result.providerReference).toBe("12345");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://paygateglobal.com/api/v1/pay");
    expect(JSON.parse(init.body as string)).toEqual({
      auth_token: "secret-token",
      phone_number: "90123456",
      amount: 500,
      description: "poinderecharge",
      identifier: "pdr_1",
      network: "TMONEY",
    });
  });

  it("turns PayGate error codes into readable errors", async () => {
    const provider = paygateProvider("bad", (async () => jsonResponse({ status: 2 })) as unknown as typeof fetch);
    await expect(
      provider.start({ identifier: "x", amountXof: 5, phone: "+22896000001", network: "flooz", description: "d" }),
    ).rejects.toThrow("invalid_auth_token");
  });

  it("maps status codes 0/2/4/6", async () => {
    for (const [code, status] of [
      [0, "succeeded"],
      [2, "pending"],
      [4, "expired"],
      [6, "cancelled"],
    ] as const) {
      const provider = paygateProvider("t", (async () => jsonResponse({ status: code })) as unknown as typeof fetch);
      expect((await provider.fetchStatus("pdr_1")).status).toBe(status);
    }
  });

  it("rejects HTTP errors and unknown status codes", async () => {
    const down = paygateProvider("t", (async () => new Response("", { status: 500 })) as unknown as typeof fetch);
    await expect(down.fetchStatus("x")).rejects.toThrow("paygate_http_500");
    const odd = paygateProvider("t", (async () => jsonResponse({ status: 99 })) as unknown as typeof fetch);
    await expect(odd.fetchStatus("x")).rejects.toThrow("paygate_unknown_status_99");
  });

  it("the simulation declines numbers ending in 0", async () => {
    await expect(
      mockProvider().start({ identifier: "x", amountXof: 5, phone: "+22896000000", network: "flooz", description: "d" }),
    ).rejects.toThrow("mock_declined");
  });
});

describe("safeEqual", () => {
  it("compares strings of any length", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

// --- Worker routes on D1 -----------------------------------------------------------

describe("startPayment", () => {
  it("charges the station's price, not anything from the app, and logs it", async () => {
    const { db, env } = setup();
    const payment = await start(env, { reservationId: "res-battery", network: "flooz", phone: "96 12 34 56", amountXof: 5 });
    expect(payment).toMatchObject({ reservationId: "res-battery", amountXof: 500, network: "flooz", status: "pending" });
    const row = db.prepare("select * from payments").get() as Record<string, unknown>;
    expect(row).toMatchObject({ phone: "+22896123456", provider: "mock", user_id: "rider-1" });
    expect(row.provider_reference).toMatch(/^mock_pdr_/);
    expect(db.prepare("select table_name, action from audit_log").all()).toEqual([{ table_name: "payments", action: "insert" }]);
  });

  it("refuses a second open payment for the same reservation", async () => {
    const { env } = setup();
    await start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" });
    await expect(start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" })).rejects.toMatchObject({
      code: "payment_exists",
    });
  });

  it("only takes payments at own stations with a price", async () => {
    const { db, env } = setup();
    await expect(start(env, { reservationId: "res-foreign", network: "flooz", phone: "96123456" }, OTHER)).rejects.toMatchObject({
      code: "payment_not_offered",
    });
    db.exec("update stations set price_battery_xof = null where id = 'own'");
    await expect(start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" })).rejects.toMatchObject({
      code: "payment_not_offered",
    });
  });

  it("rejects other riders' and inactive reservations, bad networks and foreign numbers", async () => {
    const { db, env } = setup();
    await expect(start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" }, OTHER)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(start(env, { reservationId: "res-battery", network: "orange", phone: "96123456" })).rejects.toMatchObject({
      code: "bad_request",
    });
    await expect(start(env, { reservationId: "res-battery", network: "flooz", phone: "+33612345678" })).rejects.toMatchObject({
      code: "phone_not_allowed",
    });
    db.exec("update reservations set status = 'cancelled' where id = 'res-battery'");
    await expect(start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" })).rejects.toMatchObject({
      code: "reservation_not_active",
    });
  });

  it("marks the payment failed when the provider refuses, so the rider can try again", async () => {
    const { db, env } = setup();
    await expect(start(env, { reservationId: "res-battery", network: "flooz", phone: "96123450" })).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    expect(db.prepare("select status, failure_reason from payments").get()).toEqual({ status: "failed", failure_reason: "mock_declined" });
    const retry = await start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" });
    expect(retry.status).toBe("pending");
  });
});

describe("refreshPayment and myPayments", () => {
  it("asks the provider and only shows the rider's own payments", async () => {
    const { env } = setup();
    const payment = await start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" });
    await expect(refreshPayment(env, OTHER, payment.id)).rejects.toMatchObject({ code: "not_found" });
    const refreshed = await refreshPayment(env, RIDER, payment.id);
    expect(refreshed.status).toBe("succeeded");
    expect(refreshed.paidAt).not.toBeNull();
    expect(await myPayments(env, RIDER)).toHaveLength(1);
    expect(await myPayments(env, OTHER)).toHaveLength(0);
  });
});

describe("account deletion", () => {
  it("keeps the payment but forgets who paid and from which number", async () => {
    const { db, env } = setup();
    await start(env, { reservationId: "res-battery", network: "flooz", phone: "96123456" });
    db.exec("delete from reservations where user_id = 'rider-1'; delete from users where id = 'rider-1'");
    expect(db.prepare("select user_id, phone, reservation_id, amount_xof from payments").get()).toEqual({
      user_id: null,
      phone: null,
      reservation_id: null,
      amount_xof: 500,
    });
  });
});

describe("paymentCallback", () => {
  async function pendingPaygatePayment(statusCode: number) {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/api/v1/pay") ? jsonResponse({ status: 0, tx_reference: "777" }) : jsonResponse({ status: statusCode, tx_reference: "777" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { db, env } = setup({ PAYMENTS_PROVIDER: "paygate", PAYGATE_AUTH_TOKEN: "token" });
    const payment = await start(env, { reservationId: "res-battery", network: "tmoney", phone: "90123456" });
    const { identifier } = db.prepare("select identifier from payments").get() as { identifier: string };
    return { db, env, payment, identifier, fetchMock };
  }

  it("drops requests without the right key", async () => {
    const { env, identifier, fetchMock } = await pendingPaygatePayment(0);
    const response = await paymentCallback(env, post("/api/payments/callback?key=wrong", { identifier }));
    expect(response.status).toBe(403);
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the start
    const noSecret = { ...env, PAYMENT_CALLBACK_SECRET: undefined } as Env;
    expect((await paymentCallback(noSecret, post("/api/payments/callback?key=", { identifier }))).status).toBe(403);
  });

  it("ignores the posted status and asks the provider instead", async () => {
    const { db, env, identifier } = await pendingPaygatePayment(6);
    const body = { identifier, tx_reference: "777", status: 0, amount: 500 };
    const response = await paymentCallback(env, post("/api/payments/callback?key=callback-secret", body));
    expect(response.status).toBe(200);
    expect(db.prepare("select status from payments").get()).toEqual({ status: "cancelled" });
  });

  it("accepts form-encoded callbacks and never changes a settled payment", async () => {
    const { db, env, identifier, fetchMock } = await pendingPaygatePayment(0);
    const form = `identifier=${identifier}&tx_reference=777`;
    await paymentCallback(env, post("/api/payments/callback?key=callback-secret", form, "application/x-www-form-urlencoded"));
    expect(db.prepare("select status, provider_reference from payments").get()).toEqual({ status: "succeeded", provider_reference: "777" });
    const calls = fetchMock.mock.calls.length;
    await paymentCallback(env, post("/api/payments/callback?key=callback-secret", { identifier }));
    expect(fetchMock).toHaveBeenCalledTimes(calls);
    expect(db.prepare("select action from audit_log order by id").all()).toEqual([{ action: "insert" }, { action: "update" }]);
  });

  it("asks the provider to retry when its status check fails", async () => {
    const { env, identifier } = await pendingPaygatePayment(0);
    vi.stubGlobal("fetch", async () => new Response("", { status: 500 }));
    const response = await paymentCallback(env, post("/api/payments/callback?key=callback-secret", { identifier }));
    expect(response.status).toBe(503);
  });
});
