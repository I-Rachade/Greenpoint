import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { TOPUP_IDENTIFIER_PREFIX, topupCallback } from "./wallet-topups";
import { chargePaymentSucceeded } from "./charging";
import { ApiError, nowIso, uuid } from "./http";
import {
  PAYMENT_NETWORKS,
  ProviderError,
  providerFromEnv,
  safeEqual,
  type PaymentNetwork,
  type PaymentProvider,
  type PaymentStatus,
  type ProviderStatus,
} from "./payment-providers";

// Flooz / T-Money payments for charges at a socket (worker/charging.ts). Reservations and Green
// Credit are not paid with Flooz/T-Money (October 2026); a reservation payment from before still
// settles through the callback.
// The price comes from the station or the charge, never from the app; the provider's callback is only a hint to ask the
// provider for the status. See docs/ZAHLUNGEN.md.

interface PaymentRow {
  id: string;
  identifier: string;
  user_id: string | null;
  station_id: string;
  reservation_id: string | null;
  charging_session_id: string | null;
  amount_xof: number;
  network: PaymentNetwork;
  phone: string | null;
  provider: string;
  provider_reference: string | null;
  status: PaymentStatus;
  failure_reason: string | null;
  created_at: string;
  paid_at: string | null;
}

/** What the app sees of a payment (no provider internals). */
export interface Payment {
  id: string;
  reservationId: string | null;
  stationId: string;
  amountXof: number;
  network: PaymentNetwork;
  status: PaymentStatus;
  failureReason: string | null;
  createdAt: string;
  paidAt: string | null;
}

function toPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    reservationId: r.reservation_id,
    stationId: r.station_id,
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

function audit(env: Env, actor: string | null, action: "insert" | "update", p: PaymentRow, changes: Record<string, unknown>) {
  return env.DB.prepare(
    "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'payments', ?, ?, ?, ?, ?)",
  ).bind(nowIso(), actor, action, p.id, p.station_id, p.user_id, JSON.stringify(changes));
}

/**
 * Sets a status the provider confirmed. Only pending payments change, so a late
 * or replayed callback cannot turn a success into a failure or the other way round.
 */
async function applyStatus(env: Env, actor: string | null, p: PaymentRow, s: ProviderStatus): Promise<PaymentRow> {
  const now = nowIso();
  const updated = await env.DB.prepare(
    `update payments
        set status = ?1,
            provider_reference = coalesce(?2, provider_reference),
            failure_reason = case when ?1 = 'succeeded' then null else coalesce(?3, failure_reason) end,
            paid_at = case when ?1 = 'succeeded' then ?4 else paid_at end,
            updated_at = ?4
      where id = ?5 and status = 'pending'
      returning *`,
  )
    .bind(s.status, s.providerReference ?? null, s.failureReason ?? null, now, p.id)
    .first<PaymentRow>();
  if (!updated) {
    return (await env.DB.prepare("select * from payments where id = ?").bind(p.id).first<PaymentRow>()) ?? p;
  }
  if (updated.status !== p.status) {
    await audit(env, actor, "update", updated, {
      status: [p.status, updated.status],
      ...(updated.failure_reason ? { failure_reason: [p.failure_reason, updated.failure_reason] } : {}),
    }).run();
  }
  // A paid charge is booked once: only the request that moved the payment out of pending gets here.
  if (updated.status === "succeeded" && updated.charging_session_id) {
    await chargePaymentSucceeded(env, { ...updated, charging_session_id: updated.charging_session_id });
  }
  return updated;
}

/** Whether a customer can pay a charge with Flooz/T-Money: never against the simulated provider, except admins testing. */
export function mobilePaymentOffered(env: Env, user: Profile): boolean {
  return provider(env).name !== "mock" || user.role === "admin";
}

/** A charge's Flooz/T-Money payment; the caller checked the charge and computed the amount. */
export async function startChargePayment(
  env: Env,
  user: Profile,
  charge: { sessionId: string; stationId: string; amountXof: number },
  body: { network?: unknown; phone?: unknown },
): Promise<Payment> {
  const network = body.network as PaymentNetwork;
  if (!PAYMENT_NETWORKS.includes(network)) throw new ApiError("bad_request");
  const phone = typeof body.phone === "string" ? normalizeTogoPhone(body.phone) : null;
  if (!phone) throw new ApiError("phone_not_allowed");
  return createPayment(env, user, { stationId: charge.stationId, reservationId: null, sessionId: charge.sessionId, amountXof: charge.amountXof, network, phone });
}

