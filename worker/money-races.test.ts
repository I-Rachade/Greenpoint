import type { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { SwapEntry } from "../src/lib/station-work";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Requests sent twice or at the same moment (Promise.all through handleApi): a double tap or a
// retry on a bad network must book once and tell staff what happened. fakeD1 interleaves the
// requests at every await, and runs each batch as one unit, like D1.

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

const balance = (db: DatabaseSync) => (db.prepare("select balance_xof from wallets where user_id = 'ama'").get() as { balance_xof: number }).balance_xof;
const count = (db: DatabaseSync, sql: string) => (db.prepare(sql).get() as { n: number }).n;
const full = (db: DatabaseSync) => (db.prepare("select full_batteries from station_status where station_id = 'be'").get() as { full_batteries: number }).full_batteries;
/** Lets every batch wait a moment, so all parallel requests have read before the first one writes. */
function holdBatches(env: Env, ms = 20) {
  const db = env.DB as unknown as { batch: (s: unknown[]) => Promise<unknown> };
  const batch = db.batch.bind(db);
  db.batch = async (statements) => {
    await new Promise((resolve) => setTimeout(resolve, ms));
    return batch(statements);
  };
}

describe("wallet-paid battery swap at the counter", () => {
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
});

describe("greenpoint reward redemption", () => {
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
});
