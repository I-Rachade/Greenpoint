import { parseContact } from "../src/lib/contact";
import type { Profile } from "../src/lib/types";
import {
  CREDIT_CODE_MINUTES,
  CREDIT_TOPUP_MIN_XOF,
  maxTopup,
  newTrxId,
  parseAmount,
  parseCreditCode,
  personLabel,
  WALLET_REMARK_MAX,
  type AdminWallet,
  type AdminWalletTransaction,
  type CounterCredit,
  type CreditCode,
  type CreditTopupResult,
  type GreenCreditStation,
  type WalletAdjustInput,
  type WalletTransaction,
  type WalletTxType,
  type WalletView,
} from "../src/lib/wallet";
import { verifyPin } from "./auth";
import { withCounterCodeTry } from "./code-tries";
import type { Env } from "./env";
import { ApiError, nowIso, readJson, sha256, uuid } from "./http";
import { notifyUser } from "./notify";
import { notCustomerRole, refuseNonCustomer } from "./roles";

// Green Credit (migration 0047, formerly the Cashplus wallet): a closed prepaid credit for
// energy, loaded in cash at the counter of a Green Credit station and spent on what belongs
// to poinderecharge (worker/charging.ts, worker/station-work.ts). No transfers, no withdrawals,
// no online top-ups. Every booking is one D1 batch, which D1 runs as a single transaction: if
// any statement fails (an overdrawn wallet breaks the balance check, a repeated idempotency key
// breaks its unique index), nothing of the batch is written. See src/lib/wallet.ts.

interface TxRow {
  id: string;
  trx_id: string;
  user_id: string | null;
  type: WalletTxType;
  attribute: "send" | "received";
  status: WalletTransaction["status"];
  amount_xof: number;
  fee_xof: number;
  total_xof: number;
  balance_after_xof: number;
  counterparty_label: string | null;
  remark: string | null;
  admin_id: string | null;
  details?: string | null;
  created_at: string;
}

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
  role?: string;
}

const HISTORY_LIMIT = 50;
const ADMIN_HISTORY_LIMIT = 300;

/** A Green Credit charge's hold (taken when it starts) or what came back of it (0052). */
function holdOf(r: TxRow): "held" | "refund" | null {
  if (r.type !== "charge" || !r.details) return null;
  try {
    const d = JSON.parse(r.details) as { hold?: unknown; holdRefund?: unknown };
    return d.hold ? "held" : d.holdRefund ? "refund" : null;
  } catch {
    return null;
  }
}

function toTransaction(r: TxRow): WalletTransaction {
  const hold = holdOf(r);
  return {
    id: r.id,
    trxId: r.trx_id,
    type: r.type,
    attribute: r.attribute,
    status: r.status,
    amountXof: r.amount_xof,
    feeXof: r.fee_xof,
    totalXof: r.total_xof,
    balanceAfterXof: r.balance_after_xof,
    counterparty: r.counterparty_label,
    remark: r.remark,
    createdAt: r.created_at,
    ...(hold ? { hold } : {}),
  };
}

async function walletEnabled(db: D1Database): Promise<boolean> {
  const row = await db.prepare("select value from app_settings where key = 'wallet_enabled'").first<{ value: string }>();
  return row?.value === "1";
}

/** While the module is off only admins may use it, to test. Green Credit stays on in the Lite version. */
export async function walletAccess(env: Env, user: Profile): Promise<{ enabled: boolean; testMode: boolean }> {
  // Drivers are never customers (R11); their former balance waits in a customer account (0031).
  refuseNonCustomer(user);
  const enabled = await walletEnabled(env.DB);
  if (enabled) return { enabled, testMode: false };
  if (user.role === "admin") return { enabled, testMode: true };
  throw new ApiError("wallet_disabled", 403);
}

/**
 * Whether an account may spend its Green Credit without signing in itself (a card linked to it,
 * worker/charge-cards.ts): the same rule as walletAccess, read from the database.
 */
