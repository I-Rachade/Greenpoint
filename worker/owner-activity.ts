// The Activity tab of My stations and the battery numbers used at a station (operator accounts,
// migration 0070; admins see every station). Types and rules in shared/owner-activity.ts.

import {
  ACTIVITY_KINDS,
  ACTIVITY_PAGE,
  ACTIVITY_TABLES,
  actionKind,
  actionPath,
  visibleChanges,
  type ActivityEntry,
  type ActivityFilter,
  type ActivityKind,
  type ActivityPage,
  type UsedSerial,
} from "../shared/owner-activity";
import { periodStart, type ReportPeriod } from "../shared/owner-backoffice";
import type { StationRole } from "../shared/station-work";
import type { Profile } from "../shared/types";
import { personLabel } from "../shared/wallet";
import { ApiError } from "./http";
import { backofficeStations } from "./owner";

interface Ctx {
  db: D1Database;
  requireUser(): Promise<Profile>;
}

interface PersonCols {
  p_name: string | null;
  p_phone: string | null;
  p_email: string | null;
  p_role: string | null;
}

const PERSON_COLS = "u.full_name as p_name, u.phone as p_phone, u.email as p_email, u.role as p_role";

/** An admin shows as "" (the app writes poinderecharge); anyone else by name, else masked contact. */
function who(r: PersonCols): string {
  if (r.p_role === "admin") return "";
  return r.p_name || r.p_phone || r.p_email ? personLabel({ fullName: r.p_name, phone: r.p_phone, email: r.p_email }) : "";
}

const IN = (n: number) => `(select value from json_each(?${n}))`;

/** GET /api/owner/activity?stationId=&kind=&before=: actions and changes at the stations, newest first. */
export async function ownerActivity(c: Ctx, filter: ActivityFilter): Promise<ActivityPage> {
  const { ids } = await backofficeStations(c, filter.stationId || null);
  const kind = filter.kind && (ACTIVITY_KINDS as readonly string[]).includes(filter.kind) ? (filter.kind as ActivityKind) : null;
  const before = filter.before && !Number.isNaN(Date.parse(filter.before)) ? filter.before : null;
  const list = JSON.stringify(ids);
  const tables = Object.entries(ACTIVITY_TABLES)
    .filter(([, k]) => !kind || k === kind)
    .map(([t]) => t);
  // One page from each source is enough to fill one merged page.
  const limit = ACTIVITY_PAGE + 1;
  const [actions, changes] = await Promise.all([
    c.db
      .prepare(
        `select a.id, a.station_id, s.name as station_name, a.role, a.action, a.created_at, ${PERSON_COLS}
         from station_actions a join stations s on s.id = a.station_id left join users u on u.id = a.person_id
         where a.station_id in ${IN(1)} and (?2 is null or a.created_at < ?2)
         order by a.created_at desc, a.id desc limit ${kind ? 500 : limit}`,
      )
      .bind(list, before)
      .all<PersonCols & { id: number; station_id: string; station_name: string; role: StationRole; action: string; created_at: string }>(),
    tables.length
      ? c.db
          .prepare(
            `select l.id, l.station_id, s.name as station_name, l.table_name, l.action, l.changes, l.at, ${PERSON_COLS}
             from audit_log l join stations s on s.id = l.station_id left join users u on u.id = l.actor
             where l.station_id in ${IN(1)} and l.table_name in ${IN(2)} and (?3 is null or l.at < ?3)
             order by l.at desc, l.id desc limit ${limit}`,
          )
          .bind(list, JSON.stringify(tables), before)
          .all<PersonCols & { id: number; station_id: string; station_name: string; table_name: string; action: "insert" | "update" | "delete"; changes: string; at: string }>()
      : Promise.resolve({ results: [] }),
  ]);
  const entries: ActivityEntry[] = [
    ...actions.results
      .map((a): ActivityEntry => ({
        id: `a${a.id}`,
        at: a.created_at,
        stationId: a.station_id,
        stationName: a.station_name,
        person: who(a),
        role: a.role,
        kind: actionKind(a.action),
        action: actionPath(a.action),
      }))
      .filter((e) => !kind || e.kind === kind)
      .slice(0, limit),
    ...changes.results.map(
      (l): ActivityEntry => ({
        id: `c${l.id}`,
        at: l.at,
        stationId: l.station_id,
        stationName: l.station_name,
        person: who(l),
        role: l.p_role === "admin" ? "admin" : null,
        kind: ACTIVITY_TABLES[l.table_name] ?? "other",
        table: l.table_name,
        change: l.action,
        changes: visibleChanges(safeJson(l.changes)),
      }),
    ),
  ].sort((a, b) => b.at.localeCompare(a.at));
  const page = entries.slice(0, ACTIVITY_PAGE);
  return { entries: page, next: entries.length > ACTIVITY_PAGE ? page[page.length - 1].at : null };
}

function safeJson(text: string): Record<string, unknown> {
  try {
    const v = JSON.parse(text || "{}");
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

/** GET /api/owner/serials?stationId=&days=: the battery numbers handed out or brought back at one station. */
export async function usedSerials(c: Ctx, stationId: string | null, days: ReportPeriod): Promise<UsedSerial[]> {
  await backofficeStations(c, stationId);
  if (!stationId) throw new ApiError("bad_request");
  const { results } = await c.db
    .prepare(
      `select b.serial, b.brand, sum(h.type = 'out') as n_out, sum(h.type = 'in') as n_in, max(h.created_at) as last_at
       from battery_history h join batteries b on b.id = h.battery_id
       where h.station_id = ?1 and h.type in ('out', 'in') and h.created_at >= ?2
       group by b.id order by last_at desc limit 2000`,
    )
    .bind(stationId, periodStart(days))
    .all<{ serial: string; brand: string; n_out: number; n_in: number; last_at: string }>();
  return results.map((r) => ({ serial: r.serial, brand: r.brand, out: r.n_out, in: r.n_in, lastAt: r.last_at }));
}
