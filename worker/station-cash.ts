// Station types and the daily cash handover (migration 0045): what a partner station took for
// poinderecharge, its closings and the admin's confirmation, the host's commission and the
// late alert. At our own stations (0051, 0057): the cash each staff member took at the counter
// (Green Credit top-ups, swaps, charges, parcels), closed per staff member. Types and the balance rule: src/lib/station-cash.ts.

import type { AuditTable } from "../src/lib/admin/types";
import {
  cleanCommissionMode,
  cleanSwapOwner,
  handoverInputError,
  HANDOVER_NOTE_MAX,
  monthStartOf,
  stationCash,
  validCommissionPct,
  type CashHandover,
  type CashItem,
  type CashKind,
  type CommissionItem,
  type HandoverInput,
  type HandoverMethod,
  type HandoverStatus,
  type StationCash,
  type StationCashSettings,
  type SwapOwner,
} from "../src/lib/station-cash";
import type { Profile } from "../src/lib/types";
import { personLabel } from "../src/lib/wallet";
import type { Env } from "./env";
import { ApiError, nowIso, uuid } from "./http";
import { notifyUser } from "./notify";
import { backofficeStations } from "./owner";

interface CashCtx {
  db: D1Database;
  requireUser(): Promise<Profile>;
  requireAdmin(): Promise<Profile>;
  isStaffOf(user: Profile, stationId: string): Promise<boolean>;
  audit(
    actor: string | null,
    table: AuditTable,
    action: "insert" | "update" | "delete",
    rowId: string,
    changes: Record<string, unknown>,
    ids?: { stationId?: string | null; userId?: string | null },
  ): D1PreparedStatement;
}

/**
 * Who owned a swap_log row `l` (station `s`, operator `o`): its own owner, else the station's
 * rule at the time it is read (older swaps, before 0045).
 */
export const SWAP_OWNER_SQL = `coalesce(l.owner, case when coalesce(o.is_own, 0) = 1 then 'poinderecharge' else coalesce(s.swap_owner, 'operator') end)`;

interface StationRow {
  id: string;
  name: string;
  operator_name: string;
  swap_owner: SwapOwner | null;
  commission_pct: number;
  commission_mode: string;
  start: string;
}

interface HandoverRow {
  id: string;
  station_id: string;
  period_from: string;
  period_until: string;
  cash_xof: number;
  carry_xof: number;
  commission_xof: number;
  due_xof: number;
  amount_xof: number;
  method: HandoverMethod;
  reference: string;
  note: string | null;
  status: HandoverStatus;
  created_by: string;
  created_at: string;
  decided_by: string | null;
  decided_at: string | null;
  reject_reason: string | null;
  staff_id: string | null;
  c_name: string | null;
  c_phone: string | null;
  c_email: string | null;
  d_name: string | null;
  d_phone: string | null;
  d_email: string | null;
}

const HANDOVER_SELECT = `select h.*, cu.full_name as c_name, cu.phone as c_phone, cu.email as c_email,
  du.full_name as d_name, du.phone as d_phone, du.email as d_email
  from cash_handovers h left join users cu on cu.id = h.created_by left join users du on du.id = h.decided_by`;

const label = (name: string | null, phone: string | null, email: string | null) =>
  name || phone || email ? personLabel({ fullName: name, phone, email }) : null;

function toHandover(r: HandoverRow): CashHandover {
  return {
    id: r.id,
    stationId: r.station_id,
    periodFrom: r.period_from,
    periodUntil: r.period_until,
    cashXof: r.cash_xof,
    carryXof: r.carry_xof,
    commissionXof: r.commission_xof,
    dueXof: r.due_xof,
    amountXof: r.amount_xof,
    method: r.method,
    reference: r.reference,
    note: r.note,
    status: r.status,
    createdBy: label(r.c_name, r.c_phone, r.c_email) ?? "?",
    createdAt: r.created_at,
    decidedBy: label(r.d_name, r.d_phone, r.d_email),
    decidedAt: r.decided_at,
    rejectReason: r.reject_reason,
    staffId: r.staff_id,
  };
}

