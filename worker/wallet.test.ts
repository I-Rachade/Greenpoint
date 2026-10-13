import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Profile } from "../src/lib/types";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { ApiError } from "./http";
import { adjustBalance, adminWallet, findRecipient, getWallet, saveFeeSetting, sendMoney, setWalletEnabled, setWalletFrozen } from "./wallet";

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
