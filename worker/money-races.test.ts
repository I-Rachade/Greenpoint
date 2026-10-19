import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SwapEntry } from "../src/lib/station-work";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Every money path with parallel requests (Promise.all through handleApi): a double tap, a
// retry on a bad network or two counters at once must never take, load or spend twice, and
// a balance never goes below 0. fakeD1 interleaves the requests at every await, and runs
// each batch as one unit, like D1.

const OWN = "00000000-0000-4000-8000-000000000001"; // poinderecharge (is_own), from 0001_init.sql
const PIN = "2580";
const N = 8; // below COUNTER_CODE_MAX_TRIES, so the counter code lock does not hide a race
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "yao", phone: "+22890000002", name: "Yao", role: "operator" as const }, // owner of OWN
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const }, // staff at be
  { id: "ama", phone: "+22890000005", name: "Ama", role: "customer" as const }, // customer with Green Credit
];

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

async function setup(balance: number) {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash, last_sign_in_at) values (?, ?, ?, ?, ?, ?, ?)").run(
      u.id,
      u.phone,
      u.name,
      roleToDb(u.role),
      now,
      pinHash,
      now,
    );
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, is_solar, phone, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'both', 20, '00:00-24:00', 500, 1, '+22822000001', '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('be', 1, 0, 10, '${now}');
    update stations set green_credit = 1 where id = 'be';
    insert into station_staff (station_id, user_id) values ('be', 'afi');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', ${balance}, 'x', 'x');
  `);
  return { db, env };
}

async function call<T = unknown>(env: Env, as: string, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer token-of-${as}-0123456789` };
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
}

let seq = 0;
const rid = () => `race-${String(++seq).padStart(8, "0")}`;

const creditCode = async (env: Env) => (await call<{ code: string }>(env, "ama", "POST", "/api/wallet/code", { pin: PIN })).body.code;
const walletSwap = (env: Env, code: string, requestId = rid()) =>
  call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", { requestId, customerType: "app", creditCode: code });
const payCharge = (env: Env, id: string, idempotencyKey: string) => call(env, "ama", "POST", `/api/charging/${id}/pay/wallet`, { pin: PIN, idempotencyKey });

const balance = (db: DatabaseSync) => (db.prepare("select balance_xof from wallets where user_id = 'ama'").get() as { balance_xof: number }).balance_xof;
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const full = (db: DatabaseSync) => (db.prepare("select full_batteries from station_status where station_id = 'be'").get() as { full_batteries: number }).full_batteries;
/** What left the wallet must be exactly what the ledger says left it. */
function ledgerMatches(db: DatabaseSync, start: number) {
  const { sent, received } = db
    .prepare(
      `select coalesce(sum(case when attribute = 'send' then total_xof else 0 end), 0) as sent,
              coalesce(sum(case when attribute = 'received' then total_xof else 0 end), 0) as received
         from wallet_transactions where user_id = 'ama'`,
    )
    .get() as { sent: number; received: number };
  expect(balance(db)).toBe(start - sent + received);
  expect(balance(db)).toBeGreaterThanOrEqual(0);
}

/** Lets every batch wait a moment, so all parallel requests have read before the first one writes. */
function holdBatches(env: Env, ms = 20) {
  const db = env.DB as unknown as { batch: (s: unknown[]) => Promise<unknown> };
  const batch = db.batch.bind(db);
  db.batch = async (statements) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return batch(statements);
  };
}

/** A stopped charge of Ama at Bè that costs `price` FCFA (1 kWh at that price per kWh). */
function stoppedCharge(db: DatabaseSync, id: string, price = 500) {
  db.prepare(
    `insert into charging_sessions (id, station_id, device_id, outlet, point_label, user_id, status, kwh_xof, min_xof, energy_wh, started_by, started_at, stopped_at)
     values (?, 'be', '123456', 1, '3456-1', 'ama', 'stopped', ?, 100, 1000, 'afi', ?, ?)`,
  ).run(id, price, new Date(Date.now() - 600_000).toISOString(), new Date().toISOString());
}

