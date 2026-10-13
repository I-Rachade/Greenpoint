import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Profile } from "../src/lib/types";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { ApiError } from "./http";
import { adjustBalance, adminWallet, findRecipient, getWallet, saveFeeSetting, sendMoney, setWalletEnabled, setWalletFrozen } from "./wallet";
import { refreshTopup, startTopup, topupCallback } from "./wallet-topups";

// --- A minimal D1 on top of SQLite, with the real migrations (as in payments.test.ts) ---

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
    try {
      return this.db.prepare(this.sql).run(...this.params);
    } catch (err) {
      throw new Error(`D1_ERROR: ${(err as Error).message}`);
    }
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

const PIN = "2580";
let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

const ADMIN: Profile = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" };
const KOFI: Profile = { id: "kofi", phone: "+22896123456", email: null, fullName: "Kofi Mensah", role: "rider" };
const AMA: Profile = { id: "ama", phone: null, email: "ama@mail.tg", fullName: null, role: "rider" };

function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  const insert = db.prepare("insert into users (id, phone, email, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?, ?)");
  for (const u of [ADMIN, KOFI, AMA]) insert.run(u.id, u.phone, u.email, u.fullName, u.role, now, pinHash);
  const env = { DB: d1 } as unknown as Env;
  return { db, env };
}

function req(body: unknown) {
  return new Request("https://app.poinderecharge.com/api/wallet/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.5" },
    body: JSON.stringify(body),
  });
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof ApiError) return err.code;
    throw err;
  }
  return "ok";
}

const balance = (db: DatabaseSync, id: string) =>
  (db.prepare("select balance_xof from wallets where user_id = ?").get(id) as { balance_xof: number } | undefined)?.balance_xof ?? 0;

let keyNo = 0;
const send = (env: Env, from: Profile, body: Record<string, unknown>) =>
  sendMoney(env, from, req({ pin: PIN, idempotencyKey: `key-${++keyNo}-abcdef`, ...body }));

async function credit(env: Env, contact: string, amountXof: number) {
  await adjustBalance(env, ADMIN, req({ contact, direction: "add", amountXof, remark: "Dépôt test" }));
}

describe("module switch", () => {
  it("is on after the migration; switched off, customers are refused and admins test", async () => {
    const { env } = setup();
    expect((await getWallet(env, KOFI)).enabled).toBe(true);
    await setWalletEnabled(env, ADMIN, false);
    expect(await code(getWallet(env, KOFI))).toBe("wallet_disabled");
    const view = await getWallet(env, ADMIN);
    expect(view.testMode).toBe(true);
    expect(view.balanceXof).toBe(0);
    await setWalletEnabled(env, ADMIN, true);
    expect((await getWallet(env, KOFI)).enabled).toBe(true);
  });
});