export async function accountSpendsCredit(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare("select role from users where id = ?").bind(userId).first<{ role: string }>();
  if (!row || notCustomerRole(row.role)) return false;
  return row.role === "admin" || (await walletEnabled(db));
}

function ensureWallet(env: Env, userId: string, now: string) {
  return env.DB.prepare("insert into wallets (user_id, created_at, updated_at) values (?, ?, ?) on conflict do nothing").bind(
    userId,
    now,
    now,
  );
}

/** Where a payment came from, for the record (spec: transaction_devices). */
function device(request: Request): Record<string, string | null> {
  const cf = (request as Request & { cf?: { country?: string; city?: string } }).cf;
  return {
    ip: request.headers.get("CF-Connecting-IP"),
    country: cf?.country ?? null,
    city: cf?.city ?? null,
    userAgent: request.headers.get("User-Agent")?.slice(0, 200) ?? null,
  };
}

function cleanRemark(value: unknown): string | null {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text ? text.slice(0, WALLET_REMARK_MAX) : null;
}

async function findUser(env: Env, rawContact: unknown): Promise<UserRow> {
  const text = String(rawContact ?? "");
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const column = contact.kind === "phone" ? "phone" : "email";
  const row = await env.DB.prepare(`select id, phone, email, full_name, role from users where ${column} = ?`)
    .bind(contact.value)
    .first<UserRow>();
  if (!row) throw new ApiError("recipient_not_found", 404);
  return row;
}

const label = (u: UserRow) => personLabel({ fullName: u.full_name, phone: u.phone, email: u.email });

/** Highest balance a customer may hold (0 = no limit), set in the backoffice. */
export async function creditMax(db: D1Database): Promise<number> {
  const row = await db.prepare("select value from app_settings where key = 'green_credit_max_xof'").first<{ value: string }>();
  const n = Number(row?.value ?? 0);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** The active stations that load and accept Green Credit. */
async function creditStations(db: D1Database): Promise<GreenCreditStation[]> {
  const { results } = await db.prepare("select id, name from stations where green_credit = 1 and is_active = 1 order by name").all<GreenCreditStation>();
  return results;
}

/**
 * A Green Credit charge of the user started before 0052 that runs or waits to be settled: its
 * limit is the whole balance and nothing was taken when it started, so no other payment may spend
 * the credit meanwhile. Since 0052 a charge takes its limit from the credit when it starts
 * (credit_held_xof), and other payments simply find less credit; this guard can go once no such
 * old charge is open. Bind the user's id.
 */
export const OPEN_CREDIT_CHARGE_SQL =
  "exists (select 1 from charging_sessions where user_id = ? and credit_limit_xof is not null and credit_held_xof is null and status in ('charging', 'stopped'))";

/** Refuses a payment from Green Credit while a Green Credit charge of the user holds the credit. */
export async function refuseWhileCreditCharging(db: D1Database, userId: string) {
  if (await db.prepare(`select ${OPEN_CREDIT_CHARGE_SQL} as open`).bind(userId).first<{ open: number }>().then((r) => r?.open)) {
    throw new ApiError("charge_unpaid", 409);
  }
}

/** Whether this station loads and accepts Green Credit (designated in the backoffice). */
export async function isCreditStation(db: D1Database, stationId: string): Promise<boolean> {
  return !!(await db.prepare("select 1 from stations where id = ? and green_credit = 1").bind(stationId).first());
}

// Users ------------------------------------------------------------------------

export async function getWallet(env: Env, user: Profile): Promise<WalletView> {
  const { enabled, testMode } = await walletAccess(env, user);
  const [wallet, maxXof, stations, history] = await Promise.all([
    env.DB.prepare("select balance_xof, status from wallets where user_id = ?")
      .bind(user.id)
      .first<{ balance_xof: number; status: "active" | "frozen" }>(),
    creditMax(env.DB),
    creditStations(env.DB),
    env.DB.prepare("select * from wallet_transactions where user_id = ? order by created_at desc, rowid desc limit ?")
      .bind(user.id, HISTORY_LIMIT)
      .all<TxRow>(),
  ]);
  return {
    enabled,
    testMode,
    balanceXof: wallet?.balance_xof ?? 0,
    frozen: wallet?.status === "frozen",
    maxXof,
    stations,
    transactions: history.results.map(toTransaction),
  };
}

/**
 * POST /api/wallet/code { pin }: the customer typed their PIN on their own phone; the app
 * shows the one-time code staff scan to load the credit or to take a swap from it. A new code
 * voids the customer's older ones.
 */
export async function createCreditCode(env: Env, user: Profile, request: Request): Promise<CreditCode> {
  const { pin } = await readJson<{ pin?: unknown }>(request);
  await walletAccess(env, user);
  await verifyPin(env, user.id, pin);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CREDIT_CODE_MINUTES * 60_000).toISOString();
  // A code still open for someone else breaks the primary key (1 in 100 million): try another one.
  for (let attempt = 0; ; attempt++) {
    const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000;
    const code = String(digits).padStart(8, "0");
    try {
      await env.DB.batch([
        env.DB.prepare("delete from credit_codes where user_id = ? and used_at is null").bind(user.id),
        // Housekeeping: codes expired a day ago are of no use any more.
        env.DB.prepare("delete from credit_codes where expires_at < ?").bind(new Date(now.getTime() - 86_400_000).toISOString()),
        env.DB.prepare("insert into credit_codes (code_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").bind(
          await sha256(code),
          user.id,
          now.toISOString(),
          expiresAt,
        ),
      ]);
    } catch (err) {
      if (/UNIQUE|PRIMARY/i.test(String(err)) && attempt < 3) continue;
      throw err;
    }
    return { code, expiresAt };
  }
}

