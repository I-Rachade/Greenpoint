// Converted drivers' customer things (migration 0031): their wallet and greenpoints moved to
// a new customer account without phone, e-mail or PIN. The driver, signed in on the driver
// account, gives it a number or address of theirs (a code goes there) and a PIN; from then on
// they sign in to it like to any customer account. Plan phase 5, "Folgen für bestehende Konten".
import type { FormerAccount } from "../shared/drivers";
import type { Profile } from "../shared/types";
import { assertContactFree, checkCode, checkPinFormat, contactColumn, contactOrThrow, deliverCode, hashPin } from "./auth";
import type { Env } from "./env";
import { ApiError, nowIso } from "./http";

interface Row {
  rider_id: string | null;
  cancelled_reservations: number;
  claimed_at: string | null;
}

/** What waits for this driver, or null when nothing was moved or cancelled for them. */
export async function formerAccountOf(db: D1Database, driverId: string): Promise<FormerAccount | null> {
  const row = await db
    .prepare(
      `select f.rider_id, f.cancelled_reservations, f.claimed_at,
         (select balance_xof from wallets w where w.user_id = f.rider_id) as balance,
         (select coalesce(sum(points), 0) from greenpoint_ledger g where g.user_id = f.rider_id) as points
       from former_rider_accounts f where f.driver_id = ?`,
    )
    .bind(driverId)
    .first<Row & { balance: number | null; points: number }>();
  if (!row) return null;
  return {
    balanceXof: row.balance ?? 0,
    points: row.points,
    cancelledReservations: row.cancelled_reservations,
    claimed: !!row.claimed_at,
    claimable: !!row.rider_id && !row.claimed_at,
  };
}

/** The account still waiting to be claimed by this driver. */
async function waiting(env: Env, user: Profile): Promise<string> {
  if (user.role !== "driver") throw new ApiError("forbidden", 403);
  const row = await env.DB.prepare("select rider_id, claimed_at from former_rider_accounts where driver_id = ?")
    .bind(user.id)
    .first<{ rider_id: string | null; claimed_at: string | null }>();
  if (!row?.rider_id || row.claimed_at) throw new ApiError("account_not_found", 404);
  return row.rider_id;
}

/** Sends a code to the number or address the driver wants for their customer account. */
export async function sendFormerAccountCode(env: Env, user: Profile, rawContact: unknown) {
  const riderId = await waiting(env, user);
  const contact = contactOrThrow(rawContact);
  await assertContactFree(env, contact, riderId);
  await deliverCode(env, contact);
}

/** With the code and a new PIN, the waiting account gets the contact and can be signed in to. */
export async function claimFormerAccount(env: Env, user: Profile, input: { contact?: unknown; code?: unknown; pin?: unknown }): Promise<FormerAccount> {
  const riderId = await waiting(env, user);
  const contact = contactOrThrow(input?.contact);
  const pin = String(input?.pin ?? "").trim();
  checkPinFormat(pin);
  await assertContactFree(env, contact, riderId);
  await checkCode(env, contact.value, String(input?.code ?? "").trim());
  const column = contactColumn(contact);
  const now = nowIso();
  let changes = 0;
  try {
    const [claimed] = await env.DB.batch([
      env.DB.prepare(
        `update users set ${column} = ?, pin_hash = ?, pin_failures = 0
         where id = ? and role = 'rider' and phone is null and email is null and pin_hash is null`,
      ).bind(contact.value, await hashPin(pin), riderId),
      env.DB.prepare(
        `update former_rider_accounts set claimed_at = ? where driver_id = ? and claimed_at is null
           and exists (select 1 from users where id = ? and ${column} = ?)`,
      ).bind(now, user.id, riderId, contact.value),
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, ?, 'profiles', 'update', ?, ?, ?)",
      ).bind(now, user.id, riderId, riderId, JSON.stringify({ [column]: contact.value, claimed_by_driver: user.id })),
    ]);
    changes = claimed.meta.changes;
  } catch {
    // Someone took the number or address in the meantime (unique index).
    throw new ApiError("contact_taken", 409);
  }
  if (!changes) throw new ApiError("account_not_found", 404);
  return (await formerAccountOf(env.DB, user.id))!;
}
