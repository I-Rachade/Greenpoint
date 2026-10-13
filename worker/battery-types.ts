import { batteryTypeLabel, validBatteryType, type BatteryType, type BatteryTypeInput } from "../src/lib/battery-types";
import type { AuditEntry, AuditTable } from "../src/lib/admin/types";
import { ApiError, nowIso, uuid } from "./http";

// Battery types of the motorbike brands, and which ones each station swaps. See src/lib/battery-types.ts and migration 0016_battery_types.sql.

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

/** Battery types each station swaps, brands and models sorted. */
export async function batteryTypesByStation(db: D1Database): Promise<Map<string, BatteryType[]>> {
  const { results } = await db
    .prepare(
      `select sbt.station_id, t.id, t.brand, t.name, t.is_active
       from station_battery_types sbt join battery_types t on t.id = sbt.battery_type_id
       order by t.brand, t.name`,
    )
    .all<TypeRow & { station_id: string }>();
  const out = new Map<string, BatteryType[]>();
  for (const r of results) out.set(r.station_id, [...(out.get(r.station_id) ?? []), toType(r)]);
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
  return {
    statements: [
      db.prepare("delete from station_battery_types where station_id = ?").bind(stationId),
      ...wanted.map((id) =>
        db.prepare("insert into station_battery_types (station_id, battery_type_id) values (?, ?)").bind(stationId, id),
      ),
    ],
    labels: wanted.map((id) => batteryTypeLabel(known.get(id)!)),
  };
}
