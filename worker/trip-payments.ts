import { owedToDriver, PAYOUT_NETWORKS, TRIP_PAYMENTS, type AdminDriverPayout, type DriverPayout, type PayoutNetwork, type TripPayment } from "../shared/drivers";
import { normalizeTogoPhone } from "../shared/phone";
import type { Profile } from "../shared/types";
import { newTrxId } from "../shared/wallet";
import { ApiError, nowIso, uuid } from "./http";
import { notifyUser } from "./notify";
import type { ParcelCtx } from "./parcels";
import { walletAccess } from "./wallet";

// Driver phase 2 (planung/fahrer.md): paying a trip online and payouts to the driver's phone.
//
// Online means from the wallet, which the customer tops up with Flooz or T-Money (wallet-topups.ts):
// the fare leaves the wallet when the trip is booked and comes back when the trip does not
// happen (called off, no driver, nobody home for a home delivery). The driver then takes no
// cash for it, and still earns their share. Payouts: PayGate has no API to send money, so an
// admin sends it from our merchant account and marks the request paid here.

export function cleanPayWith(value: unknown): TripPayment {
  if (value === undefined || value === null) return "cash";
  if (!TRIP_PAYMENTS.includes(value as TripPayment)) throw new ApiError("bad_request");
  // Green Credit pays energy only (0047): trips are paid in cash. Trips paid before still get refunds.
  if (value === "wallet") throw new ApiError("payment_not_offered", 409);
  return value as TripPayment;
}

/** The columns a payment needs from a trip row. */
export interface PrepaidRow {
  id: string;
  customer_user_id: string | null;
  collect_fcfa: number;
  prepaid_fcfa?: number | null;
  prepaid_refunded_at?: string | null;
}

/** The online payment still held for the trip (0 for cash, or once refunded). */
export function heldPrepaid(r: PrepaidRow): number {
  return r.prepaid_refunded_at ? 0 : (r.prepaid_fcfa ?? 0);
}

/** Cash the driver takes for the trip: what it costs minus what was paid online. */
export function cashDue(r: PrepaidRow): number {
  return Math.max(0, r.collect_fcfa - heldPrepaid(r));
}

/**
 * The statements that take the fare from the customer's wallet for a trip saved in the same
 * batch (after its insert). The balance check of wallets makes the whole batch fail when the
 * money is not there; the caller turns that into insufficient_balance (walletFailure).
 */
export async function walletPayment(c: Pick<ParcelCtx, "db" | "env">, user: Profile, jobId: string, amount: number, label: string): Promise<D1PreparedStatement[]> {
  await walletAccess(c.env, user);
  const wallet = await c.db.prepare("select balance_xof, status from wallets where user_id = ?").bind(user.id).first<{ balance_xof: number; status: string }>();
  if (wallet?.status === "frozen") throw new ApiError("wallet_frozen", 403);
  if (!wallet || wallet.balance_xof < amount) throw new ApiError("insufficient_balance");
  const now = nowIso();
  return [
    c.db.prepare("update wallets set balance_xof = balance_xof - ?, updated_at = ? where user_id = ?").bind(amount, now, user.id),
    c.db
      .prepare(
        `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof, counterparty_label, details, created_at)
         values (?1, ?2, ?3, 'trip', 'send', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7)`,
      )
      .bind(uuid(), newTrxId("trip"), user.id, amount, label, JSON.stringify({ job: jobId }), now),
    c.db.prepare("update delivery_jobs set prepaid_fcfa = ? where id = ?").bind(amount, jobId),
  ];
}

/** A failed wallet payment inside a booking batch, as the error the app knows. */
export function walletFailure(err: unknown): never {
  if (/CHECK constraint failed/i.test(String(err))) throw new ApiError("insufficient_balance");
  throw err;
}

/**
 * Gives an online payment back to the wallet when the trip did not happen. Each statement
 * only applies while the trip is not refunded yet, so running it twice pays back once.
 */
export function refundStatements(db: D1Database, job: PrepaidRow, label: string): D1PreparedStatement[] {
  const amount = heldPrepaid(job);
  if (!amount || !job.customer_user_id) return [];
  const now = nowIso();
  const open = "(select prepaid_refunded_at from delivery_jobs where id = ?) is null";
  return [
    db.prepare(`update wallets set balance_xof = balance_xof + ?, updated_at = ? where user_id = ? and ${open}`).bind(amount, now, job.customer_user_id, job.id),
    db
      .prepare(
        `insert into wallet_transactions (id, trx_id, user_id, type, attribute, amount_xof, fee_xof, total_xof, balance_after_xof, counterparty_label, details, created_at)
         select ?1, ?2, ?3, 'trip', 'received', ?4, 0, ?4, (select balance_xof from wallets where user_id = ?3), ?5, ?6, ?7
          where (select prepaid_refunded_at from delivery_jobs where id = ?8) is null`,
      )
      .bind(uuid(), newTrxId("trip"), job.customer_user_id, amount, label, JSON.stringify({ job: job.id, refund: true }), now, job.id),
    db.prepare("update delivery_jobs set prepaid_refunded_at = ? where id = ? and prepaid_refunded_at is null").bind(now, job.id),
  ];
}

// Payouts --------------------------------------------------------------------------------

interface PayoutRow {
  id: string;
  driver_id: string;
  amount_fcfa: number;
  network: PayoutNetwork;
  phone: string;
  status: DriverPayout["status"];
  reference: string | null;
  requested_at: string;
  decided_at: string | null;
}

