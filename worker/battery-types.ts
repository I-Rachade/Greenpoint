import { batteryTypeLabel, cleanTypeCapacity, validBatteryType, type BatteryType, type BatteryTypeInput, type StationBatteryType } from "../shared/battery-types";
import type { AuditEntry, AuditTable } from "../shared/admin/types";
import { cleanUssdTemplate, isBatteryPricing, validEnergyPrice } from "../shared/energy-swap";
import { ApiError, nowIso, uuid } from "./http";

// Battery types of the motorbike brands, and which ones each station swaps. See shared/battery-types.ts and migration 0017_battery_types.sql.

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
  pricing: "station" | "energy";
  price_full_xof: number | null;
  ussd_tmoney: string | null;
  ussd_flooz: string | null;
}

const TYPE_COLUMNS = "id, brand, name, is_active, pricing, price_full_xof, ussd_tmoney, ussd_flooz";

const toType = (r: TypeRow): BatteryType => ({
  id: r.id,
  brand: r.brand,
  name: r.name,
  isActive: !!r.is_active,
  pricing: r.pricing,
  priceFullXof: r.price_full_xof,
  ussdTmoney: r.ussd_tmoney,
  ussdFlooz: r.ussd_flooz,
});

export async function listBatteryTypes(db: D1Database): Promise<BatteryType[]> {
  const { results } = await db.prepare(`select ${TYPE_COLUMNS} from battery_types order by brand, name`).all<TypeRow>();
  return results.map(toType);
}

/** Battery types each station swaps with their full batteries and places, brands and models sorted. */
export async function batteryTypesByStation(db: D1Database): Promise<Map<string, StationBatteryType[]>> {
  const { results } = await db
    .prepare(
      `select sbt.station_id, sbt.full_batteries, sbt.capacity, t.id, t.brand, t.name, t.is_active,
              t.pricing, t.price_full_xof, t.ussd_tmoney, t.ussd_flooz
       from station_battery_types sbt join battery_types t on t.id = sbt.battery_type_id
       order by t.brand, t.name`,
    )
    .all<TypeRow & { station_id: string; full_batteries: number; capacity: number }>();
  const out = new Map<string, StationBatteryType[]>();
  for (const r of results) {
    out.set(r.station_id, [...(out.get(r.station_id) ?? []), { ...toType(r), fullBatteries: r.full_batteries, capacity: r.capacity }]);
  }
  return out;
}

/**
 * Pricing fields of a battery type as typed in the backoffice (0065): "energy" needs its price for
 * 100 % and at least one USSD code; "station" clears them. Absent pricing: nothing changes.
 */
function pricingRow(input: BatteryTypeInput): Record<string, unknown> {
  if (input.pricing === undefined) return {};
  if (!isBatteryPricing(input.pricing)) throw new ApiError("bad_request");
  if (input.pricing === "station") return { pricing: "station", price_full_xof: null, ussd_tmoney: null, ussd_flooz: null };
  if (!validEnergyPrice(input.priceFullXof)) throw new ApiError("energy_price_required");
  const tmoney = cleanUssdTemplate(input.ussdTmoney);
  const flooz = cleanUssdTemplate(input.ussdFlooz);
  if (tmoney === undefined || flooz === undefined) throw new ApiError("invalid_ussd");
  if (!tmoney && !flooz) throw new ApiError("ussd_required");
  return { pricing: "energy", price_full_xof: input.priceFullXof, ussd_tmoney: tmoney, ussd_flooz: flooz };
}

/** Creates or updates a battery type (admins); prices only change with an admin's save, in the audit log. */
export async function saveBatteryType(c: Ctx, actor: string, id: string | null, input: BatteryTypeInput) {
  if (!validBatteryType(input)) throw new ApiError("bad_request");
  const row: Record<string, unknown> = {
    brand: input.brand.trim(),
    name: input.name.trim(),
    is_active: input.isActive === false ? 0 : 1,
    ...pricingRow(input),
  };
  const columns = Object.keys(row);
  try {
    if (id) {
      const before = await c.db.prepare(`select ${columns.join(", ")} from battery_types where id = ?`).bind(id).first<Record<string, unknown>>();
      if (!before) throw new ApiError("not_found", 404);
      const changes: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(row)) if (before[k] !== v) changes[k] = [before[k], v];
      await c.db.batch([
        c.db
          .prepare(`update battery_types set ${columns.map((k) => `${k} = ?`).join(", ")} where id = ?`)
          .bind(...columns.map((k) => row[k]), id),
        c.audit(actor, "battery_types", "update", id, changes),
      ]);
      return { id };
    }
    const newId = uuid();
    await c.db.batch([
      c.db
        .prepare(`insert into battery_types (id, ${columns.join(", ")}, created_at) values (?, ${columns.map(() => "?").join(", ")}, ?)`)
        .bind(newId, ...columns.map((k) => row[k]), nowIso()),
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
 * swap point) with their places, their labels for the audit log and the station's
 * places (their sum). Unknown ids are refused. Without `capacities`, kept types keep
 * their places and new ones have none.
 */
export async function stationBatteryTypeStatements(
  db: D1Database,
  stationId: string,
  ids: string[],
  swaps: boolean,
  capacities?: Record<string, number>,
) {
  const wanted = swaps ? [...new Set((ids ?? []).map(String))] : [];
  const known = new Map((await listBatteryTypes(db)).map((t) => [t.id, t]));
  if (wanted.some((id) => !known.has(id))) throw new ApiError("bad_request");
  const { results } = await db
    .prepare("select battery_type_id, capacity from station_battery_types where station_id = ?")
    .bind(stationId)
    .all<{ battery_type_id: string; capacity: number }>();
  const before = new Map(results.map((r) => [r.battery_type_id, r.capacity]));
  const places = new Map(
    wanted.map((id) => [id, capacities && id in capacities ? cleanTypeCapacity(capacities[id]) : (before.get(id) ?? 0)]),
  );
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
        db
          .prepare(
            `insert into station_battery_types (station_id, battery_type_id, capacity) values (?, ?, ?)
             on conflict (station_id, battery_type_id) do update set capacity = excluded.capacity`,
          )
          .bind(stationId, id, places.get(id)!),
      ),
    ],
    labels: wanted.map((id) => batteryTypeLabel(known.get(id)!)),
    /** Places by type id, as saved. */
    places,
    /** Type ids whose places went down. */
    lowered: wanted.filter((id) => before.has(id) && places.get(id)! < before.get(id)!),
  };
}