const IN = (n: number) => `(select value from json_each(?${n}))`;

/**
 * The balance of partner stations (operators that are not ours), from their rows. Our own
 * stations are counted per staff member (cashOfOwnStations). `ids` null: every partner station.
 */
export async function cashOfStations(db: D1Database, ids: string[] | null, now = new Date()): Promise<StationCash[]> {
  const { results: stations } = await db
    .prepare(
      `select s.id, s.name, o.name as operator_name, s.swap_owner, s.commission_pct, s.commission_mode,
              coalesce(s.cash_since, s.created_at) as start
       from stations s join operators o on o.id = s.operator_id
       where coalesce(o.is_own, 0) = 0 and (?1 is null or s.id in ${IN(1)})
       order by s.name`,
    )
    .bind(ids ? JSON.stringify(ids) : null)
    .all<StationRow>();
  if (!stations.length) return [];
  const list = JSON.stringify(stations.map((s) => s.id));
  const monthStart = monthStartOf(now);
  const from = stations.reduce((a, s) => (s.start < a ? s.start : a), monthStart);
  const [charges, swaps, parcels, drivers, cards, credit, chargeSales, swapSales, handovers] = await Promise.all([
    db
      .prepare(`select station_id, paid_at as at, amount_xof as amount from charging_sessions where station_id in ${IN(1)} and status = 'paid' and payment_method = 'cash' and paid_at >= ?2`)
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    db
      .prepare(
        `select l.station_id, l.created_at as at, l.amount_xof as amount from swap_log l
         join stations s on s.id = l.station_id left join operators o on o.id = s.operator_id
         where l.station_id in ${IN(1)} and l.payment = 'cash' and l.created_at >= ?2 and ${SWAP_OWNER_SQL} = 'poinderecharge'`,
      )
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    db
      .prepare(
        `select from_station_id as station_id, paid_at as at, price_fcfa as amount from parcels
         where from_station_id in ${IN(1)} and payment_method = 'cash' and paid_at >= ?2 and status <> 'cancelled'`,
      )
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    db
      .prepare(`select station_id, at, amount_fcfa as amount from driver_ledger where kind = 'settlement' and station_id in ${IN(1)} and at >= ?2`)
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    db
      .prepare(`select station_id, created_at as at, amount_xof as amount from charge_card_transactions where type = 'topup' and amount_xof > 0 and station_id in ${IN(1)} and created_at >= ?2`)
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    // Green Credit loaded in cash at the counter (0047).
    db
      .prepare(`select station_id, created_at as at, amount_xof as amount from wallet_transactions where type = 'topup' and station_id in ${IN(1)} and created_at >= ?2`)
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    // The commission counts our sockets (a point partner's are settled with the partner) and our swaps, however paid,
    // except with Green Credit: no commission on the credit, loaded or spent (0047).
    db
      .prepare(
        `select station_id, paid_at as at, amount_xof as amount from charging_sessions
          where station_id in ${IN(1)} and status = 'paid' and partner_id is null and payment_method <> 'wallet' and paid_at >= ?2`,
      )
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    db
      .prepare(
        `select l.station_id, l.created_at as at, l.amount_xof as amount from swap_log l
         join stations s on s.id = l.station_id left join operators o on o.id = s.operator_id
         where l.station_id in ${IN(1)} and l.payment not in ('none', 'wallet') and l.created_at >= ?2 and ${SWAP_OWNER_SQL} = 'poinderecharge'`,
      )
      .bind(list, from)
      .all<{ station_id: string; at: string; amount: number }>(),
    db.prepare(`${HANDOVER_SELECT} where h.station_id in ${IN(1)}`).bind(list).all<HandoverRow>(),
  ]);

  const byStation = <T extends { station_id: string }>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) map.set(r.station_id, [...(map.get(r.station_id) ?? []), r]);
    return map;
  };
  const cash = new Map<string, CashItem[]>();
  const push = (kind: CashItem["kind"], rows: { station_id: string; at: string; amount: number }[]) => {
    for (const r of rows) cash.set(r.station_id, [...(cash.get(r.station_id) ?? []), { kind, at: r.at, amountXof: r.amount }]);
  };
  push("chargesXof", charges.results);
  push("swapsXof", swaps.results);
  push("parcelsXof", parcels.results);
  push("driversXof", drivers.results);
  push("cardsXof", cards.results);
  push("creditXof", credit.results);
  const sales = byStation([...chargeSales.results, ...swapSales.results]);
  const handoversOf = byStation(handovers.results);

  return stations.map((s) =>
    stationCash(
      {
        stationId: s.id,
        stationName: s.name,
        operatorName: s.operator_name,
        swapOwner: s.swap_owner ?? "operator",
        commissionPct: s.commission_pct,
        commissionMode: cleanCommissionMode(s.commission_mode),
        start: s.start,
        cash: cash.get(s.id) ?? [],
        sales: (sales.get(s.id) ?? []).map((r): CommissionItem => ({ at: r.at, amountXof: r.amount })),
        handovers: (handoversOf.get(s.id) ?? []).map(toHandover),
      },
      now,
    ),
  );
}