function toPayout(r: PayoutRow): DriverPayout {
  return {
    id: r.id,
    amountFcfa: r.amount_fcfa,
    network: r.network,
    phone: r.phone,
    status: r.status,
    reference: r.reference,
    requestedAt: r.requested_at,
    decidedAt: r.decided_at,
  };
}

/** The open request of a driver, else their last one decided in the past week (so they see it went through). */
export async function payoutOf(db: D1Database, driverId: string): Promise<DriverPayout | null> {
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const row = await db
    .prepare(
      `select * from driver_payouts where driver_id = ? and (status = 'requested' or decided_at >= ?)
        order by status = 'requested' desc, requested_at desc limit 1`,
    )
    .bind(driverId, week)
    .first<PayoutRow>();
  return row ? toPayout(row) : null;
}

export async function hasOpenPayout(db: D1Database, driverId: string): Promise<boolean> {
  return !!(await db.prepare("select 1 from driver_payouts where driver_id = ? and status = 'requested'").bind(driverId).first());
}

/** The driver asks for what we owe them on Flooz or T-Money. The amount is the balance now. */
export async function requestPayout(c: ParcelCtx, driverId: string, balance: number, input: unknown): Promise<DriverPayout> {
  const { network, phone: rawPhone } = (input ?? {}) as { network?: unknown; phone?: unknown };
  if (!PAYOUT_NETWORKS.includes(network as PayoutNetwork)) throw new ApiError("bad_request");
  const phone = normalizeTogoPhone(String(rawPhone ?? ""));
  if (!phone) throw new ApiError("phone_not_allowed");
  const amount = owedToDriver(balance);
  if (!amount) throw new ApiError("nothing_owed");
  const row: PayoutRow = {
    id: uuid(),
    driver_id: driverId,
    amount_fcfa: amount,
    network: network as PayoutNetwork,
    phone,
    status: "requested",
    reference: null,
    requested_at: nowIso(),
    decided_at: null,
  };
  try {
    await c.db.batch([
      c.db
        .prepare("insert into driver_payouts (id, driver_id, amount_fcfa, network, phone, status, requested_at) values (?, ?, ?, ?, ?, 'requested', ?)")
        .bind(row.id, driverId, amount, row.network, phone, row.requested_at),
      c.audit(driverId, "driver_ledger", "insert", row.id, { payout_requested: amount, network: row.network }, { userId: driverId }),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("payout_pending");
    throw err;
  }
  return toPayout(row);
}

/** Backoffice: open requests first, then the latest decided ones. */
export async function adminPayouts(c: ParcelCtx): Promise<AdminDriverPayout[]> {
  await c.requireAdmin();
  const { results } = await c.db
    .prepare(
      `select p.*, d.full_name as driver_name, u.phone as driver_phone,
              (select coalesce(sum(case when l.kind = 'collected' then l.amount_fcfa else -l.amount_fcfa end), 0)
                 from driver_ledger l where l.driver_id = p.driver_id) as balance
         from driver_payouts p
         left join drivers d on d.user_id = p.driver_id
         left join users u on u.id = p.driver_id
        order by p.status = 'requested' desc, p.requested_at desc limit 100`,
    )
    .all<PayoutRow & { driver_name: string | null; driver_phone: string | null; balance: number }>();
  return results.map((r) => ({ ...toPayout(r), driverId: r.driver_id, driverName: r.driver_name ?? "", driverPhone: r.driver_phone, balanceFcfa: r.balance }));
}

/**
 * An admin sent the money (paid, with the provider's reference) or refused the request.
 * Paid settles the amount in the driver's ledger, like a payout at a station.
 */
export async function decidePayout(c: ParcelCtx, id: string, input: unknown): Promise<{ ok: true }> {
  const admin = await c.requireAdmin();
  const { status, reference } = (input ?? {}) as { status?: unknown; reference?: unknown };
  if (status !== "paid" && status !== "rejected") throw new ApiError("bad_request");
  const ref = typeof reference === "string" ? reference.trim().slice(0, 80) || null : null;
  const now = nowIso();
  const row = await c.db
    .prepare("update driver_payouts set status = ?, reference = ?, decided_at = ?, decided_by = ? where id = ? and status = 'requested' returning *")
    .bind(status, ref, now, admin.id, id)
    .first<PayoutRow>();
  if (!row) throw new ApiError("payout_not_open", 409);
  await c.db.batch([
    ...(status === "paid"
      ? [
          c.db
            .prepare("insert into driver_ledger (id, driver_id, at, kind, amount_fcfa, job_id, station_id, actor) values (?, ?, ?, 'settlement', ?, null, null, ?)")
            .bind(uuid(), row.driver_id, now, -row.amount_fcfa, admin.id),
        ]
      : []),
    c.audit(admin.id, "driver_ledger", "update", row.id, { payout: ["requested", status], amount_fcfa: row.amount_fcfa, reference: ref }, { userId: row.driver_id }),
  ]);
  const network = row.network === "flooz" ? "Flooz" : "T-Money";
  await notifyUser(
    c.env,
    row.driver_id,
    status === "paid"
      ? {
          subject: "Paiement envoyé",
          text: `poinderecharge : ${row.amount_fcfa} FCFA vous ont été envoyés sur ${network} (${row.phone})${ref ? `, référence ${ref}` : ""}. Votre solde est mis à jour : https://app.poinderecharge.com/chauffeur`,
        }
      : {
          subject: "Demande de paiement refusée",
          text: `poinderecharge : votre demande de ${row.amount_fcfa} FCFA sur ${network} n'a pas pu être payée. Vous pouvez être payé à une station ou refaire la demande : https://app.poinderecharge.com/chauffeur`,
        },
  );
  return { ok: true };
}
