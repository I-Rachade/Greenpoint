import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile } from "../src/lib/types";
import { newTrxId, parseAmount, TOPUP_MAX_XOF, TOPUP_MIN_XOF, TOPUP_NETWORK_LABEL, type TopupInput, type WalletTopup } from "../src/lib/wallet";
import type { Env } from "./env";
import { ApiError, nowIso, readJson, uuid } from "./http";
import {
  cardProviderFromEnv,
  PAYMENT_NETWORKS,
  ProviderError,
  providerFromEnv,
  type CheckoutProvider,
  type PaymentNetwork,
  type PaymentProvider,
  type ProviderStatus,
} from "./payment-providers";
import { cardTopupAvailable, topupAvailable, walletAccess } from "./wallet";

// Wallet top-ups from Flooz / T-Money or a bank card (Cashplus phase 2, "Add
// money"). Mobile money is asked like a reservation payment (worker/payments.ts),
// a card is paid on the card provider's checkout page. The wallet is credited only once the provider itself confirms the payment, and
// the credit is tied to the top-up in one batch so it can never happen twice.

/** Identifiers of top-ups start with this, so the shared provider callback can tell them from reservation payments. */
export const TOPUP_IDENTIFIER_PREFIX = "pdw_";

interface TopupRow {
  id: string;
  identifier: string;
  user_id: string | null;
  amount_xof: number;
  network: WalletTopup["network"];
  phone: string | null;
  provider: string;
  provider_reference: string | null;
  status: WalletTopup["status"];
  failure_reason: string | null;
  wallet_tx_id: string | null;
  created_at: string;
  paid_at: string | null;
}

function toTopup(r: TopupRow): WalletTopup {
  return {
    id: r.id,
    amountXof: r.amount_xof,
    network: r.network,
    status: r.status,
    failureReason: r.failure_reason,
    createdAt: r.created_at,
    paidAt: r.paid_at,
  };
}

function provider(env: Env): PaymentProvider {
  return providerFromEnv((key) => env[key as keyof Env] as string | undefined);
}

function cardProvider(env: Env): CheckoutProvider {
  return cardProviderFromEnv((key) => env[key as keyof Env] as string | undefined);
}

/** Asks the provider that took this top-up for its status. */
function fetchStatus(env: Env, t: TopupRow): Promise<ProviderStatus> {
  return t.network === "card" ? cardProvider(env).fetchStatus(t.identifier) : provider(env).fetchStatus(t.identifier);
}

function audit(env: Env, actor: string | null, action: "insert" | "update", t: TopupRow, changes: Record<string, unknown>) {
  return env.DB.prepare(
    "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'wallets', ?, ?, null, ?, ?)",
  ).bind(nowIso(), actor, action, t.id, t.user_id, JSON.stringify(changes));
}

async function load(env: Env, id: string): Promise<TopupRow | null> {
  return env.DB.prepare("select * from wallet_topups where id = ?").bind(id).first<TopupRow>();
}

/**
 * Sets a status the provider confirmed. Only a pending top-up changes, so a late
 * or replayed callback changes nothing. A success credits the wallet in the same
 * batch: the top-up row takes the booking's id, and the credit and the booking
 * only happen for the request that set it.
 */
async function applyStatus(env: Env, actor: string | null, t: TopupRow, s: ProviderStatus): Promise<TopupRow> {
  if (s.status === "pending") return t;
  if (s.status !== "succeeded" || !t.user_id) {
    // Paid by an account deleted meanwhile: recorded as paid but not credited, for a refund by hand.
    const now = nowIso();
    const updated = await env.DB.prepare(
      `update wallet_topups set status = ?, failure_reason = coalesce(?, failure_reason), provider_reference = coalesce(?, provider_reference),
         paid_at = case when ? = 'succeeded' then ? else paid_at end, updated_at = ?
       where id = ? and status = 'pending' returning *`,
    )
      .bind(s.status, s.failureReason ?? (t.user_id ? null : "account_deleted"), s.providerReference ?? null, s.status, now, now, t.id)
      .first<TopupRow>();
    if (!updated) return (await load(env, t.id)) ?? t;
    await audit(env, actor, "update", updated, { status: [t.status, updated.status] }).run();
    return updated;
  }

  // A transaction number already taken breaks its unique index and rolls the batch back: try another one.
  for (let attempt = 0; ; attempt++) {
    const now = nowIso();
    const txId = uuid();
    const mine = "exists (select 1 from wallet_topups where id = ?1 and wallet_tx_id = ?2)";
    try {
      await env.DB.batch([
        env.DB.prepare(
          `update wallet_topups set status = 'succeeded', wallet_tx_id = ?2, provider_reference = coalesce(?3, provider_reference),
             failure_reason = null, paid_at = ?4, updated_at = ?4
           where id = ?1 and status = 'pending'`,
        ).bind(t.id, txId, s.providerReference ?? null, now),
        env.DB.prepare(`insert into wallets (user_id, created_at, updated_at) select ?3, ?4, ?4 where ${mine} on conflict do nothing`).bind(
          t.id,
          txId,
          t.user_id,
          now,
        ),
        env.DB.prepare(`update wallets set balance_xof = balance_xof + ?3, updated_at = ?4 where user_id = ?5 and ${mine}`).bind(
          t.id,
          txId,
          t.amount_xof,
          now,
          t.user_id,
        ),
        env.DB.prepare(
          `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof,
             counterparty_label, details, created_at)
           select ?2, ?3, ?4, 'topup', 'received', ?5, 0, ?5, (select balance_xof from wallets where user_id = ?4), ?6, ?7, ?8
           where ${mine}`,
        ).bind(
          t.id,
          txId,
          newTrxId("topup"),
          t.user_id,
          t.amount_xof,
          TOPUP_NETWORK_LABEL[t.network],
          JSON.stringify({ topupId: t.id, provider: t.provider, providerReference: s.providerReference ?? t.provider_reference }),
          now,
        ),
        env.DB.prepare(
          `insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes)
           select ?3, ?4, 'wallets', 'update', ?1, null, ?5, ?6 where ${mine}`,
        ).bind(t.id, txId, now, actor, t.user_id, JSON.stringify({ status: [t.status, "succeeded"], amount_xof: t.amount_xof })),
      ]);
    } catch (err) {
      if (/trx_id/.test((err as Error).message ?? "") && attempt < 3) continue;
      throw err;
    }
    return (await load(env, t.id)) ?? t;
  }
}