/**
 * The cash of our own stations (0051), one balance per staff member: what they took in cash at
 * the counter and their own closings. The same sources as a partner station's (cashOfStations),
 * each attributed to the person who took the money: Green Credit top-ups (details.staff), cash
 * swaps (swap_log.staff_id), cash charges (charging_sessions.paid_by) and parcels paid at the
 * counter (parcels.created_by). Swaps, charges and parcels count from stations.counter_cash_since
 * (0057). `ids` null: every own station. `staffId`: only that person, also when they have nothing
 * yet (their own page shows "nothing to hand over").
 */
export async function cashOfOwnStations(db: D1Database, ids: string[] | null, staffId: string | null = null, now = new Date()): Promise<StationCash[]> {
  const { results: stations } = await db
    .prepare(
      `select s.id, s.name, o.name as operator_name, coalesce(s.cash_since, s.created_at) as start,
              max(coalesce(s.cash_since, s.created_at), coalesce(s.counter_cash_since, '')) as counter_start
       from stations s join operators o on o.id = s.operator_id
       where coalesce(o.is_own, 0) = 1 and (?1 is null or s.id in ${IN(1)})
       order by s.name`,
    )
    .bind(ids ? JSON.stringify(ids) : null)
    .all<Pick<StationRow, "id" | "name" | "operator_name" | "start"> & { counter_start: string }>();
  if (!stations.length) return [];
  const list = JSON.stringify(stations.map((s) => s.id));
  const from = stations.reduce((a, s) => (s.start < a ? s.start : a), stations[0].start);
  type Row = { station_id: string; staff_id: string | null; at: string; amount: number };
  // Each row from its station's start (?2 is only the earliest of them, to use the indexes).
  const counter = (sql: string) => db.prepare(sql).bind(list, from, staffId).all<Row>();
  const [credit, swaps, charges, parcels, handovers] = await Promise.all([
    // Who took the cash is in the top-up's details (worker/wallet.ts topUpCredit).
    counter(
      `select station_id, json_extract(details, '$.staff') as staff_id, created_at as at, amount_xof as amount from wallet_transactions
        where type = 'topup' and station_id in ${IN(1)} and created_at >= ?2 and (?3 is null or json_extract(details, '$.staff') = ?3)`,
    ),
    // Who recorded the swap took the cash (worker/station-work.ts).
    counter(
      `select l.station_id, l.staff_id, l.created_at as at, l.amount_xof as amount from swap_log l
         join stations s on s.id = l.station_id left join operators o on o.id = s.operator_id
        where l.station_id in ${IN(1)} and l.payment = 'cash' and l.created_at >= ?2 and ${SWAP_OWNER_SQL} = 'poinderecharge'
          and (?3 is null or l.staff_id = ?3)`,
    ),
    // Who marked the charge paid in cash (worker/charging.ts payCash).
    counter(
      `select station_id, paid_by as staff_id, paid_at as at, amount_xof as amount from charging_sessions
        where station_id in ${IN(1)} and status = 'paid' and payment_method = 'cash' and paid_at >= ?2 and (?3 is null or paid_by = ?3)`,
    ),
    // A counter parcel is paid when handed in, to whoever stored it (worker/parcels.ts storeParcel).
    counter(
      `select from_station_id as station_id, created_by as staff_id, paid_at as at, price_fcfa as amount from parcels
        where from_station_id in ${IN(1)} and payment_method = 'cash' and paid_at >= ?2 and status <> 'cancelled' and (?3 is null or created_by = ?3)`,
    ),
    db
      .prepare(`${HANDOVER_SELECT} where h.station_id in ${IN(1)} and h.staff_id is not null and (?2 is null or h.staff_id = ?2)`)
      .bind(list, staffId)
      .all<HandoverRow>(),
  ]);
  const byId = new Map(stations.map((s) => [s.id, s]));
  const people = new Map<string, { station: string; staff: string; cash: CashItem[]; handovers: CashHandover[] }>();
  const entry = (station: string, staff: string) => {
    const k = JSON.stringify([station, staff]);
    if (!people.has(k)) people.set(k, { station, staff, cash: [], handovers: [] });
    return people.get(k)!;
  };
  if (staffId) for (const s of stations) entry(s.id, staffId);
  const push = (kind: CashKind, rows: Row[], counterKind: boolean) => {
    for (const r of rows) {
      // Unattributed cash stays out; swaps, charges and parcels before 0057 were handed over outside the app.
      if (!r.staff_id || (counterKind && r.at < byId.get(r.station_id)!.counter_start)) continue;
      entry(r.station_id, r.staff_id).cash.push({ kind, at: r.at, amountXof: r.amount });
    }
  };
  push("creditXof", credit.results, false);
  push("swapsXof", swaps.results, true);
  push("chargesXof", charges.results, true);
  push("parcelsXof", parcels.results, true);
  for (const r of handovers.results) entry(r.station_id, r.staff_id!).handovers.push(toHandover(r));
  if (!people.size) return [];
  const { results: users } = await db
    .prepare(`select id, full_name, phone, email from users where id in ${IN(1)}`)
    .bind(JSON.stringify([...new Set([...people.values()].map((p) => p.staff))]))
    .all<{ id: string; full_name: string | null; phone: string | null; email: string | null }>();
  const names = new Map(users.map((u) => [u.id, label(u.full_name, u.phone, u.email) ?? "?"]));
  return [...people.values()]
    .map((p) => {
      const s = byId.get(p.station)!;
      return stationCash(
        {
          stationId: s.id,
          stationName: s.name,
          operatorName: s.operator_name,
          swapOwner: "poinderecharge",
          commissionPct: 0,
          commissionMode: "monthly",
          start: s.start,
          cash: p.cash,
          sales: [],
          handovers: p.handovers,
          staff: { id: p.staff, name: names.get(p.staff) ?? "?" },
        },
        now,
      );
    })
    .sort((a, b) => a.stationName.localeCompare(b.stationName) || a.staffName!.localeCompare(b.staffName!));
}

