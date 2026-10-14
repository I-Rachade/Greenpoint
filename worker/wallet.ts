import { parseContact } from "../src/lib/contact";
import type { Profile } from "../src/lib/types";
import {
  checkLimits,
  newTrxId,
  parseAmount,
  periodStarts,
  personLabel,
  quoteFee,
  receivePayload,
  validFeeSetting,
  WALLET_REMARK_MAX,
  type AdminWallet,
  type AdminWalletTransaction,
  type SendMoneyInput,
  type WalletAdjustInput,
  type WalletFeeSetting,
  type WalletProduct,
  type WalletRecipient,
  type WalletTransaction,
  type WalletTxType,
  type WalletUsage,
  type WalletView,
} from "../src/lib/wallet";
import { verifyPin } from "./auth";
import { cardProviderFromEnv, providerFromEnv } from "./payment-providers";
import type { Env } from "./env";
import { liteEnabled } from "./features";
import { ApiError, nowIso, readJson, uuid } from "./http";

// Wallet (Cashplus phase 1). Every booking is one D1 batch, which D1 runs as a
// single transaction: if any statement fails (an overdrawn wallet breaks the
// balance check, a repeated idempotency key breaks its unique index), nothing
// of the batch is written. See src/lib/wallet.ts and planung/cashplus-plan.md.

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
  created_at: string;
}

interface FeeRow {
  product: WalletProduct;
  fixed_xof: number;
  percent: number;
  min_xof: number;
  max_xof: number;
  daily_xof: number;
  monthly_xof: number;
  is_active: number;
}

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
}

const HISTORY_LIMIT = 50;
const ADMIN_HISTORY_LIMIT = 300;

function toTransaction(r: TxRow): WalletTransaction {
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
  };
}

function toSetting(r: FeeRow): WalletFeeSetting {
  return {
    product: r.product,
    fixedXof: r.fixed_xof,
    percent: r.percent,
    minXof: r.min_xof,
    maxXof: r.max_xof,
    dailyXof: r.daily_xof,
    monthlyXof: r.monthly_xof,
    isActive: !!r.is_active,
  };
}

async function walletEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("select value from app_settings where key = 'wallet_enabled'").first<{ value: string }>();
  return row?.value === "1";
}

/** While the module is off only admins may use it, to test. The Lite version hides it from everyone. */
export async function walletAccess(env: Env, user: Profile): Promise<{ enabled: boolean; testMode: boolean }> {
  if (await liteEnabled(env.DB)) throw new ApiError("wallet_disabled", 403);
  const enabled = await walletEnabled(env);
  if (enabled) return { enabled, testMode: false };
  if (user.role === "admin") return { enabled, testMode: true };
  throw new ApiError("wallet_disabled", 403);
}

/**
 * Without real Flooz/T-Money credentials the simulated provider confirms every
 * payment, which would hand out free money. Then only admins may top up, to test.
 */
export function topupAvailable(env: Env, user: Profile): boolean {
  const pay = providerFromEnv((key) => env[key as keyof Env] as string | undefined);
  return pay.name !== "mock" || user.role === "admin";
}

/** The same for bank cards, which have their own provider. */
export function cardTopupAvailable(env: Env, user: Profile): boolean {
  const pay = cardProviderFromEnv((key) => env[key as keyof Env] as string | undefined);
  return pay.name !== "mock" || user.role === "admin";
}

async function feeSetting(env: Env, product: WalletProduct): Promise<WalletFeeSetting> {
  const row = await env.DB.prepare("select * from wallet_fee_settings where product = ?").bind(product).first<FeeRow>();
  if (!row) throw new ApiError("unknown", 500);
  return toSetting(row);
}

/** Successful sends of this type today and this month (spec 1.3.4). */
async function usage(env: Env, userId: string, type: WalletTxType): Promise<WalletUsage> {
  const { day, month } = periodStarts();
  const row = await env.DB.prepare(
    `select coalesce(sum(case when created_at >= ?3 then amount_xof end), 0) as today,
            coalesce(sum(amount_xof), 0) as month
     from wallet_transactions
     where user_id = ?1 and type = ?2 and attribute = 'send' and status = 'success' and created_at >= ?4`,
  )
    .bind(userId, type, day, month)
    .first<{ today: number; month: number }>();
  return { todayXof: row?.today ?? 0, monthXof: row?.month ?? 0 };
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
  const row = await env.DB.prepare(`select id, phone, email, full_name from users where ${column} = ?`)
    .bind(contact.value)
    .first<UserRow>();
  if (!row) throw new ApiError("recipient_not_found", 404);
  return row;
}

const label = (u: UserRow) => personLabel({ fullName: u.full_name, phone: u.phone, email: u.email });