/**
 * POST /api/wallet/topups { amountXof, network, phone }: asks the person's Flooz/T-Money
 * account for the money, or for network "card" opens a checkout at the card provider
 * (the answer carries its checkoutUrl).
 */
export async function startTopup(env: Env, user: Profile, request: Request): Promise<WalletTopup> {
  const input = await readJson<Partial<TopupInput>>(request);
  await walletAccess(env, user);
  const card = input.network === "card";
  if (!(card ? cardTopupAvailable(env, user) : topupAvailable(env, user))) throw new ApiError("topup_unavailable", 503);
  const amount = parseAmount(input.amountXof);
  if (amount === null) throw new ApiError("invalid_amount");
  if (amount < TOPUP_MIN_XOF) throw new ApiError("amount_too_small");
  if (amount > TOPUP_MAX_XOF) throw new ApiError("amount_too_large");
  // The card provider only takes multiples of 5 francs.
  if (card && amount % 5 !== 0) throw new ApiError("invalid_amount");
  const network = input.network as WalletTopup["network"];
  if (!card && !PAYMENT_NETWORKS.includes(network as PaymentNetwork)) throw new ApiError("bad_request");
  const phone = card ? null : typeof input.phone === "string" ? normalizeTogoPhone(input.phone) : null;
  if (!card && !phone) throw new ApiError("phone_not_allowed");

  const providerName = card ? cardProvider(env).name : provider(env).name;
  const now = nowIso();
  const id = uuid();
  const row: TopupRow = {
    id,
    identifier: `${TOPUP_IDENTIFIER_PREFIX}${id.replace(/-/g, "")}`,
    user_id: user.id,
    amount_xof: amount,
    network,
    phone,
    provider: providerName,
    provider_reference: null,
    status: "pending",
    failure_reason: null,
    wallet_tx_id: null,
    created_at: now,
    paid_at: null,
  };
  await env.DB.batch([
    env.DB.prepare(
      `insert into wallet_topups (id, identifier, user_id, amount_xof, network, phone, provider, status, created_at, updated_at)
       values (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    ).bind(row.id, row.identifier, user.id, amount, network, phone, providerName, now, now),
    audit(env, user.id, "insert", row, { topup: true, amount_xof: amount, network, provider: providerName, status: "pending" }),
  ]);

  try {
    let checkoutUrl: string | null = null;
    let providerReference: string | undefined;
    if (card) {
      const origin = new URL(request.url).origin;
      const started = await cardProvider(env).startCheckout({
        identifier: row.identifier,
        amountXof: amount,
        description: "Recharge portefeuille poinderecharge",
        returnUrl: `${origin}/portefeuille?topup=${id}`,
        notifyUrl: `${origin}/api/payments/callback?key=${encodeURIComponent(env.PAYMENT_CALLBACK_SECRET ?? "")}`,
        customer: { name: user.fullName, email: user.email, phone: user.phone },
      });
      checkoutUrl = started.checkoutUrl;
      providerReference = started.providerReference;
    } else {
      ({ providerReference } = await provider(env).start({
        identifier: row.identifier,
        amountXof: amount,
        phone: phone!,
        network: network as PaymentNetwork,
        description: "poinderecharge portefeuille",
      }));
    }
    if (providerReference) {
      await env.DB.prepare("update wallet_topups set provider_reference = ?, updated_at = ? where id = ?").bind(providerReference, nowIso(), id).run();
      row.provider_reference = providerReference;
    }
    return { ...toTopup(row), checkoutUrl };
  } catch (err) {
    console.error("topup start", row.identifier, err);
    const reason = err instanceof ProviderError ? err.message : "provider_unavailable";
    await applyStatus(env, user.id, row, { status: "failed", failureReason: reason });
    throw new ApiError("provider_unavailable", 502);
  }
}

/** POST /api/wallet/topups/:id/refresh: the app asks while the person confirms on the phone or comes back from the card page. */
export async function refreshTopup(env: Env, user: Profile, id: string): Promise<WalletTopup> {
  const t = await load(env, id);
  if (!t || t.user_id !== user.id) throw new ApiError("not_found", 404);
  if (t.status !== "pending") return toTopup(t);
  try {
    return toTopup(await applyStatus(env, null, t, await fetchStatus(env, t)));
  } catch (err) {
    console.error("topup refresh", t.identifier, err);
    return toTopup(t);
  }
}

/** Called from the shared provider callback (worker/payments.ts) for identifiers starting with "pdw_". */
export async function topupCallback(env: Env, identifier: string): Promise<Response> {
  const t = await env.DB.prepare("select * from wallet_topups where identifier = ?").bind(identifier).first<TopupRow>();
  if (!t || t.status !== "pending") return new Response("ok");
  try {
    await applyStatus(env, null, t, await fetchStatus(env, t));
    return new Response("ok");
  } catch (err) {
    console.error("topup callback", identifier, err);
    return new Response("retry", { status: 503 });
  }
}