describe("wallet-paid battery swap at the counter", () => {
  it("lets exactly one of many parallel swaps (distinct request ids) take the money for one swap", async () => {
    const { db, env } = await setup(500);
    const code = await creditCode(env);
    const answers = await Promise.all(Array.from({ length: N }, () => walletSwap(env, code)));
    const ok = answers.filter((a) => a.status === 200);
    expect(ok).toHaveLength(1);
    expect(ok[0].body).toMatchObject({ payment: "wallet", amountXof: 500 });
    for (const a of answers.filter((x) => x.status !== 200)) expect(["credit_code_invalid", "insufficient_balance", "code_locked"]).toContain(a.body.error);
    expect(balance(db)).toBe(0);
    expect(count(db, "select count(*) as n from wallet_transactions where attribute = 'send'")).toBe(1);
    expect(count(db, "select count(*) as n from swap_log")).toBe(1);
    expect(full(db)).toBe(9);
    ledgerMatches(db, 500);
  });

  it("spends a counter code once even when the balance would pay for several swaps", async () => {
    const { db, env } = await setup(5000);
    const code = await creditCode(env);
    const answers = await Promise.all(Array.from({ length: N }, () => walletSwap(env, code)));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(balance(db)).toBe(4500);
    expect(count(db, "select count(*) as n from wallet_transactions")).toBe(1);
    expect(count(db, "select count(*) as n from swap_log")).toBe(1);
    ledgerMatches(db, 5000);
  });

  it("books the same request id sent many times in parallel once, and answers every copy with that swap", async () => {
    const { db, env } = await setup(500);
    const code = await creditCode(env);
    const requestId = rid();
    const answers = await Promise.all(Array.from({ length: N }, () => walletSwap(env, code, requestId)));
    // A copy that lost the race must not tell staff the code failed: they would take cash too.
    expect(answers.map((a) => a.status)).toEqual(Array(N).fill(200));
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect(balance(db)).toBe(0);
    expect(count(db, "select count(*) as n from wallet_transactions")).toBe(1);
    expect(count(db, "select count(*) as n from swap_log")).toBe(1);
    expect(count(db, "select count(*) as n from battery_events")).toBe(2); // one out, one in
    expect(full(db)).toBe(9);
  });

  it("books a cash swap sent many times in parallel with one request id once", async () => {
    const { db, env } = await setup(0);
    const requestId = rid();
    const answers = await Promise.all(
      Array.from({ length: N }, () => call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", { requestId, customerType: "cash" })),
    );
    expect(answers.map((a) => a.status)).toEqual(Array(N).fill(200));
    expect(new Set(answers.map((a) => a.body.id)).size).toBe(1);
    expect(count(db, "select count(*) as n from swap_log")).toBe(1);
    expect(full(db)).toBe(9);
  });
});

describe("Green Credit top-up at the counter", () => {
  it("loads a one-time code once, however many top-ups use it at the same moment", async () => {
    const { db, env } = await setup(0);
    const code = await creditCode(env);
    const answers = await Promise.all(
      Array.from({ length: N }, () => call<{ balanceXof: number }>(env, "afi", "POST", "/api/stations/be/green-credit/topup", { code, amountXof: 1000 })),
    );
    const ok = answers.filter((a) => a.status === 200);
    expect(ok).toHaveLength(1);
    expect(ok[0].body.balanceXof).toBe(1000);
    for (const a of answers.filter((x) => x.status !== 200)) expect(["credit_code_invalid", "code_locked"]).toContain(a.body.error);
    expect(balance(db)).toBe(1000);
    expect(count(db, "select count(*) as n from wallet_transactions where type = 'topup'")).toBe(1);
    expect(count(db, "select count(*) as n from audit_log where table_name = 'wallets' and user_id = 'ama'")).toBe(1);
    ledgerMatches(db, 0);
  });

  it("lets a code either load or pay, never both, when a top-up and a swap race for it", async () => {
    const { db, env } = await setup(500);
    const code = await creditCode(env);
    const [topup, swap] = await Promise.all([
      call(env, "afi", "POST", "/api/stations/be/green-credit/topup", { code, amountXof: 1000 }),
      walletSwap(env, code),
    ]);
    expect([topup.status, swap.status].filter((s) => s === 200)).toHaveLength(1);
    expect(count(db, "select count(*) as n from wallet_transactions")).toBe(1);
    expect(balance(db)).toBe(topup.status === 200 ? 1500 : 0);
    ledgerMatches(db, 500);
  });
});

describe("charge paid from Green Credit", () => {
  it("takes the price of one stopped charge once, with many parallel payments (distinct keys)", async () => {
    const { db, env } = await setup(1000);
    stoppedCharge(db, "cs1");
    const answers = await Promise.all(Array.from({ length: N }, (_, i) => payCharge(env, "cs1", `key-race-${i}-0000`)));
    expect(answers.filter((a) => a.status === 200).length).toBeGreaterThanOrEqual(1);
    // Right PINs beyond the try limit at the same moment are refused, without locking the account.
    for (const a of answers.filter((x) => x.status !== 200)) expect(["charge_wrong_status", "pin_locked"]).toContain(a.body.error);
    expect(balance(db)).toBe(500);
    expect(count(db, "select count(*) as n from wallet_transactions where type = 'charge'")).toBe(1);
    expect(db.prepare("select status, payment_method, amount_xof from charging_sessions where id = 'cs1'").get()).toEqual({
      status: "paid",
      payment_method: "wallet",
      amount_xof: 500,
    });
    ledgerMatches(db, 1000);
  });

  it("takes it once with the same idempotency key sent many times in parallel", async () => {
    const { db, env } = await setup(1000);
    stoppedCharge(db, "cs1");
    const answers = await Promise.all(Array.from({ length: N }, () => payCharge(env, "cs1", "key-same-00000001")));
    expect(answers.filter((a) => a.status === 200).length).toBeGreaterThanOrEqual(1);
    expect(balance(db)).toBe(500);
    expect(count(db, "select count(*) as n from wallet_transactions")).toBe(1);
    ledgerMatches(db, 1000);
  });

  it("pays only what the balance holds when several charges are paid at once", async () => {
    const { db, env } = await setup(1000);
    for (let i = 0; i < 5; i++) stoppedCharge(db, `cs${i}`);
    const answers = await Promise.all(Array.from({ length: 5 }, (_, i) => payCharge(env, `cs${i}`, `key-many-${i}-0000`)));
    expect(answers.filter((a) => a.status === 200)).toHaveLength(2);
    for (const a of answers.filter((x) => x.status !== 200)) expect(a.body.error).toBe("insufficient_balance");
    expect(balance(db)).toBe(0);
    expect(count(db, "select count(*) as n from charging_sessions where status = 'paid'")).toBe(2);
    expect(count(db, "select count(*) as n from wallet_transactions")).toBe(2);
    ledgerMatches(db, 1000);
  });

  it("never goes below 0 when a wallet swap and a wallet charge payment race for the same balance", async () => {
    for (const swapFirst of [true, false]) {
      const { db, env } = await setup(500);
      stoppedCharge(db, "cs1");
      const code = await creditCode(env);
      const [swap, pay] = swapFirst
        ? await Promise.all([walletSwap(env, code), payCharge(env, "cs1", "key-mixed-00000001")])
        : await Promise.all([payCharge(env, "cs1", "key-mixed-00000001"), walletSwap(env, code)]).then(([p, s]) => [s, p]);
      expect([swap.status, pay.status].filter((s) => s === 200)).toHaveLength(1);
      expect([swap.body.error, pay.body.error].filter(Boolean)).toEqual(["insufficient_balance"]);
      expect(balance(db)).toBe(0);
      expect(count(db, "select count(*) as n from wallet_transactions")).toBe(1);
      expect(count(db, "select count(*) as n from swap_log")).toBe(swap.status === 200 ? 1 : 0);
      expect(count(db, "select count(*) as n from charging_sessions where status = 'paid'")).toBe(pay.status === 200 ? 1 : 0);
      ledgerMatches(db, 500);
    }
  });
});

describe("greenpoint reward redemption", () => {
  it("takes the points and the stock once when staff confirm the same code in parallel", async () => {
    const { db, env } = await setup(0);
    db.exec(`
      update greenpoint_rewards set stock = 5 where id = 'free-swap';
      insert into greenpoint_ledger (id, user_id, kind, points, created_at) values ('seed', 'ama', 'admin_adjust', 400, '${new Date().toISOString()}');
    `);
    const start = await call<{ code: string; costPoints: number }>(env, "ama", "POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" });
    expect(start.status).toBe(200);
    const answers = await Promise.all(
      Array.from({ length: N }, () => call(env, "afi", "POST", "/api/stations/be/greenpoint/redeem", { code: start.body.code })),
    );
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    for (const a of answers.filter((x) => x.status !== 200)) expect(["invalid_code", "code_locked"]).toContain(a.body.error);
    expect(count(db, "select count(*) as n from greenpoint_ledger where kind = 'redeem'")).toBe(1);
    expect(count(db, "select coalesce(sum(points), 0) as n from greenpoint_ledger where user_id = 'ama'")).toBe(400 - start.body.costPoints);
    expect(db.prepare("select stock from greenpoint_rewards where id = 'free-swap'").get()).toEqual({ stock: 4 });
  });

  it("takes them once even when the parallel confirmations happen within the same millisecond", async () => {
    const { db, env } = await setup(0);
    db.exec(`
      update greenpoint_rewards set stock = 5 where id = 'free-swap';
      insert into greenpoint_ledger (id, user_id, kind, points, created_at) values ('seed', 'ama', 'admin_adjust', 400, '${new Date().toISOString()}');
    `);
    const { code } = (await call<{ code: string }>(env, "ama", "POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" })).body;
    // One clock reading for every request: the same staff member, the same used_at. And every
    // request reads the open code before any of them writes (batches wait for the others).
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() });
    holdBatches(env);
    try {
      const answers = await Promise.all(Array.from({ length: N }, () => call(env, "afi", "POST", "/api/stations/be/greenpoint/redeem", { code })));
      expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
      // The others are told the code is used, not a server error.
      for (const a of answers.filter((x) => x.status !== 200)) expect(["invalid_code", "code_locked"]).toContain(a.body.error);
    } finally {
      vi.useRealTimers();
    }
    expect(count(db, "select count(*) as n from greenpoint_ledger where kind = 'redeem'")).toBe(1);
    expect(count(db, "select coalesce(sum(points), 0) as n from greenpoint_ledger where user_id = 'ama'")).toBe(250);
    expect(db.prepare("select stock from greenpoint_rewards where id = 'free-swap'").get()).toEqual({ stock: 4 });
  });

  it("takes the points once when the owner and the staff confirm the same code at once", async () => {
    const { db, env } = await setup(0);
    db.exec(`
      update greenpoint_rewards set stock = 5 where id = 'free-swap';
      insert into greenpoint_ledger (id, user_id, kind, points, created_at) values ('seed', 'ama', 'admin_adjust', 400, '${new Date().toISOString()}');
    `);
    const { code } = (await call<{ code: string }>(env, "ama", "POST", "/api/greenpoint/redemptions", { rewardId: "free-swap" })).body;
    const answers = await Promise.all([
      call(env, "afi", "POST", "/api/stations/be/greenpoint/redeem", { code }),
      call(env, "yao", "POST", "/api/stations/be/greenpoint/redeem", { code }, "be"),
    ]);
    expect(answers.filter((a) => a.status === 200)).toHaveLength(1);
    expect(count(db, "select count(*) as n from greenpoint_ledger where kind = 'redeem'")).toBe(1);
    expect(db.prepare("select stock from greenpoint_rewards where id = 'free-swap'").get()).toEqual({ stock: 4 });
  });
});