/** The customer behind a counter code that is still open; refused otherwise. */
export async function creditCodeOwner(db: D1Database, rawCode: unknown): Promise<{ hash: string; user: UserRow }> {
  const code = parseCreditCode(String(rawCode ?? ""));
  if (!code) throw new ApiError("credit_code_invalid");
  const hash = await sha256(code);
  const row = await db
    .prepare(
      `select u.id, u.phone, u.email, u.full_name, u.role from credit_codes c join users u on u.id = c.user_id
        where c.code_hash = ? and c.used_at is null and c.expires_at > ?`,
    )
    .bind(hash, nowIso())
    .first<UserRow>();
  if (!row) throw new ApiError("credit_code_invalid");
  return { hash, user: row };
}

/**
 * Marks a counter code used, for the batch that spends or loads with it. The statements after it
 * only apply when `usedSql` holds: this request was the one that used the code (a fresh id per
 * request, not the time, which two parallel requests can share).
 */
export function spendCreditCode(db: D1Database, hash: string, stationId: string, purpose: "topup" | "swap" | "charge", at: string) {
  const request = uuid();
  return {
    statement: db
      .prepare(
        "update credit_codes set used_at = ?, used_at_station = ?, used_for = ?, used_by_request = ? where code_hash = ? and used_at is null and expires_at > ?",
      )
      .bind(at, stationId, purpose, request, hash, at),
    // Both values are made here (a hex hash and a uuid), never typed by anyone.
    usedSql: `exists (select 1 from credit_codes where code_hash = '${hash}' and used_by_request = '${request}' and used_for = '${purpose}')`,
  };
}

async function requireCreditStation(db: D1Database, stationId: string) {
  if (!(await isCreditStation(db, stationId))) throw new ApiError("credit_not_accepted", 409);
}

async function customerForCode(env: Env, staff: Profile, rawCode: unknown) {
  // Staff type someone else's code: many wrong ones stop them for a while (worker/code-tries.ts).
  const owner = await withCounterCodeTry(env.DB, staff.id, "credit", () => creditCodeOwner(env.DB, rawCode));
  const wallet = await env.DB.prepare("select balance_xof, status from wallets where user_id = ?")
    .bind(owner.user.id)
    .first<{ balance_xof: number; status: string }>();
  if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
  return { ...owner, balance: wallet?.balance_xof ?? 0 };
}

