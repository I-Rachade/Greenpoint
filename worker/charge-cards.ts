import { cardTagVariants, cleanCardTag, sortCards, validAdjustment, type ChargeCard, type CounterCard } from "../src/lib/charge-cards";
import type { Profile } from "../src/lib/types";
import { findCustomer, linkedCardCredit, socketIsOurs, stopCardCharges } from "./charging";
import { withCounterCodeTry } from "./code-tries";
import type { Env } from "./env";
import { ApiError, nowIso, readJson, uuid } from "./http";
import { notCustomerRole } from "./roles";
import { cardOwnerCredit } from "./wallet";

// Charging cards with their own credit (schema: migrations/0042_charge_cards.sql). A swipe
// reaches us as the OCPP idTag of Authorize and StartTransaction (worker/ocpp.ts); a card with
// enough credit opens a charge (openCardCharge in worker/charging.ts), which is stopped when
// the credit is used up (cardStops) and paid from the card when it ends (settleCardCharges).
// A card linked to an account pays with the account's Green Credit instead (0047), and like
// Green Credit only on a socket of ours: a point partner's socket refuses every card.
// Since the card rule of October 2026, a card charges only once it is linked to an account:
// one account may have several cards, all paying with its Green Credit, which is loaded with
// the customer's one-time QR code only (worker/wallet.ts topUpCredit). Cards are no longer
// topped up; an old card credit can only be corrected or refunded by an admin.

/**
 * The number a card is stored under: its own if known, else the stored spelling of the same
 * card (decimal printed number or hex chip id, see cardTagVariants), else the tag itself.
 */
async function storedTag(db: D1Database, tag: string): Promise<string> {
  const variants = cardTagVariants(tag);
  const { results } = await db
    .prepare(`select id_tag from charge_cards where id_tag in (${variants.map(() => "?").join(", ")})`)
    .bind(...variants)
    .all<{ id_tag: string }>();
  const found = new Set(results.map((r) => r.id_tag));
  return variants.find((v) => found.has(v)) ?? tag;
}

/** The idTagInfo status for a card: OCPP 1.6 AuthorizationStatus. */
export type CardStatus = "Accepted" | "Blocked" | "ConcurrentTx" | "Invalid";

/**
 * A card was swiped at a charge point: whether it may charge. Remembers the swipe, and adds
 * a card seen for the first time, so its number shows in the backoffice to be linked to an
 * account. A card charges when it is linked to an account, not blocked, has no other charge
 * running, and the account may spend its Green Credit and it covers the minimum price
 * (linkedCardCredit: a customer's account with the module on, never a driver's, staff's,
 * merchant's or fleet manager's), which it then may spend (`creditXof`: the balance up to the
 * charge hold cap, the charge's limit); `balanceXof` is the whole balance, for a balance inquiry.
 */
export async function swipeCard(
  db: D1Database,
  externalId: string,
  rawTag: string,
): Promise<{ status: CardStatus; tag: string | null; userId: string | null; creditXof?: number; balanceXof?: number }> {
  const clean = cleanCardTag(rawTag);
  if (!clean) return { status: "Invalid", tag: null, userId: null };
  const tag = await storedTag(db, clean);
  const now = nowIso();
  const card = await db
    .prepare(
      `insert into charge_cards (id_tag, created_at, last_swiped_at, last_device_id) values (?1, ?2, ?2, ?3)
       on conflict (id_tag) do update set last_swiped_at = ?2, last_device_id = ?3
       returning user_id, blocked, balance_xof`,
    )
    .bind(tag, now, externalId)
    .first<{ user_id: string | null; blocked: number; balance_xof: number }>();
  const userId = card?.user_id ?? null;
  if (!card || card.blocked) return { status: "Blocked", tag, userId };
  const running = await db.prepare("select 1 from charging_sessions where charge_card = ? and status = 'charging'").bind(tag).first();
  if (running) return { status: "ConcurrentTx", tag, userId };
  const device = await db.prepare("select station_id from devices where external_id = ?").bind(externalId).first<{ station_id: string }>();
  if (!device || !(await socketIsOurs(db, externalId))) return { status: "Blocked", tag, userId };
  if (!userId) return { status: "Blocked", tag, userId };
  const credit = await linkedCardCredit(db, userId, device.station_id);
  if (credit === null) return { status: "Blocked", tag, userId };
  const wallet = await db.prepare("select balance_xof from wallets where user_id = ?").bind(userId).first<{ balance_xof: number }>();
  return { status: "Accepted", tag, userId, creditXof: credit, balanceXof: wallet?.balance_xof ?? credit };
}

