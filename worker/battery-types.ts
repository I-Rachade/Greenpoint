import { batteryTypeLabel, validBatteryType, type BatteryType, type BatteryTypeInput, type StationBatteryType } from "../src/lib/battery-types";
import type { AuditEntry, AuditTable } from "../src/lib/admin/types";
import { ApiError, nowIso, uuid } from "./http";

// Battery types of the motorbike brands, and which ones each station swaps. See src/lib/battery-types.ts and migration 0017_battery_types.sql.

interface Ctx {
  db: D1Database;
  audit(
    actor: string | null,
    table: AuditTable,
    action: AuditEntry["action"],
    rowId: string,
    changes: Record<string, unknown>,
    ids?: { stationId?: string | null; userId?: string | null },
  ): D1PreparedStatement;
}

interface TypeRow {
  id: string;
  brand: string;
  name: string;
  is_active: number;
}

const toType = (r: TypeRow): BatteryType => ({ id: r.id, brand: r.brand, name: r.name, isActive: !!r.is_active });

export async function listBatteryTypes(db: D1Database): Promise<BatteryType[]> {
  const { results } = await db.prepare("select id, brand, name, is_active from battery_types order by brand, name").all<TypeRow>();
  return results.map(toType);
}

/** Battery types each station swaps with their full batteries, brands and models sorted. */
export async function batteryTypesByStation(db: D1Database): Promise<Map<string, StationBatteryType[]>> {
  const { results } = await db
    .prepare(
      `select sbt.station_id, sbt.full_batteries, t.id, t.brand, t.name, t.is_active
       from station_battery_types sbt join battery_types t on t.id = sbt.battery_type_id
       order by t.brand, t.name`,
    )
    .all<TypeRow & { station_id: string; full_batteries: number }>();
  const out = new Map<string, StationBatteryType[]>();
  for (const r of results) {
    out.set(r.station_id, [...(out.get(r.station_id) ?? []), { ...toType(r), fullBatteries: r.full_batteries }]);
  }
  return out;
}

/** Creates or updates a battery type (admins). */
export async function saveBatteryType(c: Ctx, actor: string, id: string | null, input: BatteryTypeInput) {
  if (!validBatteryType(input)) throw new ApiError("bad_request");
  const row = { brand: input.brand.trim(), name: input.name.trim(), is_active: input.isActive === false ? 0 : 1 };
  try {
    if (id) {
      const before = await c.db.prepare("select brand, name, is_active from battery_types where id = ?").bind(id).first<Record<string, unknown>>();
      if (!before) throw new ApiError("not_found", 404);
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) if (before[k] !== v) changes[k] = [before[k], v];
      await c.db.batch([
        c.db.prepare("update battery_types set brand = ?, name = ?, is_active = ? where id = ?").bind(row.brand, row.name, row.is_active, id),
        c.audit(actor, "battery_types", "update", id, changes),
      ]);
      return { id };
    }
    const newId = uuid();
    await c.db.batch([
      c.db
        .prepare("insert into battery_types (id, brand, name, is_active, created_at) values (?, ?, ?, ?, ?)")
        .bind(newId, row.brand, row.name, row.is_active, nowIso()),
      c.audit(actor, "battery_types", "insert", newId, row),
    ]);
    return { id: newId };
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("battery_type_exists", 409);
    throw err;
  }
}

/**
 * Statements that replace the battery types a station swaps (none when it has no
 * swap point), and their labels for the audit log. Unknown ids are refused.
 */
export async function stationBatteryTypeStatements(db: D1Database, stationId: string, ids: string[], swaps: boolean) {
  const wanted = swaps ? [...new Set((ids ?? []).map(String))] : [];
  const known = new Map((await listBatteryTypes(db)).map((t) => [t.id, t]));
  if (wanted.some((id) => !known.has(id))) throw new ApiError("bad_request");
  // Types kept keep their counts of full batteries.
  return {
    statements: [
      db
        .prepare(
          `delete from station_battery_types where station_id = ?
             and battery_type_id not in (select value from json_each(?))`,
        )
        .bind(stationId, JSON.stringify(wanted)),
      ...wanted.map((id) =>
        db.prepare("insert or ignore into station_battery_types (station_id, battery_type_id) values (?, ?)").bind(stationId, id),
      ),
    ],
    labels: wanted.map((id) => batteryTypeLabel(known.get(id)!)),
  };
}

/**
 * Statements that set the full batteries of some of the types a station swaps,
 * the station's new total (the sum over all its types) and the audit changes.
 * Types the station does not swap are refused.
 */
export async function typeBatteryStatements(db: D1Database, stationId: string, counts: Record<string, number>) {
  const { results } = await db
    .prepare(
      `select sbt.battery_type_id as id, sbt.full_batteries, t.brand, t.name
       from station_battery_types sbt join battery_types t on t.id = sbt.battery_type_id
       where sbt.station_id = ?`,
    )
    .bind(stationId)
    .all<{ id: string; full_batteries: number; brand: string; name: string }>();
  const rows = new Map(results.map((r) => [r.id, r]));
  const statements: D1PreparedStatement[] = [];
  const changes: Record<string, unknown> = {};
  for (const [id, value] of Object.entries(counts ?? {})) {
    const row = rows.get(id);
    const n = Number(value);
    if (!row || !Number.isFinite(n) || n < 0 || n > 100_000) throw new ApiError("bad_request");
    const next = Math.floor(n);
    if (next === row.full_batteries) continue;
    changes[`full_batteries ${batteryTypeLabel(row)}`] = [row.full_batteries, next];
    row.full_batteries = next;
    statements.push(
      db
        .prepare("update station_battery_types set full_batteries = ? where station_id = ? and battery_type_id = ?")
        .bind(next, stationId, id),
    );
  }
  const total = [...rows.values()].reduce((sum, r) => sum + r.full_batteries, 0);
  return { statements, total, changes };
}
