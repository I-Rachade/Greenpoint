// The owner's backoffice (plan phase 8): live queue, handovers, settlement and statistics of
// the owner's stations, one or all of them; an admin sees every station. Staff get none (403).
// Types and money rules (W12) in src/lib/owner-backoffice.ts.

import {
  emptyDays,
  periodStart,
  type Handover,
  type OwnerLive,
  type OwnerReport,
  type ReportPeriod,
  type StaffStats,
} from "../src/lib/owner-backoffice";
import type { Profile } from "../src/lib/types";
import { personLabel } from "../src/lib/wallet";
import { ApiError, nowIso } from "./http";
import { RESERVATION_SELECT, toReservation, type ReservationRow } from "./reservations";

interface OwnerCtx {
  db: D1Database;
  requireUser(): Promise<Profile>;
}

const label = (name: string | null, phone: string | null, email: string | null = null) =>
  name || phone || email ? personLabel({ fullName: name, phone, email }) : null;

/**
 * The stations a backoffice request covers: the one asked for (the owner must run it), or
 * every active station of the owner's operators. Admins: any station, or all.
 */
export async function backofficeStations(c: OwnerCtx, stationId: string | null): Promise<{ ids: string[]; thirdParty: boolean }> {
  const user = await c.requireUser();
  if (user.role !== "admin" && user.role !== "operator") throw new ApiError("forbidden", 403);
  const mine = user.role === "admin" ? "1" : "s.operator_id in (select operator_id from operator_owners where user_id = ?1)";
  const { results } = await c.db
    .prepare(`select s.id, coalesce(o.is_own, 0) as is_own from stations s left join operators o on o.id = s.operator_id where ${mine} and (?2 is null or s.id = ?2)`)
    .bind(user.role === "admin" ? null : user.id, stationId)
    .all<{ id: string; is_own: number }>();
  // Staff (no operator of their own) and other owners' stations: no backoffice.
  if (!results.length) throw new ApiError(stationId && user.role === "admin" ? "station_not_found" : "forbidden", stationId && user.role === "admin" ? 404 : 403);
  return { ids: results.map((r) => r.id), thirdParty: results.some((r) => !r.is_own) };
}

const IN = (n: number) => `(select value from json_each(?${n}))`;