/**
 * Books a credit or debit on a card in one batch: the balance and its history line. `guard`
 * (optional) must hold for both to apply, e.g. that the charge was paid by this booking.
 */
export function cardBooking(
  db: D1Database,
  entry: { tag: string; type: "topup" | "charge" | "adjust"; amountXof: number; stationId: string | null; sessionId?: string; reason?: string | null; by: string | null },
  guard?: { sql: string; params: unknown[] },
): D1PreparedStatement[] {
  const now = nowIso();
  const where = guard ? ` and ${guard.sql}` : "";
  const params = guard?.params ?? [];
  return [
    db.prepare(`update charge_cards set balance_xof = balance_xof + ? where id_tag = ?${where}`).bind(entry.amountXof, entry.tag, ...params),
    db
      .prepare(
        `insert into charge_card_transactions (id, id_tag, type, amount_xof, balance_after_xof, station_id, charging_session_id, reason, created_by, created_at)
         select ?, ?, ?, ?, balance_xof, ?, ?, ?, ?, ? from charge_cards where id_tag = ?${where}`,
      )
      .bind(uuid(), entry.tag, entry.type, entry.amountXof, entry.stationId, entry.sessionId ?? null, entry.reason ?? null, entry.by, now, entry.tag, ...params),
  ];
}

function counterCard(r: { id_tag: string; user_id?: string | null; label: string | null; blocked: number; balance_xof: number }): CounterCard {
  return { idTag: r.id_tag, label: r.label, blocked: !!r.blocked, balanceXof: r.balance_xof, ...(r.user_id ? { linked: true } : {}) };
}

/** How long after a swipe at a station its staff still see the card's owner and credit. */
const COUNTER_CARD_HOURS = 24;

async function loadCard(db: D1Database, rawTag: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawTag);
  } catch {
    throw new ApiError("card_unknown", 404);
  }
  const clean = cleanCardTag(decoded);
  const tag = clean && (await storedTag(db, clean));
  const card =
    tag &&
    (await db
      .prepare("select id_tag, user_id, label, blocked, balance_xof from charge_cards where id_tag = ?")
      .bind(tag)
      .first<{ id_tag: string; user_id: string | null; label: string | null; blocked: number; balance_xof: number }>());
  if (!card) throw new ApiError("card_unknown", 404);
  return card;
}

// Station counter ---------------------------------------------------------------------------

type StaffCheck = (user: Profile, stationId: string) => Promise<boolean>;

/**
 * GET /api/stations/:id/charge-cards/:tag: a card at the counter. Staff see whether it is linked
 * and blocked; whose it is, its name and the credit only when it was swiped at this station in
 * the last COUNTER_CARD_HOURS or is in a charge here, so a card number alone tells nobody whose
 * card it is or how much credit is on the account. Unknown numbers count as wrong tries
 * (worker/code-tries.ts), so staff cannot try out card numbers.
 */
export async function counterCardInfo(db: D1Database, user: Profile, isStaffOf: StaffCheck, stationId: string, rawTag: string): Promise<CounterCard> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const card = await withCounterCodeTry(db, user.id, "card", () => loadCard(db, rawTag));
  const seenHere = await db
    .prepare(
      `select 1 from charge_cards c
        where c.id_tag = ?1 and (
          (c.last_swiped_at > ?3 and exists (select 1 from devices d where d.external_id = c.last_device_id and d.station_id = ?2))
          or exists (select 1 from charging_sessions cs where cs.charge_card = c.id_tag and cs.station_id = ?2 and (cs.status in ('charging', 'stopped') or cs.started_at > ?3)))`,
    )
    .bind(card.id_tag, stationId, new Date(Date.now() - COUNTER_CARD_HOURS * 3_600_000).toISOString())
    .first();
  if (!seenHere) return { idTag: card.id_tag, label: null, blocked: !!card.blocked, ...(card.user_id ? { linked: true } : {}) };
  // A linked card shows the account's Green Credit, which it pays with (loaded with the customer's QR code only).
  return card.user_id ? { ...counterCard(card), ...(await cardOwnerCredit(db, card.user_id)) } : counterCard(card);
}

/** Cash put on cards at this station since `since`, for the station's takings. */
export async function cardTopupsSince(db: D1Database, stationId: string, since: string): Promise<number> {
  const row = await db
    .prepare("select coalesce(sum(amount_xof), 0) as total from charge_card_transactions where station_id = ? and type = 'topup' and created_at >= ?")
    .bind(stationId, since)
    .first<{ total: number }>();
  return row?.total ?? 0;
}

// Backoffice ----------------------------------------------------------------------------