describe("admin wallet adjustment", () => {
  // The route has no idempotency key: every request is a new correction, so a double tap in the
  // backoffice books twice. What must hold in parallel: a subtraction never overdraws.
  it("never overdraws with many parallel subtractions", async () => {
    const { db, env } = await setup(1000);
    const answers = await Promise.all(
      Array.from({ length: N }, () => call(env, "admin", "POST", "/api/admin/wallet/adjust", { contact: "+22890000005", direction: "subtract", amountXof: 300, remark: "correction" })),
    );
    expect(answers.filter((a) => a.status === 200)).toHaveLength(3);
    for (const a of answers.filter((x) => x.status !== 200)) expect(a.body.error).toBe("insufficient_balance");
    expect(balance(db)).toBe(100);
    expect(count(db, "select count(*) as n from wallet_transactions where type = 'admin_adjust'")).toBe(3);
    ledgerMatches(db, 1000);
  });

  it("keeps the balance and the ledger in step when additions, refunds and a swap run at once", async () => {
    const { db, env } = await setup(500);
    const code = await creditCode(env);
    const adjust = (direction: string, amountXof: number) =>
      call(env, "admin", "POST", "/api/admin/wallet/adjust", { contact: "+22890000005", direction, amountXof, remark: "race" });
    const answers = await Promise.all([adjust("refund", 400), walletSwap(env, code), adjust("add", 200), adjust("subtract", 300)]);
    expect(answers.some((a) => a.status === 200)).toBe(true);
    ledgerMatches(db, 500);
  });
});