// Users ------------------------------------------------------------------------

export async function getWallet(env: Env, user: Profile): Promise<WalletView> {
  const { enabled, testMode } = await walletAccess(env, user);
  const [wallet, transfer, used, history] = await Promise.all([
    env.DB.prepare("select balance_xof, status from wallets where user_id = ?")
      .bind(user.id)
      .first<{ balance_xof: number; status: "active" | "frozen" }>(),
    feeSetting(env, "transfer"),
    usage(env, user.id, "transfer"),
    env.DB.prepare("select * from wallet_transactions where user_id = ? order by created_at desc, rowid desc limit ?")
      .bind(user.id, HISTORY_LIMIT)
      .all<TxRow>(),
  ]);
  const contact = user.phone ?? user.email;
  return {
    enabled,
    testMode,
    balanceXof: wallet?.balance_xof ?? 0,
    frozen: wallet?.status === "frozen",
    transfer,
    usage: used,
    receiveCode: contact ? receivePayload(contact) : null,
    topupAvailable: topupAvailable(env, user),
    cardTopupAvailable: cardTopupAvailable(env, user),
    transactions: history.results.map(toTransaction),
  };
}

/** Lets the sender check who will get the money before confirming. */
export async function findRecipient(env: Env, user: Profile, contact: string | null): Promise<WalletRecipient> {
  await walletAccess(env, user);
  const recipient = await findUser(env, contact);
  if (recipient.id === user.id) throw new ApiError("self_transfer");
  return { label: label(recipient) };
}

/** Send Money (spec 1.4.2): PIN, fee, limits and balance checked on the server; two ledger rows. */
export async function sendMoney(env: Env, user: Profile, request: Request): Promise<WalletTransaction> {
  const input = await readJson<Partial<SendMoneyInput>>(request);
  await walletAccess(env, user);
  const amount = parseAmount(input.amountXof);
  if (amount === null) throw new ApiError("invalid_amount");
  const key = String(input.idempotencyKey ?? "");
  if (!/^[\w-]{8,64}$/.test(key)) throw new ApiError("bad_request");

  // A retry of a payment that went through answers with the same booking.
  const done = await env.DB.prepare("select * from wallet_transactions where user_id = ? and idempotency_key = ?")
    .bind(user.id, key)
    .first<TxRow>();
  if (done) return toTransaction(done);

  const recipient = await findUser(env, input.contact);
  if (recipient.id === user.id) throw new ApiError("self_transfer");
  await verifyPin(env, user.id, input.pin);

  const setting = await feeSetting(env, "transfer");
  if (!setting.isActive) throw new ApiError("wallet_disabled", 403);
  const problem = checkLimits(amount, setting, await usage(env, user.id, "transfer"));
  if (problem) throw new ApiError(problem);
  const fee = quoteFee(amount, setting);

  const sender = await env.DB.prepare("select balance_xof, status from wallets where user_id = ?")
    .bind(user.id)
    .first<{ balance_xof: number; status: string }>();
  if (sender?.status === "frozen") throw new ApiError("wallet_frozen", 403);
  if (!sender || sender.balance_xof < fee.payableXof) throw new ApiError("insufficient_balance");
  const target = await env.DB.prepare("select status from wallets where user_id = ?").bind(recipient.id).first<{ status: string }>();
  if (target?.status === "frozen") throw new ApiError("recipient_not_found", 404);

  const remark = cleanRemark(input.remark);
  const details = JSON.stringify({ fee, device: device(request) });
  const me = await env.DB.prepare("select id, phone, email, full_name from users where id = ?").bind(user.id).first<UserRow>();

  // A transaction number already taken (1 in 43 million) breaks its unique index: try another one.
  for (let attempt = 0; ; attempt++) {
    const now = nowIso();
    const trxId = newTrxId("transfer");
    const sendId = uuid();
    try {
      await env.DB.batch([
        ensureWallet(env, recipient.id, now),
        // The check on balance_xof makes this fail when the money is no longer there.
        env.DB.prepare("update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ?").bind(fee.payableXof, now, user.id),
        env.DB.prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_user_id, counterparty_label, remark, idempotency_key, details, created_at)
           values (?1, ?2, ?3, 'transfer', 'send', ?4, ?5, ?6, (select balance_xof from wallets where user_id = ?3), ?7, ?8, ?9, ?10, ?11, ?12)`,
        ).bind(sendId, trxId, user.id, amount, fee.feeXof, fee.payableXof, recipient.id, label(recipient), remark, key, details, now),
        env.DB.prepare("update wallets set balance_xof = balance_xof + ?, updated_at = ? where user_id = ?").bind(amount, now, recipient.id),
        env.DB.prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_user_id, counterparty_label, remark, details, created_at)
           values (?1, ?2, ?3, 'transfer', 'received', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7, '{}', ?8)`,
        ).bind(uuid(), trxId, recipient.id, amount, user.id, me ? label(me) : null, remark, now),
      ]);
    } catch (err) {
      const message = (err as Error).message ?? "";
      if (/CHECK constraint failed/i.test(message)) throw new ApiError("insufficient_balance");
      if (/idempotency_key/.test(message)) {
        // The same payment arrived twice at once; the other request booked it.
        const again = await env.DB.prepare("select * from wallet_transactions where user_id = ? and idempotency_key = ?")
          .bind(user.id, key)
          .first<TxRow>();
        if (again) return toTransaction(again);
      }
      if (/trx_id/.test(message) && attempt < 3) continue;
      throw err;
    }
    const row = await env.DB.prepare("select * from wallet_transactions where id = ?").bind(sendId).first<TxRow>();
    if (!row) throw new ApiError("unknown", 500);
    return toTransaction(row);
  }
}