/**
 * GET /api/owner/cash?stationId=: the owner's partner stations, and at own stations what each
 * staff member owes (an admin: all of them).
 */
export async function ownerCash(c: CashCtx, stationId: string | null): Promise<StationCash[]> {
  const user = await c.requireUser();
  const ids = user.role === "admin" && !stationId ? null : (await backofficeStations(c, stationId)).ids;
  const [partner, own] = await Promise.all([cashOfStations(c.db, ids), cashOfOwnStations(c.db, ids)]);
  return [...partner, ...own];
}

/** GET /api/stations/:id/cash: at an own station, the signed-in staff member's cash; null elsewhere. */
export async function myStationCash(c: CashCtx, stationId: string): Promise<StationCash | null> {
  const user = await c.requireUser();
  if (!(await c.isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const [cash] = await cashOfOwnStations(c.db, [stationId], user.id);
  return cash ?? null;
}

async function isOwnStation(db: D1Database, stationId: string): Promise<boolean> {
  const row = await db
    .prepare("select coalesce(o.is_own, 0) as is_own from stations s left join operators o on o.id = s.operator_id where s.id = ?")
    .bind(stationId)
    .first<{ is_own: number }>();
  return !!row?.is_own;
}

/**
 * POST /api/owner/cash/handovers: the owner closes the open period of a partner station and
 * records what was handed over, pending until an admin confirms it. At an own station a staff
 * member closes the cash they took, or the station's owner or an admin records it for them
 * (staffId). The amount due must be the one they saw (409 cash_changed otherwise).
 */
export async function closeCashDay(c: CashCtx, input: HandoverInput): Promise<CashHandover> {
  const user = await c.requireUser();
  if (typeof input?.stationId !== "string" || (input.staffId != null && typeof input.staffId !== "string")) throw new ApiError("bad_request");
  // Who may close the station's day before what was sent is looked at.
  const own = await isOwnStation(c.db, input.stationId);
  if (!own && input.staffId != null) throw new ApiError("bad_request");
  const staffId = own ? (input.staffId ?? user.id) : null;
  if (staffId === user.id) {
    if (!(await c.isStaffOf(user, input.stationId))) throw new ApiError("forbidden", 403);
  } else await backofficeStations(c, input.stationId);
  const error = handoverInputError(input);
  if (error) throw new ApiError(error as "bad_request");
  const now = new Date();
  const [cash] = own ? await cashOfOwnStations(c.db, [input.stationId], staffId, now) : await cashOfStations(c.db, [input.stationId], now);
  if (!cash) throw new ApiError("own_station", 409);
  // For someone else: only a person who took cash or closed here before.
  if (own && staffId !== user.id && !cash.lines.totalXof && !cash.handovers.length) throw new ApiError("bad_request");
  if (cash.dueXof !== input.expectedDueXof) throw new ApiError("cash_changed", 409);
  const id = uuid();
  const row = {
    station_id: input.stationId,
    period_from: cash.since,
    period_until: now.toISOString(),
    cash_xof: cash.lines.totalXof,
    carry_xof: cash.carryXof,
    commission_xof: cash.commissionXof,
    due_xof: cash.dueXof,
    amount_xof: input.amountXof,
    method: input.method,
    reference: input.reference.trim(),
    note: input.note?.trim() || null,
    staff_id: staffId,
  };
  try {
    await c.db.batch([
      c.db
        .prepare(
          `insert into cash_handovers (id, station_id, period_from, period_until, cash_xof, carry_xof, commission_xof, due_xof, amount_xof,
             method, reference, note, staff_id, status, created_by, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
        )
        .bind(id, ...Object.values(row), user.id, row.period_until),
      c.audit(user.id, "cash_handovers", "insert", id, row, { stationId: input.stationId }),
    ]);
  } catch (err) {
    // Another closing of the same period got there first.
    if (/UNIQUE constraint failed/i.test(String(err))) throw new ApiError("cash_changed", 409);
    throw err;
  }
  const saved = await c.db.prepare(`${HANDOVER_SELECT} where h.id = ?`).bind(id).first<HandoverRow>();
  return toHandover(saved!);
}

/** POST /api/admin/cash/handovers/:id/decide { confirm, reason }: the money arrived, or not (with a reason). */
export async function decideHandover(c: CashCtx, id: string, body: { confirm?: unknown; reason?: unknown }): Promise<CashHandover> {
  const admin = await c.requireAdmin();
  const confirm = body?.confirm === true;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  if (!confirm && (!reason || reason.length > HANDOVER_NOTE_MAX)) throw new ApiError("reject_reason_required");
  const row = await c.db.prepare("select station_id, status from cash_handovers where id = ?").bind(id).first<{ station_id: string; status: HandoverStatus }>();
  if (!row) throw new ApiError("not_found", 404);
  if (row.status !== "pending") throw new ApiError("handover_decided", 409);
  const status: HandoverStatus = confirm ? "confirmed" : "rejected";
  const now = nowIso();
  const [update] = await c.db.batch([
    c.db
      .prepare("update cash_handovers set status = ?, decided_by = ?, decided_at = ?, reject_reason = ? where id = ? and status = 'pending'")
      .bind(status, admin.id, now, confirm ? null : reason, id),
    c.audit(admin.id, "cash_handovers", "update", id, { status: ["pending", status], ...(confirm ? {} : { reject_reason: reason }) }, { stationId: row.station_id }),
  ]);
  if (!update.meta.changes) throw new ApiError("handover_decided", 409);
  const saved = await c.db.prepare(`${HANDOVER_SELECT} where h.id = ?`).bind(id).first<HandoverRow>();
  return toHandover(saved!);
}

/** POST /api/admin/cash/stations/:id: an operator station or a shop station, and the host's commission. */
export async function saveStationCashSettings(c: CashCtx, stationId: string, input: Partial<StationCashSettings>): Promise<StationCash> {
  const admin = await c.requireAdmin();
  const swapOwner = cleanSwapOwner(input?.swapOwner);
  if (!swapOwner || !validCommissionPct(input?.commissionPct) || (input?.commissionMode !== "deduct" && input?.commissionMode !== "monthly")) {
    throw new ApiError("bad_request");
  }
  const before = await c.db
    .prepare(
      `select s.swap_owner, s.commission_pct, s.commission_mode, coalesce(o.is_own, 0) as is_own
       from stations s left join operators o on o.id = s.operator_id where s.id = ?`,
    )
    .bind(stationId)
    .first<{ swap_owner: SwapOwner | null; commission_pct: number; commission_mode: string; is_own: number }>();
  if (!before) throw new ApiError("station_not_found", 404);
  if (before.is_own) throw new ApiError("own_station", 409);
  const after = { swap_owner: swapOwner, commission_pct: input.commissionPct, commission_mode: input.commissionMode };
  const changes = Object.fromEntries(
    Object.entries(after)
      .filter(([k, v]) => before[k as keyof typeof before] !== v)
      .map(([k, v]) => [k, [before[k as keyof typeof before], v]]),
  );
  if (Object.keys(changes).length) {
    await c.db.batch([
      c.db.prepare("update stations set swap_owner = ?, commission_pct = ?, commission_mode = ? where id = ?").bind(swapOwner, input.commissionPct, input.commissionMode, stationId),
      c.audit(admin.id, "stations", "update", stationId, changes, { stationId }),
    ]);
  }
  const [cash] = await cashOfStations(c.db, [stationId]);
  return cash;
}

/**
 * Daily cron (10:00): tells the admins which stations (at our own: which staff members) have not
 * closed a day with cash for poinderecharge. Returns their station ids.
 */
export async function runCashAlerts(env: Env, now = new Date()): Promise<string[]> {
  const [partner, own] = await Promise.all([cashOfStations(env.DB, null, now), cashOfOwnStations(env.DB, null, null, now)]);
  const late = [...partner, ...own].filter((s) => s.late);
  if (!late.length) return [];
  const { results: admins } = await env.DB.prepare("select id from users where role = 'admin'").all<{ id: string }>();
  const names = late.map((s) => `${s.stationName}${s.staffName ? ` – ${s.staffName}` : ""} (${s.dueXof} FCFA)`).join(", ");
  const message = {
    subject: "Caisse : stations en retard",
    text: `Ces stations n'ont pas clôturé leur caisse avant 10 h : ${names}.\n\nVoir le backoffice, Caisse des stations.`,
  };
  await Promise.all(admins.map((a) => notifyUser(env, a.id, message)));
  return late.map((s) => s.stationId);
}