type StaffCheck = (user: Profile, stationId: string) => Promise<boolean>;

/** POST /api/stations/:id/green-credit/check { code }: who the code belongs to and how much may be loaded, before staff take the cash. */
export async function counterCredit(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, request: Request): Promise<CounterCredit> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  await requireCreditStation(env.DB, stationId);
  const { code } = await readJson<{ code?: unknown }>(request);
  const c = await customerForCode(env, user, code);
  return { customer: label(c.user), balanceXof: c.balance, maxTopupXof: maxTopup(c.balance, await creditMax(env.DB)) };
}

/**
 * POST /api/stations/:id/green-credit/topup { code, amountXof }: staff took the cash and load it
 * on the customer's Green Credit. The code proves the customer typed their PIN on their phone;
 * it is used once. The cash goes into the station's takings for poinderecharge (station-cash.ts).
 */
export async function topUpCredit(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, request: Request): Promise<CreditTopupResult> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const db = env.DB;
  await requireCreditStation(db, stationId);
  const input = await readJson<{ code?: unknown; amountXof?: unknown }>(request);
  const amount = parseAmount(input.amountXof);
  if (amount === null || amount < CREDIT_TOPUP_MIN_XOF) throw new ApiError("invalid_amount");
  const c = await customerForCode(env, user, input.code);
  if (c.user.id === user.id) throw new ApiError("own_reservation");
  const limit = maxTopup(c.balance, await creditMax(db));
  if (limit !== null && amount > limit) throw new ApiError("credit_limit_reached");
  const station = await db.prepare("select name from stations where id = ?").bind(stationId).first<{ name: string }>();
  for (let attempt = 0; ; attempt++) {
    const now = nowIso();
    const id = uuid();
    const used = spendCreditCode(db, c.hash, stationId, "topup", now);
    try {
      await db.batch([
        used.statement,
        db.prepare(`insert into wallets (user_id, created_at, updated_at) select ?1, ?2, ?2 where ${used.usedSql} on conflict do nothing`).bind(c.user.id, now),
        db.prepare(`update wallets set balance_xof = balance_xof + ?, updated_at = ? where user_id = ? and ${used.usedSql}`).bind(amount, now, c.user.id),
        db
          .prepare(
            `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
               counterparty_label, station_id, details, created_at)
             select ?1, ?2, ?3, 'topup', 'received', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7, ?8
              where ${used.usedSql}`,
          )
          .bind(id, newTrxId("topup"), c.user.id, amount, station?.name ?? null, stationId, JSON.stringify({ staff: user.id }), now),
        db
          .prepare(
            `insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes)
             select ?, ?, 'wallets', 'insert', ?, ?, ?, ? where ${used.usedSql}`,
          )
          .bind(now, user.id, id, stationId, c.user.id, JSON.stringify({ topup: amount, balance: [c.balance, c.balance + amount] })),
      ]);
    } catch (err) {
      if (/trx_id/.test(String(err)) && attempt < 3) continue;
      throw err;
    }
    const row = await db.prepare("select balance_after_xof from wallet_transactions where id = ?").bind(id).first<{ balance_after_xof: number }>();
    // The code was used meanwhile (a double tap): nothing was loaded by this request.
    if (!row) throw new ApiError("credit_code_invalid");
    try {
      await notifyUser(env, c.user.id, {
        subject: `Green Credit : +${amount} FCFA`,
        text: `${amount} FCFA ont été ajoutés à votre Green Credit à ${station?.name ?? "la station"}. Nouveau solde : ${row.balance_after_xof} FCFA.`,
      });
    } catch (err) {
      console.error("credit topup notice", err);
    }
    return { customer: label(c.user), amountXof: amount, balanceXof: row.balance_after_xof };
  }
}

