import { cleanCardTag, sortCards, type ChargeCard } from "../src/lib/charge-cards";
import type { Profile } from "../src/lib/types";
import { findCustomer } from "./charging";
import { ApiError, nowIso, readJson } from "./http";

// Charging cards (schema: migrations/0042_charge_cards.sql). A swipe reaches us as the
// OCPP idTag of Authorize and StartTransaction (worker/ocpp.ts); a card an admin linked to
// a customer opens that customer's charge (openCardCharge in worker/charging.ts).

/** The idTagInfo status for a card: OCPP 1.6 AuthorizationStatus. */
export type CardStatus = "Accepted" | "Blocked" | "ConcurrentTx" | "Invalid";

/**
 * A card was swiped at a charge point: whether it may charge, and for whom. Remembers the
 * swipe; a card nobody registered yet is added without a customer, so an admin can link it.
 * A card charges only for a customer with no other charge running (ConcurrentTx) and none
 * waiting for payment (Blocked).
 */
export async function swipeCard(db: D1Database, externalId: string, rawTag: string): Promise<{ status: CardStatus; userId: string | null }> {
  const tag = cleanCardTag(rawTag);
  if (!tag) return { status: "Invalid", userId: null };
  const now = nowIso();
  const card = await db
    .prepare(
      `insert into charge_cards (id_tag, created_at, last_swiped_at, last_device_id) values (?1, ?2, ?2, ?3)
       on conflict (id_tag) do update set last_swiped_at = ?2, last_device_id = ?3
       returning user_id, blocked`,
    )
    .bind(tag, now, externalId)
    .first<{ user_id: string | null; blocked: number }>();
  const userId = card?.user_id ?? null;
  if (!userId) return { status: "Invalid", userId: null };
  if (card!.blocked) return { status: "Blocked", userId };
  const open = await db
    .prepare(
      `select coalesce(max(status = 'charging'), 0) as running, coalesce(max(status = 'stopped' and energy_wh > 0), 0) as unpaid
         from charging_sessions where user_id = ?`,
    )
    .bind(userId)
    .first<{ running: number; unpaid: number }>();
  if (open?.running) return { status: "ConcurrentTx", userId };
  if (open?.unpaid) return { status: "Blocked", userId };
  return { status: "Accepted", userId };
}

// Backoffice ----------------------------------------------------------------------------

interface CardRow {
  id_tag: string;
  user_id: string | null;
  label: string | null;
  blocked: number;
  created_at: string;
  last_swiped_at: string | null;
  last_device_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

/** GET /api/admin/charge-cards: every card, the ones still needing a customer first. */
export async function listChargeCards(db: D1Database): Promise<ChargeCard[]> {
  const { results } = await db
    .prepare(
      `select c.*, u.full_name, u.phone, u.email from charge_cards c left join users u on u.id = c.user_id
        order by coalesce(c.last_swiped_at, c.created_at) desc limit 500`,
    )
    .all<CardRow>();
  return sortCards(
    results.map((r) => ({
      idTag: r.id_tag,
      label: r.label,
      blocked: !!r.blocked,
      customer: r.user_id ? { id: r.user_id, fullName: r.full_name, phone: r.phone, email: r.email } : null,
      createdAt: r.created_at,
      lastSwipedAt: r.last_swiped_at,
      lastDevice: r.last_device_id,
    })),
  );
}

function audit(db: D1Database, admin: Profile, action: "insert" | "update" | "delete", tag: string, userId: string | null, changes: object) {
  return db
    .prepare("insert into audit_log (at, actor, table_name, action, row_id, user_id, changes) values (?, ?, 'charge_cards', ?, ?, ?, ?)")
    .bind(nowIso(), admin.id, action, tag, userId, JSON.stringify(changes));
}

/**
 * POST /api/admin/charge-cards { idTag, contact, label? }: links a card to the customer
 * with this phone number or e-mail address, adding the card if no swipe added it yet.
 */
export async function saveChargeCard(db: D1Database, admin: Profile, request: Request) {
  const body = await readJson<{ idTag?: unknown; contact?: unknown; label?: unknown }>(request);
  const tag = cleanCardTag(String(body.idTag ?? ""));
  if (!tag) throw new ApiError("card_invalid");
  const customer = await findCustomer(db, body.contact);
  if (!customer) throw new ApiError("recipient_not_found", 404);
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;
  const before = await db.prepare("select user_id, label from charge_cards where id_tag = ?").bind(tag).first<{ user_id: string | null; label: string | null }>();
  await db.batch([
    db
      .prepare(
        `insert into charge_cards (id_tag, user_id, label, created_by, created_at) values (?1, ?2, ?3, ?4, ?5)
         on conflict (id_tag) do update set user_id = ?2, label = ?3`,
      )
      .bind(tag, customer.id, label, admin.id, nowIso()),
    before
      ? audit(db, admin, "update", tag, customer.id, { user_id: [before.user_id, customer.id], label: [before.label, label] })
      : audit(db, admin, "insert", tag, customer.id, { user_id: customer.id, label }),
  ]);
  return { ok: true };
}

/** POST /api/admin/charge-cards/:tag/block { blocked }: a blocked card no longer starts charges (lost or stolen). */
export async function setChargeCardBlocked(db: D1Database, admin: Profile, rawTag: string, request: Request) {
  const { blocked } = await readJson<{ blocked?: unknown }>(request);
  if (typeof blocked !== "boolean") throw new ApiError("bad_request");
  const tag = cleanCardTag(decodeURIComponent(rawTag));
  const card = tag && (await db.prepare("select user_id, blocked from charge_cards where id_tag = ?").bind(tag).first<{ user_id: string | null; blocked: number }>());
  if (!tag || !card) throw new ApiError("not_found", 404);
  if (!!card.blocked === blocked) return { ok: true };
  await db.batch([
    db.prepare("update charge_cards set blocked = ? where id_tag = ?").bind(blocked ? 1 : 0, tag),
    audit(db, admin, "update", tag, card.user_id, { blocked: [!!card.blocked, blocked] }),
  ]);
  return { ok: true };
}

/** DELETE /api/admin/charge-cards/:tag: forgets the card; swiped again, it is listed again without a customer. */
export async function deleteChargeCard(db: D1Database, admin: Profile, rawTag: string) {
  const tag = cleanCardTag(decodeURIComponent(rawTag));
  const card = tag && (await db.prepare("select user_id, label from charge_cards where id_tag = ?").bind(tag).first<{ user_id: string | null; label: string | null }>());
  if (!tag || !card) throw new ApiError("not_found", 404);
  await db.batch([
    db.prepare("delete from charge_cards where id_tag = ?").bind(tag),
    audit(db, admin, "delete", tag, card.user_id, { user_id: card.user_id, label: card.label }),
  ]);
  return { ok: true };
}
