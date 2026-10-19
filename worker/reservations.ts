// Reservations by type (plan phase 4): what a reservation holds, its pickup code with a
// lock after wrong tries, and the SQL other modules share. Rules in src/lib/reservations.ts,
// schema in migrations/0001_init.sql and 0029_reservation_kind.sql.

import {
  RESERVATION_CODE_LOCK_MINUTES,
  RESERVATION_MAX_CODE_FAILURES,
  type ReservationKind,
  type ReservationTargetKind,
} from "../src/lib/reservations";
import type { Reservation, ReservationType } from "../src/lib/types";
import { personLabel } from "../src/lib/wallet";
import { ApiError, nowIso } from "./http";

export interface ReservationRow {
  id: string;
  user_id: string;
  station_id: string;
  type: ReservationType;
  /** Missing on rows read before migration 0029. */
  kind?: ReservationKind;
  target?: string | null;
  status: Reservation["status"];
  created_at: string;
  expires_at: string;
  cancel_reason: string | null;
  pickup_code: string;
  charging_point_id?: string | null;
  /** RESERVATION_SELECT only. */
  target_label?: string | null;
  target_kind?: ReservationTargetKind | null;
  c_name?: string | null;
  c_phone?: string | null;
  c_email?: string | null;
}

/** Reservations with what they hold, readable for people, and who reserved. */
export const RESERVATION_SELECT = `
  select r.*,
         case when r.kind = 'swap' then bt.brand || ' ' || bt.name else coalesce(cp.label, ev.name) end as target_label,
         case when r.kind = 'swap' then case when bt.id is null then null else 'battery_type' end
              when cp.id is not null then 'outlet' when ev.id is not null then 'ev' else 'place' end as target_kind,
         u.full_name as c_name, u.phone as c_phone, u.email as c_email
  from reservations r
  left join battery_types bt on r.kind = 'swap' and bt.id = r.target
  left join charging_points cp on r.kind = 'charging_point' and cp.id = r.target
  left join ev_chargers ev on r.kind = 'charging_point' and ev.id = r.target
  left join users u on u.id = r.user_id`;

/** `withCode`: the customer's own list. `withCustomer`: the station's list (staff see who, never the code). */
export function toReservation(r: ReservationRow, opts: { withCode?: boolean; withCustomer?: boolean } = {}): Reservation {
  return {
    id: r.id,
    userId: r.user_id,
    stationId: r.station_id,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    cancelReason: r.cancel_reason,
    kind: r.kind ?? (r.type === "battery" ? "swap" : "charging_point"),
    target: r.target ?? null,
    targetLabel: r.target_label ?? null,
    targetKind: r.target_kind ?? null,
    ...(opts.withCode ? { pickupCode: r.pickup_code } : {}),
    ...(opts.withCustomer
      ? { customer: r.c_name || r.c_phone || r.c_email ? personLabel({ fullName: r.c_name ?? null, phone: r.c_phone ?? null, email: r.c_email ?? null }) : null }
      : {}),
  };
}

/** SQL: the reservation `alias` holds a car charger (target is an ev_chargers id). */
export const evTargetSql = (alias: string) => `exists (select 1 from ev_chargers ev_t where ev_t.id = ${alias}.target)`;

/**
 * SQL: full batteries of type ?{key} ('' = the station's one counter) at station ?{station}
 * held by active swap reservations at time ?{now}. Holds never change the counter; the
 * swap that hands the battery out completes the reservation.
 */
export const heldBatteriesSql = (station: string, key: string, now: string) =>
  `(select count(*) from reservations hr where hr.station_id = ${station} and hr.kind = 'swap' and hr.status = 'active'
     and hr.expires_at > ${now} and coalesce(hr.target, '') = ${key})`;

/**
 * SQL: what station ?{station} offers to reservations of `kind`. Swap counts its full batteries;
 * charging its connected outlets and car chargers, or its places when no outlet is connected.
 */