/** A card linked to an account, at the counter: whose Green Credit it pays with, and how much is left. */
export async function cardOwnerCredit(db: D1Database, userId: string): Promise<{ customer: string; balanceXof: number }> {
  const user = await db.prepare("select id, phone, email, full_name from users where id = ?").bind(userId).first<UserRow>();
  if (!user) throw new ApiError("card_unknown", 404);
  const wallet = await db.prepare("select balance_xof from wallets where user_id = ?").bind(userId).first<{ balance_xof: number }>();
  return { customer: label(user), balanceXof: wallet?.balance_xof ?? 0 };
}

// Backoffice ---------------------------------------------------------------------

export async function adminWallet(env: Env, url: URL): Promise<AdminWallet> {
  const type = url.searchParams.get("type");
  const userId = url.searchParams.get("user");
  const where: string[] = [];
  const params: unknown[] = [];
  if (type === "transfer" || type === "admin_adjust" || type === "topup" || type === "charge" || type === "trip") {
    where.push("t.type = ?");
    params.push(type);
  }
  if (userId) {
    where.push("t.user_id = ?");
    params.push(userId);
  }
  const filter = where.length ? `where ${where.join(" and ")}` : "";
  const [enabled, maxXof, stations, totals, rows] = await Promise.all([
    walletEnabled(env.DB),
    creditMax(env.DB),
    env.DB.prepare("select id, name, green_credit from stations where is_active = 1 order by name").all<{ id: string; name: string; green_credit: number }>(),
    env.DB.prepare(
      `select (select coalesce(sum(balance_xof), 0) from wallets) as balances,
              (select count(*) from wallets) as wallets,
              (select coalesce(sum(amount_xof), 0) from wallet_transactions where type = 'topup' and station_id is not null) as topped_up,
              (select count(distinct trx_id) from wallet_transactions) as transactions`,
    ).first<{ balances: number; wallets: number; topped_up: number; transactions: number }>(),
    env.DB.prepare(
      `select t.*, u.phone, u.email, u.full_name from wallet_transactions t left join users u on u.id = t.user_id
       ${filter} order by t.created_at desc, t.rowid desc limit ${ADMIN_HISTORY_LIMIT}`,
    )
      .bind(...params)
      .all<TxRow & { phone: string | null; email: string | null; full_name: string | null }>(),
  ]);
  return {
    enabled,
    maxXof,
    stations: stations.results.map((s) => ({ id: s.id, name: s.name, greenCredit: !!s.green_credit })),
    totals: {
      balancesXof: totals?.balances ?? 0,
      wallets: totals?.wallets ?? 0,
      toppedUpXof: totals?.topped_up ?? 0,
      transactions: totals?.transactions ?? 0,
    },
    transactions: rows.results.map(
      (r): AdminWalletTransaction => ({
        ...toTransaction(r),
        userId: r.user_id,
        // Admins see the full contact, as in the user list.
        userLabel: r.user_id ? [r.full_name, r.phone ?? r.email].filter(Boolean).join(" · ") : null,
        adminId: r.admin_id,
      }),
    ),
  };
}

export async function setWalletEnabled(env: Env, admin: Profile, enabled: boolean) {
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("update app_settings set value = ?, updated_by = ?, updated_at = ? where key = 'wallet_enabled'").bind(
      enabled ? "1" : "0",
      admin.id,
      now,
    ),
    auditWallet(env, admin.id, "update", "wallet_enabled", { enabled }),
  ]);
}