describe("send money", () => {
  it("books both sides with one transaction number; the fee only on the sender's side", async () => {
    const { db, env } = setup();
    await setWalletEnabled(env, ADMIN, true);
    await saveFeeSetting(env, ADMIN, { product: "transfer", fixedXof: 50, percent: 1, minXof: 100, maxXof: 0, dailyXof: 0, monthlyXof: 0, isActive: true });
    await credit(env, KOFI.phone!, 10_000);

    const tx = await send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_000, remark: "Merci" });
    expect(tx).toMatchObject({ attribute: "send", amountXof: 1_000, feeXof: 60, totalXof: 1_060, balanceAfterXof: 8_940, counterparty: "am••@mail.tg" });
    expect(balance(db, "kofi")).toBe(8_940);
    expect(balance(db, "ama")).toBe(1_000);

    const ama = await getWallet(env, AMA);
    expect(ama.transactions[0]).toMatchObject({ trxId: tx.trxId, attribute: "received", feeXof: 0, totalXof: 1_000, counterparty: "Kofi M.", remark: "Merci" });

    const admin = await adminWallet(env, new URL("https://x/api/admin/wallet"));
    expect(admin.totals).toMatchObject({ balancesXof: 9_940, feesXof: 60 });
    expect(JSON.parse((db.prepare("select details from wallet_transactions where id = ?").get(tx.id) as { details: string }).details).device.ip).toBe("203.0.113.5");
  });

  it("answers a retry with the same key with the first booking and pays once", async () => {
    const { db, env } = setup();
    await setWalletEnabled(env, ADMIN, true);
    await credit(env, KOFI.phone!, 5_000);
    const body = { contact: "ama@mail.tg", amountXof: 1_000, pin: PIN, idempotencyKey: "same-key-123456" };
    const first = await sendMoney(env, KOFI, req(body));
    const second = await sendMoney(env, KOFI, req(body));
    expect(second.id).toBe(first.id);
    expect(balance(db, "kofi")).toBe(4_000);
  });

  it("never overdraws, even when two payments race", async () => {
    const { db, env } = setup();
    await setWalletEnabled(env, ADMIN, true);
    await credit(env, KOFI.phone!, 1_500);
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 2_000 }))).toBe("insufficient_balance");
    const results = await Promise.all([
      code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_000 })),
      code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_000 })),
    ]);
    expect(results.sort()).toEqual(["insufficient_balance", "ok"]);
    expect(balance(db, "kofi")).toBe(500);
    expect(balance(db, "ama")).toBe(1_000);
    expect((db.prepare("select count(*) as n from wallet_transactions where type = 'transfer'").get() as { n: number }).n).toBe(2);
  });

  it("checks the PIN, the recipient and the limits on the server", async () => {
    const { db, env } = setup();
    await setWalletEnabled(env, ADMIN, true);
    await saveFeeSetting(env, ADMIN, { product: "transfer", fixedXof: 0, percent: 0, minXof: 100, maxXof: 5_000, dailyXof: 6_000, monthlyXof: 0, isActive: true });
    await credit(env, KOFI.phone!, 20_000);
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_000, pin: "1111" }))).toBe("invalid_pin");
    expect(await code(send(env, KOFI, { contact: "+22896123456", amountXof: 1_000 }))).toBe("self_transfer");
    expect(await code(send(env, KOFI, { contact: "+22899999999", amountXof: 1_000 }))).toBe("recipient_not_found");
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 50 }))).toBe("amount_too_small");
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 5_001 }))).toBe("amount_too_large");
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 10.5 }))).toBe("invalid_amount");
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 5_000 }))).toBe("ok");
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_500 }))).toBe("daily_limit_exceeded");
    expect(balance(db, "kofi")).toBe(15_000);
    expect(await findRecipient(env, KOFI, "ama@mail.tg")).toEqual({ label: "am••@mail.tg" });
  });

  it("refuses payments from and to a blocked wallet", async () => {
    const { env } = setup();
    await setWalletEnabled(env, ADMIN, true);
    await credit(env, KOFI.phone!, 5_000);
    await setWalletFrozen(env, ADMIN, "ama@mail.tg", true);
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_000 }))).toBe("recipient_not_found");
    await setWalletFrozen(env, ADMIN, "ama@mail.tg", false);
    await setWalletFrozen(env, ADMIN, KOFI.phone, true);
    expect(await code(send(env, KOFI, { contact: "ama@mail.tg", amountXof: 1_000 }))).toBe("wallet_frozen");
  });
});

describe("admin corrections", () => {
  it("cannot take more than the balance and leave a trace in the activity log", async () => {
    const { db, env } = setup();
    await credit(env, KOFI.phone!, 1_000);
    const subtract = (amountXof: number) =>
      adjustBalance(env, ADMIN, req({ contact: KOFI.phone, direction: "subtract", amountXof, remark: "Erreur de saisie" }));
    expect(await code(subtract(1_500))).toBe("insufficient_balance");
    expect(balance(db, "kofi")).toBe(1_000);
    expect((await subtract(400)).balanceAfterXof).toBe(600);
    expect(await code(adjustBalance(env, ADMIN, req({ contact: KOFI.phone, direction: "add", amountXof: 100, remark: " " })))).toBe("bad_request");
    const log = db.prepare("select count(*) as n from audit_log where table_name = 'wallets'").get() as { n: number };
    expect(log.n).toBe(2);
  });
});