async function createPayment(
  env: Env,
  user: Profile,
  input: { stationId: string; reservationId: string | null; sessionId: string | null; amountXof: number; network: PaymentNetwork; phone: string },
): Promise<Payment> {
  const { network, phone } = input;
  const price = input.amountXof;
  const pay = provider(env);
  const now = nowIso();
  const id = uuid();
  const row: PaymentRow = {
    id,
    identifier: `pdr_${id.replace(/-/g, "")}`,
    user_id: user.id,
    station_id: input.stationId,
    reservation_id: input.reservationId,
    charging_session_id: input.sessionId,
    amount_xof: price,
    network,
    phone,
    provider: pay.name,
    provider_reference: null,
    status: "pending",
    failure_reason: null,
    created_at: now,
    paid_at: null,
  };
  try {
    await env.DB.batch([
      env.DB.prepare(
        `insert into payments (id, identifier, user_id, station_id, reservation_id, charging_session_id, amount_xof, network, phone, provider, status, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).bind(row.id, row.identifier, row.user_id, row.station_id, row.reservation_id, row.charging_session_id, row.amount_xof, network, phone, pay.name, now, now),
      audit(env, user.id, "insert", row, { amount_xof: price, network, provider: pay.name, status: "pending" }),
    ]);
  } catch (err) {
    if (String(err).includes("UNIQUE")) throw new ApiError("payment_exists", 409);
    throw err;
  }

  try {
    const { providerReference } = await pay.start({
      identifier: row.identifier,
      amountXof: price,
      phone,
      network,
      description: "poinderecharge",
    });
    if (providerReference) {
      await env.DB.prepare("update payments set provider_reference = ?, updated_at = ? where id = ?")
        .bind(providerReference, nowIso(), id)
        .run();
      row.provider_reference = providerReference;
    }
    return toPayment(row);
  } catch (err) {
    console.error("payment start", row.identifier, err);
    const reason = err instanceof ProviderError ? err.message : "provider_unavailable";
    await applyStatus(env, user.id, row, { status: "failed", failureReason: reason });
    throw new ApiError("provider_unavailable", 502);
  }
}

/** POST /api/payments/:id/refresh: the app asks again when the callback is late. */
export async function refreshPayment(env: Env, user: Profile, id: string): Promise<Payment> {
  const p = await env.DB.prepare("select * from payments where id = ?").bind(id).first<PaymentRow>();
  if (!p || p.user_id !== user.id) throw new ApiError("not_found", 404);
  if (p.status !== "pending") return toPayment(p);
  try {
    const s = await provider(env).fetchStatus(p.identifier);
    return toPayment(s.status === "pending" ? p : await applyStatus(env, null, p, s));
  } catch (err) {
    console.error("payment refresh", p.identifier, err);
    return toPayment(p);
  }
}

/** GET /api/payments/mine: the customer's payments, newest first. */
export async function myPayments(env: Env, user: Profile): Promise<Payment[]> {
  const { results } = await env.DB.prepare("select * from payments where user_id = ? order by created_at desc limit 50")
    .bind(user.id)
    .all<PaymentRow>();
  return results.map(toPayment);
}

async function readIdentifier(request: Request): Promise<string | null> {
  let value: unknown;
  if ((request.headers.get("Content-Type") ?? "").includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    value = body?.identifier ?? body?.cpm_trans_id;
  } else {
    // PayGate sends "identifier", CinetPay (cards) "cpm_trans_id".
    const form = new URLSearchParams(await request.text());
    value = form.get("identifier") ?? form.get("cpm_trans_id");
  }
  return typeof value === "string" && value.length > 0 && value.length <= 100 ? value : null;
}

/**
 * POST /api/payments/callback?key=<PAYMENT_CALLBACK_SECRET>: the provider reports a
 * change. Anyone can post here, so the body only names the payment; its status
 * is fetched from the provider itself. A non-2xx answer makes the provider retry.
 */
export async function paymentCallback(env: Env, request: Request): Promise<Response> {
  const key = new URL(request.url).searchParams.get("key") ?? "";
  if (!env.PAYMENT_CALLBACK_SECRET || !safeEqual(key, env.PAYMENT_CALLBACK_SECRET)) {
    return new Response("forbidden", { status: 403 });
  }
  const identifier = await readIdentifier(request);
  if (!identifier) return new Response("bad request", { status: 400 });
  if (identifier.startsWith(TOPUP_IDENTIFIER_PREFIX)) return topupCallback(env, identifier);

  const p = await env.DB.prepare("select * from payments where identifier = ?").bind(identifier).first<PaymentRow>();
  // Unknown or already settled: acknowledge so the provider stops retrying.
  if (!p || p.status !== "pending") return new Response("ok");
  try {
    const s = await provider(env).fetchStatus(identifier);
    if (s.status !== "pending") await applyStatus(env, null, p, s);
    return new Response("ok");
  } catch (err) {
    console.error("payment callback", identifier, err);
    return new Response("retry", { status: 503 });
  }
}