/** POST /api/admin/wallet/max { maxXof }: the highest balance a customer may hold (0 = no limit). */
export async function setCreditMax(env: Env, admin: Profile, request: Request) {
  const { maxXof } = await readJson<{ maxXof?: unknown }>(request);
  const value = Number(maxXof);
  if (!Number.isInteger(value) || value < 0 || value > 10_000_000) throw new ApiError("bad_request");
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `insert into app_settings (key, value, updated_by, updated_at) values ('green_credit_max_xof', ?1, ?2, ?3)
       on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
    ).bind(String(value), admin.id, now),
    auditWallet(env, admin.id, "update", "green_credit_max_xof", { maxXof: value }),
  ]);
}

/** POST /api/admin/stations/:id/green-credit { enabled }: designates a station that loads and accepts Green Credit. */
export async function setStationGreenCredit(env: Env, admin: Profile, stationId: string, request: Request) {
  const { enabled } = await readJson<{ enabled?: unknown }>(request);
  if (typeof enabled !== "boolean") throw new ApiError("bad_request");
  const db = env.DB;
  const s = await db.prepare("select green_credit from stations where id = ?").bind(stationId).first<{ green_credit: number }>();
  if (!s) throw new ApiError("not_found", 404);
  if (!!s.green_credit === enabled) return { ok: true };
  await db.batch([
    db.prepare("update stations set green_credit = ? where id = ?").bind(enabled ? 1 : 0, stationId),
    db
      .prepare("insert into audit_log (at, actor, table_name, action, row_id, station_id, changes) values (?, ?, 'stations', 'update', ?, ?, ?)")
      .bind(nowIso(), admin.id, stationId, stationId, JSON.stringify({ green_credit: [!!s.green_credit, enabled] })),
  ]);
  return { ok: true };
}

/**
 * Admin correction (spec 1.4.11), or a cash refund (the customer got the money back, e.g. to
 * close the account; the only way credit ever leaves as money): one ledger row; a subtraction
 * can never make a balance negative.
 */
export async function adjustBalance(env: Env, admin: Profile, request: Request): Promise<WalletTransaction> {
  const input = await readJson<Partial<WalletAdjustInput>>(request);
  const amount = parseAmount(input.amountXof);
  if (amount === null) throw new ApiError("invalid_amount");
  if (input.direction !== "add" && input.direction !== "subtract" && input.direction !== "refund") throw new ApiError("bad_request");
  const remark = cleanRemark(input.remark);
  if (!remark) throw new ApiError("bad_request");
  const target = await findUser(env, input.contact);
  const now = nowIso();
  const id = uuid();
  const sign = input.direction === "add" ? 1 : -1;
  try {
    await env.DB.batch([
      ensureWallet(env, target.id, now),
      env.DB.prepare("update wallets set balance_xof = balance_xof + ?, updated_at = ? where user_id = ?").bind(sign * amount, now, target.id),
      env.DB.prepare(
        `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
           remark, admin_id, details, created_at)
         values (?1, ?2, ?3, 'admin_adjust', ?4, ?5, 0, ?5, (select balance_xof from wallets where user_id = ?3), ?6, ?7, ?8, ?9)`,
      ).bind(
        id,
        newTrxId("admin_adjust"),
        target.id,
        sign > 0 ? "received" : "send",
        amount,
        remark,
        admin.id,
        JSON.stringify({ device: device(request), ...(input.direction === "refund" ? { cashRefund: true } : {}) }),
        now,
      ),
      auditWallet(env, admin.id, "insert", id, { direction: input.direction, amount_xof: amount, remark }, target.id),
    ]);
  } catch (err) {
    if (/CHECK constraint failed/i.test((err as Error).message ?? "")) throw new ApiError("insufficient_balance");
    throw err;
  }
  const row = await env.DB.prepare("select * from wallet_transactions where id = ?").bind(id).first<TxRow>();
  return toTransaction(row!);
}

/** Blocks or unblocks a wallet: a frozen wallet can neither be loaded nor pay. */
export async function setWalletFrozen(env: Env, admin: Profile, rawContact: unknown, frozen: boolean) {
  const target = await findUser(env, rawContact);
  const now = nowIso();
  await env.DB.batch([
    ensureWallet(env, target.id, now),
    env.DB.prepare("update wallets set status = ?, updated_at = ? where user_id = ?").bind(frozen ? "frozen" : "active", now, target.id),
    auditWallet(env, admin.id, "update", target.id, { status: frozen ? "frozen" : "active" }, target.id),
  ]);
}

function auditWallet(env: Env, actor: string, action: "insert" | "update", rowId: string, changes: Record<string, unknown>, userId: string | null = null) {
  return env.DB.prepare(
    "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'wallets', ?, ?, null, ?, ?)",
  ).bind(nowIso(), actor, action, rowId, userId, JSON.stringify(changes));
}