interface CardRow {
  id_tag: string;
  user_id: string | null;
  label: string | null;
  blocked: number;
  balance_xof: number;
  created_at: string;
  last_swiped_at: string | null;
  last_device_id: string | null;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

/** GET /api/admin/charge-cards: every card, the most recently swiped first. */
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
      balanceXof: r.balance_xof,
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
 * POST /api/admin/charge-cards { idTag, contact?, label? }: adds a card by its number, or
 * changes its name and the customer it belongs to (empty contact: nobody).
 */
export async function saveChargeCard(db: D1Database, admin: Profile, request: Request) {
  const body = await readJson<{ idTag?: unknown; contact?: unknown; label?: unknown }>(request);
  const clean = cleanCardTag(String(body.idTag ?? ""));
  if (!clean) throw new ApiError("card_invalid");
  const tag = await storedTag(db, clean);
  const contact = typeof body.contact === "string" ? body.contact.trim() : "";
  const customer = contact ? await findCustomer(db, contact) : null;
  if (contact && !customer) throw new ApiError("recipient_not_found", 404);
  // Every card belongs to an account: it pays with that account's Green Credit.
  if (!customer) throw new ApiError("card_needs_account");
  // Only a customer's account (or an admin's, to test): drivers, staff, merchants and fleet managers have no Green Credit.
  if (notCustomerRole(customer.role)) throw new ApiError("not_a_customer", 409);
  const userId = customer.id;
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 60) : null;
  const before = await db.prepare("select user_id, label from charge_cards where id_tag = ?").bind(tag).first<{ user_id: string | null; label: string | null }>();
  await db.batch([
    db
      .prepare(
        `insert into charge_cards (id_tag, user_id, label, created_by, created_at) values (?1, ?2, ?3, ?4, ?5)
         on conflict (id_tag) do update set user_id = ?2, label = ?3`,
      )
      .bind(tag, userId, label, admin.id, nowIso()),
    before
      ? audit(db, admin, "update", tag, userId, { user_id: [before.user_id, userId], label: [before.label, label] })
      : audit(db, admin, "insert", tag, userId, { user_id: userId, label }),
  ]);
  return { ok: true };
}

/** POST /api/admin/charge-cards/:tag/balance { amountXof, reason }: corrects a card's credit, either way. */
export async function adjustChargeCard(db: D1Database, admin: Profile, rawTag: string, request: Request) {
  const body = await readJson<{ amountXof?: unknown; reason?: unknown }>(request);
  const amount = Number(body.amountXof);
  const reason = typeof body.reason === "string" ? body.reason.trim().slice(0, 120) : "";
  if (!validAdjustment(amount) || !reason) throw new ApiError("bad_request");
  const card = await loadCard(db, rawTag);
  await db.batch([
    ...cardBooking(db, { tag: card.id_tag, type: "adjust", amountXof: amount, stationId: null, reason, by: admin.id }),
    audit(db, admin, "update", card.id_tag, card.user_id, { adjust: amount, reason, balance: [card.balance_xof, card.balance_xof + amount] }),
  ]);
  return { ok: true };
}

/**
 * POST /api/admin/charge-cards/:tag/block { blocked }: a blocked card starts no charge and takes
 * no top-up (lost or stolen); its credit stays. A charge it is running is stopped right away.
 */
export async function setChargeCardBlocked(env: Env, admin: Profile, rawTag: string, request: Request) {
  const db = env.DB;
  const { blocked } = await readJson<{ blocked?: unknown }>(request);
  if (typeof blocked !== "boolean") throw new ApiError("bad_request");
  const card = await loadCard(db, rawTag);
  if (!!card.blocked !== blocked) {
    await db.batch([
      db.prepare("update charge_cards set blocked = ? where id_tag = ?").bind(blocked ? 1 : 0, card.id_tag),
      audit(db, admin, "update", card.id_tag, card.user_id, { blocked: [!!card.blocked, blocked] }),
    ]);
  }
  // Also when it was blocked already: a charge that slipped through still stops.
  if (blocked) await stopCardCharges(env, card.id_tag, admin.id);
  return { ok: true };
}

/** DELETE /api/admin/charge-cards/:tag: forgets a card without credit; its history stays. */
export async function deleteChargeCard(db: D1Database, admin: Profile, rawTag: string) {
  const card = await loadCard(db, rawTag);
  if (card.balance_xof !== 0) throw new ApiError("card_has_balance", 409);
  await db.batch([
    db.prepare("delete from charge_cards where id_tag = ? and balance_xof = 0").bind(card.id_tag),
    audit(db, admin, "delete", card.id_tag, card.user_id, { user_id: card.user_id, label: card.label }),
  ]);
  return { ok: true };
}