/** GET /api/owner/live?stationId=: reservations holding now, drivers in line, runs, parcels waiting, recent handovers. */
export async function ownerLive(c: OwnerCtx, stationId: string | null): Promise<OwnerLive> {
  const { ids } = await backofficeStations(c, stationId);
  const list = JSON.stringify(ids);
  const now = nowIso();
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const [reservations, drivers, runs, parcels, scans, settlements] = await Promise.all([
    c.db
      .prepare(`${RESERVATION_SELECT} where r.station_id in ${IN(1)} and r.status = 'active' and r.expires_at > ?2 order by r.expires_at`)
      .bind(list, now)
      .all<ReservationRow>(),
    c.db
      .prepare(
        `select q.station_id, q.since, coalesce(d.full_name, u.full_name) as name, u.phone, v.plate
         from driver_queue q join users u on u.id = q.driver_id left join drivers d on d.user_id = q.driver_id
         left join fleet_vehicles v on v.id = d.vehicle_id
         where q.station_id in ${IN(1)} order by q.since`,
      )
      .bind(list)
      .all<{ station_id: string; since: string; name: string | null; phone: string | null; plate: string | null }>(),
    c.db
      .prepare(
        `select r.id, r.station_id, r.status, r.created_at, coalesce(d.full_name, u.full_name) as name, u.phone,
                (select count(*) from parcels p where p.run_id = r.id) as parcels,
                (select count(*) from parcels p where p.run_id = r.id and p.to_station_id in ${IN(1)}) as incoming
         from parcel_runs r left join users u on u.id = r.driver_id left join drivers d on d.user_id = r.driver_id
         where r.status in ('loading', 'under_way')
           and (r.station_id in ${IN(1)} or exists (select 1 from parcels p where p.run_id = r.id and p.to_station_id in ${IN(1)}))
         order by r.created_at`,
      )
      .bind(list)
      .all<{ id: string; station_id: string; status: "loading" | "under_way"; created_at: string; name: string | null; phone: string | null; parcels: number; incoming: number }>(),
    c.db
      .prepare(
        `select s.value as station_id,
                (select count(*) from parcels p where p.from_station_id = s.value and p.status = 'deposited') as to_send,
                (select count(*) from parcels p where p.to_station_id = s.value and p.status = 'in_transit') as incoming,
                (select count(*) from parcels p where p.to_station_id = s.value and p.status = 'arrived') as to_pick_up
         from json_each(?1) s`,
      )
      .bind(list)
      .all<{ station_id: string; to_send: number; incoming: number; to_pick_up: number }>(),
    c.db
      .prepare(
        `select x.created_at as at, x.station_id, x.kind, p.tracking_no, coalesce(d.full_name, du.full_name) as d_name, du.phone as d_phone,
                bu.full_name as b_name, bu.phone as b_phone, bu.email as b_email
         from parcel_scans x join parcels p on p.id = x.parcel_id
         left join users du on du.id = x.driver_id left join drivers d on d.user_id = x.driver_id
         left join users bu on bu.id = x.scanned_by
         where x.station_id in ${IN(1)} and x.kind in ('handover_to_driver', 'received_at_station') and x.created_at >= ?2
         order by x.created_at desc limit 50`,
      )
      .bind(list, weekAgo)
      .all<{ at: string; station_id: string; kind: "handover_to_driver" | "received_at_station"; tracking_no: string; d_name: string | null; d_phone: string | null; b_name: string | null; b_phone: string | null; b_email: string | null }>(),
    c.db
      .prepare(
        `select l.at, l.station_id, l.amount_fcfa, coalesce(d.full_name, du.full_name) as d_name, du.phone as d_phone,
                bu.full_name as b_name, bu.phone as b_phone, bu.email as b_email
         from driver_ledger l left join users du on du.id = l.driver_id left join drivers d on d.user_id = l.driver_id
         left join users bu on bu.id = l.actor
         where l.kind = 'settlement' and l.station_id in ${IN(1)} and l.at >= ?2 order by l.at desc limit 50`,
      )
      .bind(list, weekAgo)
      .all<{ at: string; station_id: string; amount_fcfa: number; d_name: string | null; d_phone: string | null; b_name: string | null; b_phone: string | null; b_email: string | null }>(),
  ]);
  const handovers: Handover[] = [
    ...scans.results.map((s) => ({
      at: s.at,
      stationId: s.station_id,
      kind: s.kind,
      driver: label(s.d_name, s.d_phone),
      parcel: s.tracking_no,
      amountXof: null,
      by: label(s.b_name, s.b_phone, s.b_email),
    })),
    ...settlements.results.map((s) => ({
      at: s.at,
      stationId: s.station_id,
      kind: "driver_settlement" as const,
      driver: label(s.d_name, s.d_phone),
      parcel: null,
      amountXof: s.amount_fcfa,
      by: label(s.b_name, s.b_phone, s.b_email),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 50);
  return {
    reservations: reservations.results.map((r) => toReservation(r, { withCustomer: true })),
    drivers: drivers.results.map((d) => ({ stationId: d.station_id, name: label(d.name, d.phone) ?? "?", plate: d.plate, since: d.since })),
    runs: runs.results.map((r) => ({
      id: r.id,
      stationId: r.station_id,
      driver: label(r.name, r.phone) ?? "?",
      status: r.status,
      parcels: r.parcels,
      incoming: r.incoming,
      createdAt: r.created_at,
    })),
    parcels: parcels.results.map((p) => ({ stationId: p.station_id, toSend: p.to_send, incoming: p.incoming, toPickUp: p.to_pick_up })),
    handovers,
  };
}

/** GET /api/owner/report?stationId=&days=: settlement and statistics of the period. */
export async function ownerReport(c: OwnerCtx, stationId: string | null, days: ReportPeriod): Promise<OwnerReport> {
  const { ids, thirdParty } = await backofficeStations(c, stationId);
  const list = JSON.stringify(ids);
  const from = periodStart(days);
  const [swaps, charges, parcels, drivers, staff, actions] = await Promise.all([
    c.db
      .prepare(`select created_at as at, payment, amount_xof from swap_log where station_id in ${IN(1)} and created_at >= ?2`)
      .bind(list, from)
      .all<{ at: string; payment: "cash" | "wallet" | "fleet" | "none"; amount_xof: number }>(),
    c.db
      .prepare(`select paid_at as at, payment_method, amount_xof from charging_sessions where station_id in ${IN(1)} and status = 'paid' and paid_at >= ?2`)
      .bind(list, from)
      .all<{ at: string; payment_method: string; amount_xof: number }>(),
    c.db
      .prepare(
        `select created_at as at, payment_method, price_fcfa, paid_at, status from parcels
         where from_station_id in ${IN(1)} and created_at >= ?2`,
      )
      .bind(list, from)
      .all<{ at: string; payment_method: string; price_fcfa: number; paid_at: string | null; status: string }>(),
    c.db
      .prepare(`select coalesce(sum(amount_fcfa), 0) as total from driver_ledger where kind = 'settlement' and station_id in ${IN(1)} and at >= ?2`)
      .bind(list, from)
      .first<{ total: number }>(),
    c.db
      .prepare(
        `select person_id, max(role) as role, sum(swaps) as swaps, sum(charges) as charges from (
           select staff_id as person_id, role, 1 as swaps, 0 as charges from swap_log where station_id in ${IN(1)} and created_at >= ?2
           union all
           select started_by, null, 0, 1 from charging_sessions where station_id in ${IN(1)} and started_at >= ?2
         ) group by person_id`,
      )
      .bind(list, from)
      .all<{ person_id: string; role: StaffStats["role"] | null; swaps: number; charges: number }>(),
    c.db
      .prepare(`select person_id, max(role) as role, count(*) as n from station_actions where station_id in ${IN(1)} and created_at >= ?2 group by person_id`)
      .bind(list, from)
      .all<{ person_id: string; role: StaffStats["role"]; n: number }>(),
  ]);

  const perDay = emptyDays(days);
  const index = new Map(perDay.map((d, i) => [d.day, i]));
  const dayOf = (iso: string) => perDay[index.get(iso.slice(0, 10)) ?? -1];
  const hours = Array.from({ length: 24 }, () => 0);
  const revenue = { swapCashXof: 0, swapAppXof: 0, swapFleetXof: 0, chargeCashXof: 0, chargeAppXof: 0, cashXof: 0, totalXof: 0 };
  for (const s of swaps.results) {
    const d = dayOf(s.at);
    if (d) {
      d.swaps++;
      d.swapXof += s.amount_xof;
    }
    hours[new Date(s.at).getUTCHours()]++;
    if (s.payment === "cash") revenue.swapCashXof += s.amount_xof;
    else if (s.payment === "wallet") revenue.swapAppXof += s.amount_xof;
    else if (s.payment === "fleet") revenue.swapFleetXof += s.amount_xof;
  }
  for (const ch of charges.results) {
    const d = dayOf(ch.at);
    if (d) {
      d.charges++;
      d.chargeXof += ch.amount_xof;
    }
    hours[new Date(ch.at).getUTCHours()]++;
    if (ch.payment_method === "cash") revenue.chargeCashXof += ch.amount_xof;
    else revenue.chargeAppXof += ch.amount_xof;
  }
  let parcelsXof = 0;
  for (const p of parcels.results) {
    const d = dayOf(p.at);
    if (d) d.parcels++;
    // Paid at the counter and not refunded (a cancelled parcel is refunded there).
    if (p.payment_method === "cash" && p.paid_at && p.status !== "cancelled") parcelsXof += p.price_fcfa;
  }
  revenue.cashXof = revenue.swapCashXof + revenue.chargeCashXof;
  revenue.totalXof = revenue.cashXof + revenue.swapAppXof + revenue.swapFleetXof + revenue.chargeAppXof;
  const driversXof = drivers?.total ?? 0;

  // People: swaps and charges they did, and every station action they logged.
  const people = new Map<string, StaffStats>();
  const entry = (id: string, role: StaffStats["role"] | null) => {
    const e = people.get(id) ?? { personId: id, person: "", role: role ?? "staff", swaps: 0, charges: 0, actions: 0 };
    if (role) e.role = role;
    people.set(id, e);
    return e;
  };
  for (const r of staff.results) Object.assign(entry(r.person_id, r.role), { swaps: r.swaps, charges: r.charges });
  for (const r of actions.results) entry(r.person_id, r.role).actions = r.n;
  if (people.size) {
    const { results } = await c.db
      .prepare(`select id, full_name, phone, email from users where id in (select value from json_each(?1))`)
      .bind(JSON.stringify([...people.keys()]))
      .all<{ id: string; full_name: string | null; phone: string | null; email: string | null }>();
    for (const u of results) people.get(u.id)!.person = label(u.full_name, u.phone, u.email) ?? "?";
  }

  return {
    days,
    from,
    perDay,
    revenue,
    poinderecharge: { parcelsXof, driversXof, totalXof: parcelsXof + driversXof, thirdParty },
    hours,
    staff: [...people.values()].map((p) => ({ ...p, person: p.person || "?" })).sort((a, b) => b.swaps + b.charges + b.actions - (a.swaps + a.charges + a.actions)),
  };
}