export function holdStockSql(kind: "swap" | "charging_point", station: string): string {
  return kind === "swap"
    ? `case when exists (select 1 from station_battery_types where station_id = ${station})
         then (select coalesce(sum(full_batteries), 0) from station_battery_types where station_id = ${station})
         else coalesce((select full_batteries from station_status where station_id = ${station}), 0) end`
    : `(select count(*) from charging_points cp where cp.station_id = ${station} and cp.device_id is not null
          and not exists (select 1 from ev_chargers ev_p where ev_p.point_id = cp.id))
       + (select count(*) from ev_chargers where station_id = ${station} and is_active = 1)
       + case when exists (select 1 from charging_points where station_id = ${station} and device_id is not null) then 0
           else (select charging_slots from stations where id = ${station}) end`;
}

/** SQL: active reservations of `kind` at station ?{station} at time ?{now}. */
export const heldOfKindSql = (kind: "swap" | "charging_point", station: string, now: string) =>
  `(select count(*) from reservations hs where hs.station_id = ${station} and hs.kind = '${kind}' and hs.status = 'active' and hs.expires_at > ${now})`;

/** The most reservations of a kind a station with `stock` may carry at once. */
export const HOLD_ROOM_SQL = (stock: string) => `max(1, ((${stock}) + 1) / 2)`;

/**
 * SQL: reservations of `kind` at station ?{station} hold less than half (rounded up, at least
 * one) of its stock at time ?{now}, so a few throwaway accounts cannot block a whole station;
 * the rest stays for walk-in customers (review 2026-10-19, point 8).
 */
export function holdRoomSql(kind: "swap" | "charging_point", station: string, now: string): string {
  return `${heldOfKindSql(kind, station, now)} < ${HOLD_ROOM_SQL(holdStockSql(kind, station))}`;
}

/** Whether the reservation is active and not past its expiry. */
export function stillActive(r: Pick<ReservationRow, "status" | "expires_at">): boolean {
  return r.status === "active" && r.expires_at > nowIso();
}

/**
 * Checks the pickup code typed for a reservation. Every wrong code is counted; after
 * RESERVATION_MAX_CODE_FAILURES within RESERVATION_CODE_LOCK_MINUTES the reservation
 * takes no code (429), so its 4 digits cannot be tried through (as parcels).
 */
export async function checkPickupCode(db: D1Database, r: Pick<ReservationRow, "id" | "station_id" | "pickup_code">, raw: unknown): Promise<void> {
  const since = new Date(Date.now() - RESERVATION_CODE_LOCK_MINUTES * 60_000).toISOString();
  // The try is written down before the code is compared, in one statement with the count, so
  // parallel requests cannot pass the limit; a right code takes its try back.
  const tried = await db
    .prepare(
      `insert into reservation_code_failures (reservation_id, station_id, at)
       select ?1, ?2, ?3 where (select count(*) from reservation_code_failures where reservation_id = ?1 and at > ?4) < ?5
       returning rowid`,
    )
    .bind(r.id, r.station_id, nowIso(), since, RESERVATION_MAX_CODE_FAILURES)
    .first<{ rowid: number }>();
  if (!tried) throw new ApiError("code_locked", 429);
  if (r.pickup_code === String(raw ?? "").trim()) {
    await db.prepare("delete from reservation_code_failures where rowid = ?").bind(tried.rowid).run();
    return;
  }
  await db.prepare("delete from reservation_code_failures where at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()).run();
  throw new ApiError("wrong_pickup_code");
}

/** Active holds per station and target (`kind:target`), for the station list. */
export async function heldTargetsByStation(db: D1Database): Promise<Map<string, Map<string, number>>> {
  const { results } = await db
    .prepare(
      `select station_id, kind, target, count(*) as n from reservations
       where status = 'active' and expires_at > ? and target is not null group by station_id, kind, target`,
    )
    .bind(nowIso())
    .all<{ station_id: string; kind: ReservationKind; target: string; n: number }>();
  const out = new Map<string, Map<string, number>>();
  for (const r of results) {
    const station = out.get(r.station_id) ?? new Map<string, number>();
    station.set(`${r.kind}:${r.target}`, r.n);
    out.set(r.station_id, station);
  }
  return out;
}