// Backoffice ---------------------------------------------------------------------

export async function adminWallet(env: Env, url: URL): Promise<AdminWallet> {
  const type = url.searchParams.get("type");
  const userId = url.searchParams.get("user");
  const where: string[] = [];
  const params: unknown[] = [];
  if (type === "transfer" || type === "admin_adjust" || type === "topup") {
    where.push("t.type = ?");
    params.push(type);
  }
  if (userId) {
    where.push("t.user_id = ?");
    params.push(userId);
  }
  const filter = where.length ? `where ${where.join(" and ")}` : "";
  const [enabled, settings, totals, rows] = await Promise.all([
    walletEnabled(env),
    env.DB.prepare("select * from wallet_fee_settings order by product").all<FeeRow>(),
    env.DB.prepare(
      `select (select coalesce(sum(balance_xof), 0) from wallets) as balances,
              (select count(*) from wallets) as wallets,
              (select coalesce(sum(fee_xof), 0) from wallet_transactions where status = 'success') as fees,
              (select count(distinct trx_id) from wallet_transactions) as transactions`,
    ).first<{ balances: number; wallets: number; fees: number; transactions: number }>(),
    env.DB.prepare(
      `select t.*, u.phone, u.email, u.full_name from wallet_transactions t left join users u on u.id = t.user_id
       ${filter} order by t.created_at desc, t.rowid desc limit ${ADMIN_HISTORY_LIMIT}`,
    )
      .bind(...params)
      .all<TxRow & { phone: string | null; email: string | null; full_name: string | null }>(),
  ]);
  return {
    enabled,
    settings: settings.results.map(toSetting),
    totals: {
      balancesXof: totals?.balances ?? 0,
      wallets: totals?.wallets ?? 0,
      feesXof: totals?.fees ?? 0,
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

export async function saveFeeSetting(env: Env, admin: Profile, input: WalletFeeSetting) {
  const s = validFeeSetting(input);
  if (!s) throw new ApiError("bad_request");
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare(
      `update wallet_fee_settings set fixed_xof = ?, percent = ?, min_xof = ?, max_xof = ?, daily_xof = ?, monthly_xof = ?,
         is_active = ?, updated_by = ?, updated_at = ? where product = ?`,
    ).bind(s.fixedXof, s.percent, s.minXof, s.maxXof, s.dailyXof, s.monthlyXof, s.isActive ? 1 : 0, admin.id, now, s.product),
    auditWallet(env, admin.id, "update", `fees:${s.product}`, { ...s }),
  ]);
}

/** Admin correction (spec 1.4.11): one ledger row; a subtraction can never make a balance negative. */
export async function adjustBalance(env: Env, admin: Profile, request: Request): Promise<WalletTransaction> {
  const input = await readJson<Partial<WalletAdjustInput>>(request);
  const amount = parseAmount(input.amountXof);
  if (amount === null) throw new ApiError("invalid_amount");
  if (input.direction !== "add" && input.direction !== "subtract") throw new ApiError("bad_request");
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
      ).bind(id, newTrxId("admin_adjust"), target.id, sign > 0 ? "received" : "send", amount, remark, admin.id, JSON.stringify({ device: device(request) }), now),
      auditWallet(env, admin.id, "insert", id, { direction: input.direction, amount_xof: amount, remark }, target.id),
    ]);
  } catch (err) {
    if (/CHECK constraint failed/i.test((err as Error).message ?? "")) throw new ApiError("insufficient_balance");
    throw err;
  }
  const row = await env.DB.prepare("select * from wallet_transactions where id = ?").bind(id).first<TxRow>();
  return toTransaction(row!);
}

/** Blocks or unblocks a wallet: a frozen wallet cannot send or receive. */
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
