import type { AuditEntry, AuditTable } from "../src/lib/admin/types";
import { cleanRepairCenter, type RepairCenter, type RepairCenterInput } from "../src/lib/repair-centers";
import { ApiError, nowIso, uuid } from "./http";

// Repair workshops away from stations: listed in the app, managed in the backoffice.
// See src/lib/repair-centers.ts and migration 0046_repair_centers.sql.

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

interface Row {
  id: string;
  operator_id: string | null;
  operator_name: string | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  phone: string | null;
  opening_hours: string;
  is_active: number;
}

const toCenter = (r: Row): RepairCenter => ({
  id: r.id,
  operatorId: r.operator_id,
  operatorName: r.operator_name,
  name: r.name,
  address: r.address,
  lat: r.lat,
  lng: r.lng,
  phone: r.phone,
  openingHours: r.opening_hours,
  isActive: !!r.is_active,
});

const SELECT = `select r.*, o.name as operator_name from repair_centers r left join operators o on o.id = r.operator_id`;

/** Every workshop (backoffice), or only the active ones (app). */
export async function listRepairCenters(db: D1Database, activeOnly: boolean): Promise<RepairCenter[]> {
  const { results } = await db.prepare(`${SELECT} ${activeOnly ? "where r.is_active = 1" : ""} order by r.name`).all<Row>();
  return results.map(toCenter);
}

/** Adds or changes a workshop (admins). */
export async function saveRepairCenter(c: Ctx, actor: string, id: string | null, input: RepairCenterInput) {
  const clean = cleanRepairCenter(input);
  if (!clean) throw new ApiError("bad_request");
  if (clean.operatorId && !(await c.db.prepare("select 1 from operators where id = ?").bind(clean.operatorId).first())) {
    throw new ApiError("not_found", 404);
  }
  const row = {
    operator_id: clean.operatorId,
    name: clean.name,
    address: clean.address,
    lat: clean.lat,
    lng: clean.lng,
    phone: clean.phone,
    opening_hours: clean.openingHours,
    is_active: clean.isActive ? 1 : 0,
  };
  if (id) {
    const before = await c.db
      .prepare("select operator_id, name, address, lat, lng, phone, opening_hours, is_active from repair_centers where id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("not_found", 404);
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (before[k] !== v) changes[k] = [before[k], v];
    await c.db.batch([
      c.db
        .prepare("update repair_centers set operator_id = ?, name = ?, address = ?, lat = ?, lng = ?, phone = ?, opening_hours = ?, is_active = ? where id = ?")
        .bind(...Object.values(row), id),
      c.audit(actor, "repair_centers", "update", id, changes),
    ]);
    return { id };
  }
  const newId = uuid();
  await c.db.batch([
    c.db
      .prepare(
        "insert into repair_centers (id, operator_id, name, address, lat, lng, phone, opening_hours, is_active, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(newId, ...Object.values(row), nowIso()),
    c.audit(actor, "repair_centers", "insert", newId, row),
  ]);
  return { id: newId };
}

export async function deleteRepairCenter(c: Ctx, actor: string, id: string) {
  const before = await c.db.prepare("select * from repair_centers where id = ?").bind(id).first<Record<string, unknown>>();
  if (!before) throw new ApiError("not_found", 404);
  await c.db.batch([c.db.prepare("delete from repair_centers where id = ?").bind(id), c.audit(actor, "repair_centers", "delete", id, before)]);
  return { ok: true };
}
