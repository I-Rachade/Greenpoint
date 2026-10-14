import { validEvCharger, type EvCharger, type EvChargerInput, type StationEvCharger } from "../src/lib/ev-chargers";
import type { AuditEntry, AuditTable } from "../src/lib/admin/types";
import { ApiError, nowIso, uuid } from "./http";

// Electric car chargers: added in the backoffice, then assigned to a station.
// See src/lib/ev-chargers.ts and migration 0020_ev_chargers.sql.

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

interface ChargerRow {
  id: string;
  name: string;
  connector: EvCharger["connector"];
  power_kw: number;
  station_id: string | null;
  is_active: number;
}

const toCharger = (r: ChargerRow): EvCharger => ({
  id: r.id,
  name: r.name,
  connector: r.connector,
  powerKw: r.power_kw,
  stationId: r.station_id,
  isActive: !!r.is_active,
});

const COLUMNS = "id, name, connector, power_kw, station_id, is_active";

export async function listEvChargers(db: D1Database): Promise<EvCharger[]> {
  const { results } = await db.prepare(`select ${COLUMNS} from ev_chargers order by name`).all<ChargerRow>();
  return results.map(toCharger);
}

/** Active chargers of each station, by name. */
export async function evChargersByStation(db: D1Database): Promise<Map<string, StationEvCharger[]>> {
  const { results } = await db
    .prepare(`select ${COLUMNS} from ev_chargers where station_id is not null and is_active = 1 order by name`)
    .all<ChargerRow>();
  const out = new Map<string, StationEvCharger[]>();
  for (const r of results) {
    const charger = { id: r.id, name: r.name, connector: r.connector, powerKw: r.power_kw };
    out.set(r.station_id!, [...(out.get(r.station_id!) ?? []), charger]);
  }
  return out;
}

/** Adds or changes a charger, including the station it is assigned to (admins). */
export async function saveEvCharger(c: Ctx, actor: string, id: string | null, input: EvChargerInput) {
  if (!validEvCharger(input)) throw new ApiError("bad_request");
  const row = {
    name: input.name.trim(),
    connector: input.connector,
    power_kw: Number(input.powerKw),
    station_id: input.stationId || null,
    is_active: input.isActive === false ? 0 : 1,
  };
  if (row.station_id && !(await c.db.prepare("select 1 from stations where id = ?").bind(row.station_id).first())) {
    throw new ApiError("station_not_found", 404);
  }
  if (id) {
    const before = await c.db
      .prepare("select name, connector, power_kw, station_id, is_active from ev_chargers where id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("not_found", 404);
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (before[k] !== v) changes[k] = [before[k], v];
    await c.db.batch([
      c.db
        .prepare("update ev_chargers set name = ?, connector = ?, power_kw = ?, station_id = ?, is_active = ? where id = ?")
        .bind(row.name, row.connector, row.power_kw, row.station_id, row.is_active, id),
      c.audit(actor, "ev_chargers", "update", id, changes, { stationId: row.station_id ?? (before.station_id as string | null) }),
    ]);
    return { id };
  }
  const newId = uuid();
  await c.db.batch([
    c.db
      .prepare("insert into ev_chargers (id, name, connector, power_kw, station_id, is_active, created_at) values (?, ?, ?, ?, ?, ?, ?)")
      .bind(newId, row.name, row.connector, row.power_kw, row.station_id, row.is_active, nowIso()),
    c.audit(actor, "ev_chargers", "insert", newId, row, { stationId: row.station_id }),
  ]);
  return { id: newId };
}

export async function deleteEvCharger(c: Ctx, actor: string, id: string) {
  const before = await c.db.prepare(`select ${COLUMNS} from ev_chargers where id = ?`).bind(id).first<ChargerRow>();
  if (!before) throw new ApiError("not_found", 404);
  const row = { name: before.name, connector: before.connector, power_kw: before.power_kw, station_id: before.station_id, is_active: before.is_active };
  await c.db.batch([
    c.db.prepare("delete from ev_chargers where id = ?").bind(id),
    c.audit(actor, "ev_chargers", "delete", id, row, { stationId: before.station_id }),
  ]);
  return { ok: true };
}