describe("top-ups from Flooz / T-Money", () => {
  const PAYGATE = { PAYMENTS_PROVIDER: "paygate", PAYGATE_AUTH_TOKEN: "token" };
  const topupReq = (body: unknown) =>
    new Request("https://app.poinderecharge.com/api/wallet/topups", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  /** A PayGate stand-in: every request is accepted; the status is whatever the test sets. */
  function fakePaygate(status: { value: number }) {
    return async (url: string | URL | Request) => {
      const path = String(url);
      const json = path.includes("/status") ? { status: status.value, tx_reference: "tx1" } : { status: 0, tx_reference: "tx1" };
      return new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } });
    };
  }

  it("is refused for customers while only the simulated provider is set up", async () => {
    const { env } = setup();
    expect((await getWallet(env, KOFI)).topupAvailable).toBe(false);
    expect(await code(startTopup(env, KOFI, topupReq({ amountXof: 1_000, network: "tmoney", phone: "+22890123456" })))).toBe("topup_unavailable");
    expect((await getWallet(env, ADMIN)).topupAvailable).toBe(true);
  });

  it("credits the wallet once, when the provider confirms, however often the status is asked", async () => {
    const { db, env: base } = setup();
    const env = { ...base, ...PAYGATE } as Env;
    const status = { value: 2 };
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakePaygate(status) as typeof fetch;
    try {
      const topup = await startTopup(env, KOFI, topupReq({ amountXof: 5_000, network: "tmoney", phone: "90 12 34 56" }));
      expect(topup.status).toBe("pending");
      expect((await refreshTopup(env, KOFI, topup.id)).status).toBe("pending");
      expect(balance(db, "kofi")).toBe(0);

      status.value = 0;
      expect((await refreshTopup(env, KOFI, topup.id)).status).toBe("succeeded");
      // The provider's callback for the same payment arrives afterwards.
      const identifier = (db.prepare("select identifier from wallet_topups where id = ?").get(topup.id) as { identifier: string }).identifier;
      expect(identifier.startsWith("pdw_")).toBe(true);
      expect((await topupCallback(env, identifier)).status).toBe(200);
      expect(await refreshTopup(env, KOFI, topup.id)).toMatchObject({ status: "succeeded" });
      expect(balance(db, "kofi")).toBe(5_000);
      const view = await getWallet(env, KOFI);
      expect(view.transactions).toHaveLength(1);
      expect(view.transactions[0]).toMatchObject({ type: "topup", attribute: "received", amountXof: 5_000, balanceAfterXof: 5_000, counterparty: "T-Money" });
      expect(view.transactions[0].trxId).toMatch(/^AM[1-9]{8}$/);
      expect(await code(refreshTopup(env, AMA, topup.id))).toBe("not_found");
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("credits nothing when the payment is cancelled, and checks amount and number", async () => {
    const { db, env: base } = setup();
    const env = { ...base, ...PAYGATE } as Env;
    const status = { value: 6 };
    const realFetch = globalThis.fetch;
    globalThis.fetch = fakePaygate(status) as typeof fetch;
    try {
      expect(await code(startTopup(env, KOFI, topupReq({ amountXof: 50, network: "tmoney", phone: "+22890123456" })))).toBe("amount_too_small");
      expect(await code(startTopup(env, KOFI, topupReq({ amountXof: 600_000, network: "tmoney", phone: "+22890123456" })))).toBe("amount_too_large");
      expect(await code(startTopup(env, KOFI, topupReq({ amountXof: 1_000, network: "tmoney", phone: "+33612345678" })))).toBe("phone_not_allowed");
      const topup = await startTopup(env, KOFI, topupReq({ amountXof: 1_000, network: "flooz", phone: "+22896123456" }));
      expect((await refreshTopup(env, KOFI, topup.id)).status).toBe("cancelled");
      status.value = 0; // a late "paid" cannot revive it
      expect((await refreshTopup(env, KOFI, topup.id)).status).toBe("cancelled");
      expect(balance(db, "kofi")).toBe(0);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("sends card payments to the provider's page and credits once the card provider accepts", async () => {
    const { db, env: base } = setup();
    const env = { ...base, CARD_PROVIDER: "cinetpay", CINETPAY_API_KEY: "key", CINETPAY_SITE_ID: "site", PAYMENT_CALLBACK_SECRET: "s3cret" } as Env;
    const status = { value: "WAITING_CUSTOMER_PAYMENT" };
    const sent: Record<string, unknown>[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      sent.push(JSON.parse(String(init?.body)));
      const json = String(url).endsWith("/check")
        ? { code: "00", data: { status: status.value, operator_id: "op1" } }
        : { code: "201", data: { payment_token: "tok", payment_url: "https://checkout.cinetpay.com/payment/tok" } };
      return new Response(JSON.stringify(json), { headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;
    try {
      expect((await getWallet(env, KOFI)).cardTopupAvailable).toBe(true);
      expect(await code(startTopup(env, KOFI, topupReq({ amountXof: 1_002, network: "card" })))).toBe("invalid_amount");
      const topup = await startTopup(env, KOFI, topupReq({ amountXof: 2_500, network: "card" }));
      expect(topup).toMatchObject({ status: "pending", network: "card", checkoutUrl: "https://checkout.cinetpay.com/payment/tok" });
      expect(sent[0]).toMatchObject({ amount: 2_500, currency: "XOF", channels: "CREDIT_CARD", return_url: `https://app.poinderecharge.com/portefeuille?topup=${topup.id}` });
      expect(String(sent[0].notify_url)).toContain("/api/payments/callback?key=s3cret");
      expect((await refreshTopup(env, KOFI, topup.id)).status).toBe("pending");
      status.value = "ACCEPTED";
      expect((await refreshTopup(env, KOFI, topup.id)).status).toBe("succeeded");
      expect(balance(db, "kofi")).toBe(2_500);
      expect((await getWallet(env, KOFI)).transactions[0]).toMatchObject({ type: "topup", counterparty: "Carte bancaire" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it("keeps cards closed to customers while only the simulated card provider is set up", async () => {
    const { env } = setup();
    expect((await getWallet(env, KOFI)).cardTopupAvailable).toBe(false);
    expect(await code(startTopup(env, KOFI, topupReq({ amountXof: 1_000, network: "card" })))).toBe("topup_unavailable");
  });
});
