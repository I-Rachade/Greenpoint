import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { beforeAll, describe, expect, it } from "vitest";
import type { Profile } from "../src/lib/types";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { ApiError } from "./http";
import { roleToDb } from "./roles";
import {
  adjustBalance,
  adminWallet,
  counterCredit,
  createCreditCode,
  getWallet,
  setCreditMax,
  setStationGreenCredit,
  setWalletEnabled,
  setWalletFrozen,
  topUpCredit,
} from "./wallet";
import { counterCardInfo } from "./charge-cards";

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

const MIGRATIONS = new URL("./migrations/", import.meta.url);
const migrationFiles = () => readdirSync(MIGRATIONS).sort();
const applyMigration = (db: DatabaseSync, file: string) => db.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));

function fakeD1(db = new DatabaseSync(":memory:"), migrate = true) {
  if (migrate) {
    db.exec("pragma foreign_keys = on");
    for (const file of migrationFiles()) applyMigration(db, file);
  }
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
const KOFI: Profile = { id: "kofi", phone: "+22896123456", email: null, fullName: "Kofi Mensah", role: "customer" };
const AMA: Profile = { id: "ama", phone: null, email: "ama@mail.tg", fullName: null, role: "customer" };
const STAFF: Profile = { id: "staff", phone: "+22890000002", email: null, fullName: "Staff", role: "operator" };
const OPERATOR = "00000000-0000-4000-8000-000000000001"; // poinderecharge itself (is_own), from 0001_init.sql

function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  const insert = db.prepare("insert into users (id, phone, email, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?, ?)");
  for (const u of [ADMIN, KOFI, AMA, STAFF]) insert.run(u.id, u.phone, u.email, u.fullName, roleToDb(u.role), now, pinHash);
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, created_at) values
      ('st', '${OPERATOR}', 'Bè', 6.13, 1.22, 'charging', 0, '${now}'),
      ('plain', '${OPERATOR}', 'Tokoin', 6.14, 1.23, 'charging', 0, '${now}');
    update stations set green_credit = 1 where id = 'st';
  `);
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

/** Staff of 'st' only, as worker/api.ts actAt. */
const isStaffOf = async (user: Profile, stationId: string) => user.id === STAFF.id && stationId === "st";
const newCode = (env: Env, user: Profile, pin = PIN) => createCreditCode(env, user, req({ pin }));
const check = (env: Env, stationId: string, codeText: string) => counterCredit(env, STAFF, isStaffOf, stationId, req({ code: codeText }));
const load = (env: Env, stationId: string, codeText: string, amountXof: number, by: Profile = STAFF) =>
  topUpCredit(env, by, isStaffOf, stationId, req({ code: codeText, amountXof }));

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

describe("Green Credit counter codes", () => {
  it("needs the right PIN and gives an 8-digit code valid 5 minutes; a new code voids the older one", async () => {
    const { db, env } = setup();
    expect(await code(newCode(env, KOFI, "1111"))).toBe("invalid_pin");
    const first = await newCode(env, KOFI);
    expect(first.code).toMatch(/^\d{8}$/);
    const minutes = (new Date(first.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(4.9);
    expect(minutes).toBeLessThanOrEqual(5);
    // Only the hash is kept.
    expect(db.prepare("select count(*) as n from credit_codes where code_hash = ?").get(first.code)).toEqual({ n: 0 });
    const second = await newCode(env, KOFI);
    expect(await code(check(env, "st", first.code))).toBe("credit_code_invalid");
    expect(await check(env, "st", `GC-${second.code}`)).toEqual({ customer: "Kofi M.", balanceXof: 0, maxTopupXof: 50_000 });
  });

  it("loads cash at a Green Credit station's counter once per code, booked at the station", async () => {
    const { db, env } = setup();
    const { code: c } = await newCode(env, KOFI);
    expect(await code(check(env, "plain", c))).toBe("forbidden");
    expect(await code(counterCredit(env, AMA, isStaffOf, "st", req({ code: c })))).toBe("forbidden");
    expect(await code(load(env, "st", "12345678", 1_000))).toBe("credit_code_invalid");
    expect(await code(load(env, "st", c, 50))).toBe("invalid_amount");
    expect(await load(env, "st", c, 5_000)).toEqual({ customer: "Kofi M.", amountXof: 5_000, balanceXof: 5_000 });
    expect(balance(db, "kofi")).toBe(5_000);
    const row = db.prepare("select type, attribute, amount_xof, station_id, counterparty_label from wallet_transactions where user_id = 'kofi'").get();
    expect(row).toEqual({ type: "topup", attribute: "received", amount_xof: 5_000, station_id: "st", counterparty_label: "Bè" });
    expect(db.prepare("select used_at_station, used_for from credit_codes").get()).toEqual({ used_at_station: "st", used_for: "topup" });
    // Used once.
    expect(await code(load(env, "st", c, 1_000))).toBe("credit_code_invalid");
    expect(balance(db, "kofi")).toBe(5_000);
    expect((await adminWallet(env, new URL("https://x/api/admin/wallet"))).totals).toMatchObject({ balancesXof: 5_000, toppedUpXof: 5_000 });
  });

  it("lets only our stations and shop stations with our swap take Green Credit", async () => {
    const { db, env } = setup();
    const now = new Date().toISOString();
    db.exec(`
      insert into operators (id, name, is_own, created_at) values ('partner', 'Partenaire', 0, '${now}');
      insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, created_at) values
        ('theirs', 'partner', 'Chez eux', 6.15, 1.24, 'swap', 4, '${now}'),
        ('shop', 'partner', 'Boutique', 6.16, 1.25, 'swap', 4, '${now}');
      update stations set swap_owner = 'poinderecharge' where id = 'shop';
    `);
    expect(await code(setStationGreenCredit(env, ADMIN, "theirs", req({ enabled: true })))).toBe("credit_not_accepted");
    expect(await code(setStationGreenCredit(env, ADMIN, "shop", req({ enabled: true })))).toBe("ok");
    // A flag set before the rule (or by hand) does not make a partner's station accept it.
    db.exec("update stations set green_credit = 1 where id = 'theirs'");
    const { code: c } = await newCode(env, KOFI);
    expect(await code(topUpCredit(env, STAFF, async () => true, "theirs", req({ code: c, amountXof: 1_000 })))).toBe("credit_not_accepted");
    expect((await getWallet(env, KOFI)).stations.map((s) => s.id).sort()).toEqual(["shop", "st"]);
  });

  it("refuses a station an admin has not designated, an expired code and a load above the limit", async () => {
    const { db, env } = setup();
    const staffEverywhere = async () => true;
    const { code: c } = await newCode(env, KOFI);
    expect(await code(topUpCredit(env, STAFF, staffEverywhere, "plain", req({ code: c, amountXof: 1_000 })))).toBe("credit_not_accepted");
    await setStationGreenCredit(env, ADMIN, "plain", req({ enabled: true }));
    expect((await adminWallet(env, new URL("https://x/api/admin/wallet"))).stations.find((s) => s.id === "plain")?.greenCredit).toBe(true);
    expect((await getWallet(env, KOFI)).stations.map((s) => s.id).sort()).toEqual(["plain", "st"]);
    await setStationGreenCredit(env, ADMIN, "plain", req({ enabled: false }));
    expect(await code(topUpCredit(env, STAFF, staffEverywhere, "plain", req({ code: c, amountXof: 1_000 })))).toBe("credit_not_accepted");

    await setCreditMax(env, ADMIN, req({ maxXof: 3_000 }));
    expect((await getWallet(env, KOFI)).maxXof).toBe(3_000);
    expect(await code(load(env, "st", c, 3_001))).toBe("credit_limit_reached");
    expect(await load(env, "st", c, 3_000)).toMatchObject({ balanceXof: 3_000 });
    expect(await code(setCreditMax(env, ADMIN, req({ maxXof: -1 })))).toBe("bad_request");

    const late = await newCode(env, KOFI);
    db.prepare("update credit_codes set expires_at = ? where used_at is null").run(new Date(Date.now() - 1_000).toISOString());
    expect(await code(check(env, "st", late.code))).toBe("credit_code_invalid");
  });

  it("refuses a blocked Green Credit at the counter", async () => {
    const { env } = setup();
    const { code: c } = await newCode(env, KOFI);
    await setWalletFrozen(env, ADMIN, KOFI.phone, true);
    expect(await code(check(env, "st", c))).toBe("wallet_frozen");
    expect(await code(load(env, "st", c, 1_000))).toBe("wallet_frozen");
  });
});

describe("linked card at the counter", () => {
  it("shows whose account the card pays with and its Green Credit, never a card credit to load", async () => {
    const { db, env } = setup();
    const now = new Date().toISOString();
    db.prepare("insert into charge_cards (id_tag, user_id, created_at) values ('1592637480', 'kofi', ?), ('2745839105', null, ?)").run(now, now);
    await credit(env, KOFI.phone!, 1_200);
    // Never swiped here: only whether it is linked or blocked, not whose it is nor the credit.
    expect(await counterCardInfo(env.DB, STAFF, isStaffOf, "st", "1592637480")).toEqual({ idTag: "1592637480", label: null, blocked: false, linked: true });
    // Swiped at a charge point of this station within the last 24 hours: the owner and the credit.
    db.exec(`insert into devices (external_id, station_id, vendor, link, outlets, created_at) values ('123456', 'st', 'Xingke', 'own_server', 1, '${now}')`);
    db.prepare("update charge_cards set last_swiped_at = ?, last_device_id = '123456'").run(now);
    expect(await counterCardInfo(env.DB, STAFF, isStaffOf, "st", "1592637480")).toEqual({ idTag: "1592637480", label: null, blocked: false, linked: true, customer: "Kofi M.", balanceXof: 1_200 });
    expect(await counterCardInfo(env.DB, STAFF, isStaffOf, "st", "2745839105")).toEqual({ idTag: "2745839105", label: null, blocked: false, balanceXof: 0 });
    // A swipe two days ago no longer shows anything.
    db.prepare("update charge_cards set last_swiped_at = ?").run(new Date(Date.now() - 48 * 3_600_000).toISOString());
    expect(await counterCardInfo(env.DB, STAFF, isStaffOf, "st", "1592637480")).not.toHaveProperty("customer");
    expect(await code(counterCardInfo(env.DB, AMA, isStaffOf, "st", "1592637480"))).toBe("forbidden");
  });

  it("stops staff who try out card numbers", async () => {
    const { db, env } = setup();
    db.prepare("insert into charge_cards (id_tag, user_id, created_at) values ('1592637480', 'kofi', ?)").run(new Date().toISOString());
    for (let i = 0; i < 10; i++) expect(await code(counterCardInfo(env.DB, STAFF, isStaffOf, "st", `55500${i}`))).toBe("card_unknown");
    // Locked for a while, even for a real card.
    expect(await code(counterCardInfo(env.DB, STAFF, isStaffOf, "st", "1592637480"))).toBe("code_locked");
  });
});

describe("cash refunds", () => {
  it("takes the refunded amount off the credit, never below 0, and records it", async () => {
    const { db, env } = setup();
    await credit(env, KOFI.phone!, 2_000);
    const refund = (amountXof: number) => adjustBalance(env, ADMIN, req({ contact: KOFI.phone, direction: "refund", amountXof, remark: "Clôture du compte" }));
    expect(await code(refund(2_500))).toBe("insufficient_balance");
    const tx = await refund(2_000);
    expect(tx).toMatchObject({ type: "admin_adjust", attribute: "send", amountXof: 2_000, balanceAfterXof: 0 });
    expect(balance(db, "kofi")).toBe(0);
    const details = JSON.parse((db.prepare("select details from wallet_transactions where id = ?").get(tx.id) as { details: string }).details);
    expect(details.cashRefund).toBe(true);
    const audit = db.prepare("select changes from audit_log where table_name = 'wallets' and row_id = ?").get(tx.id) as { changes: string };
    expect(JSON.parse(audit.changes)).toMatchObject({ direction: "refund", amount_xof: 2_000 });
  });
});

describe("migration 0047", () => {
  it("moves the positive credit of linked cards to the account's Green Credit, booked on both sides", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("pragma foreign_keys = on");
    const files = migrationFiles();
    const at = files.findIndex((f) => f.startsWith("0047_"));
    for (const file of files.slice(0, at)) applyMigration(db, file);
    const now = new Date().toISOString();
    const insert = db.prepare("insert into users (id, phone, email, full_name, role, created_at) values (?, ?, ?, ?, ?, ?)");
    for (const u of [KOFI, AMA]) insert.run(u.id, u.phone, u.email, u.fullName, roleToDb(u.role), now);
    db.exec(`
      insert into wallets (user_id, balance_xof, created_at, updated_at) values ('kofi', 1000, '${now}', '${now}');
      insert into charge_cards (id_tag, user_id, balance_xof, created_at) values
        ('A1', 'kofi', 1500, '${now}'), ('A2', 'kofi', 500, '${now}'), ('B1', 'ama', 700, '${now}'),
        ('NEG', 'ama', -200, '${now}'), ('ANON', null, 900, '${now}');
    `);
    for (const file of files.slice(at)) applyMigration(db, file);
    expect(balance(db, "kofi")).toBe(3_000);
    expect(balance(db, "ama")).toBe(700);
    const cards = Object.fromEntries((db.prepare("select id_tag, balance_xof from charge_cards").all() as { id_tag: string; balance_xof: number }[]).map((c) => [c.id_tag, c.balance_xof]));
    expect(cards).toEqual({ A1: 0, A2: 0, B1: 0, NEG: -200, ANON: 900 });
    const rows = db.prepare("select user_id, amount_xof, balance_after_xof from wallet_transactions where type = 'admin_adjust' order by user_id, balance_after_xof").all();
    expect(rows).toEqual([
      { user_id: "ama", amount_xof: 700, balance_after_xof: 700 },
      { user_id: "kofi", amount_xof: 1_500, balance_after_xof: 2_500 },
      { user_id: "kofi", amount_xof: 500, balance_after_xof: 3_000 },
    ]);
    expect((db.prepare("select count(*) as n from charge_card_transactions where type = 'adjust'").get() as { n: number }).n).toBe(3);
    expect(db.prepare("select value from app_settings where key = 'green_credit_max_xof'").get()).toEqual({ value: "50000" });
  });
});
