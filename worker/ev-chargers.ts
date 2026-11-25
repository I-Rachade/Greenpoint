import { canSwitch, type Device, type DeviceProtocol } from "../shared/iot/devices";
import { validEvCharger, type EvCharger, type EvChargerInput, type StationEvCharger } from "../shared/ev-chargers";
import type { AuditEntry, AuditTable } from "../shared/admin/types";
import type { ChargingPointStatus } from "../shared/types";
import { ApiError, nowIso, uuid } from "./http";

// Electric car chargers: added in the backoffice, then assigned to a station.
// See shared/ev-chargers.ts and migrations 0020_ev_chargers.sql, 0048_ev_payment.sql
// (a charger connected to an outlet of a connected device is started and paid in the app).

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
  point_id: string | null;
}

const toCharger = (r: ChargerRow): EvCharger => ({
  id: r.id,
  name: r.name,
  connector: r.connector,
  powerKw: r.power_kw,
  stationId: r.station_id,
  isActive: !!r.is_active,
  pointId: r.point_id,
});

const COLUMNS = "id, name, connector, power_kw, station_id, is_active, point_id";

/** Every charger, a linked one with its outlet's device and live state (backoffice test buttons). */
export async function listEvChargers(db: D1Database): Promise<EvCharger[]> {
  const { results } = await db
    .prepare(
      `select e.id, e.name, e.connector, e.power_kw, e.station_id, e.is_active, e.point_id,
              p.outlet as p_outlet, p.status as p_status, p.last_seen_at as p_seen, p.qr_start as p_qr,
              p.power_watts as p_power, p.energy_wh as p_energy, p.soc_percent as p_soc, d.model as d_model,
              d.external_id as d_id, d.vendor as d_vendor, d.link as d_link, d.protocol as d_protocol,
              coalesce(d.qr_code, d.qr_token) as d_qr
         from ev_chargers e
         left join charging_points p on p.id = e.point_id
         left join devices d on d.external_id = p.device_id
        order by e.name`,
    )
    .all<
      ChargerRow & {
        p_outlet: number | null;
        p_status: ChargingPointStatus | null;
        p_seen: string | null;
        d_id: string | null;
        d_vendor: string | null;
        d_link: Device["link"] | null;
        d_protocol: DeviceProtocol | null;
        p_qr: number | null;
        p_power: number | null;
        p_energy: number | null;
        p_soc: number | null;
        d_model: string | null;
        d_qr: string | null;
      }
    >();
  return results.map((r) => ({
    ...toCharger(r),
    outlet:
      r.d_id && r.p_outlet !== null
        ? {
            deviceId: r.d_id,
            vendor: r.d_vendor ?? "",
            outlet: r.p_outlet,
            status: r.p_status ?? "free",
            lastSeenAt: r.p_seen,
            model: r.d_model ?? "",
            ocpp: r.d_protocol === "ocpp1.6",
            powerWatts: r.p_power,
            energyWh: r.p_energy,
            socPercent: r.p_soc,
            switchable: canSwitch({ externalId: r.d_id, vendor: r.d_vendor ?? "", link: r.d_link!, protocol: r.d_protocol }),
            qrStart: !!r.p_qr,
            qrCode: r.d_qr,
          }
        : null,
  }));
}

/** Active chargers of each station, by name; a connected one with its outlet's state. */
export async function evChargersByStation(db: D1Database): Promise<Map<string, StationEvCharger[]>> {
  const { results } = await db
    .prepare(
      `select e.id, e.name, e.connector, e.power_kw, e.station_id, e.is_active, e.point_id,
              p.status as p_status, p.device_id as p_device, p.outlet as p_outlet, p.last_seen_at as p_seen, p.qr_start as p_qr
         from ev_chargers e left join charging_points p on p.id = e.point_id and p.device_id is not null
        where e.station_id is not null and e.is_active = 1 order by e.name`,
    )
    .all<ChargerRow & { p_status: ChargingPointStatus | null; p_device: string | null; p_outlet: number | null; p_seen: string | null; p_qr: number | null }>();
  const out = new Map<string, StationEvCharger[]>();
  for (const r of results) {
    const point = r.point_id && r.p_device
      ? { point: { id: r.point_id, status: r.p_status!, deviceId: r.p_device, outlet: r.p_outlet, lastSeenAt: r.p_seen, ...(r.p_qr ? { qrStart: true } : {}) } }
      : {};
    const charger = { id: r.id, name: r.name, connector: r.connector, powerKw: r.power_kw, ...point };
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
    point_id: input.pointId || null,
  };
  if (row.station_id && !(await c.db.prepare("select 1 from stations where id = ?").bind(row.station_id).first())) {
    throw new ApiError("station_not_found", 404);
  }
  if (row.point_id) {
    // An outlet of a connected device at the charger's station, not another charger's.
    const point = await c.db
      .prepare(
        `select p.station_id, (select id from ev_chargers where point_id = p.id) as charger
           from charging_points p where p.id = ? and p.device_id is not null and p.outlet is not null`,
      )
      .bind(row.point_id)
      .first<{ station_id: string; charger: string | null }>();
    if (!point || point.station_id !== row.station_id) throw new ApiError("bad_request");
    if (point.charger && point.charger !== id) throw new ApiError("outlet_busy", 409);
  }
  if (id) {
    const before = await c.db
      .prepare("select name, connector, power_kw, station_id, is_active, point_id from ev_chargers where id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("not_found", 404);
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) if (before[k] !== v) changes[k] = [before[k], v];
    await c.db.batch([
      c.db
        .prepare("update ev_chargers set name = ?, connector = ?, power_kw = ?, station_id = ?, is_active = ?, point_id = ? where id = ?")
        .bind(row.name, row.connector, row.power_kw, row.station_id, row.is_active, row.point_id, id),
      c.audit(actor, "ev_chargers", "update", id, changes, { stationId: row.station_id ?? (before.station_id as string | null) }),
    ]);
    return { id };
  }
  const newId = uuid();
  await c.db.batch([
    c.db
      .prepare("insert into ev_chargers (id, name, connector, power_kw, station_id, is_active, point_id, created_at) values (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(newId, row.name, row.connector, row.power_kw, row.station_id, row.is_active, row.point_id, nowIso()),
    c.audit(actor, "ev_chargers", "insert", newId, row, { stationId: row.station_id }),
  ]);
  return { id: newId };
}

export async function deleteEvCharger(c: Ctx, actor: string, id: string) {
  const before = await c.db.prepare(`select ${COLUMNS} from ev_chargers where id = ?`).bind(id).first<ChargerRow>();
  if (!before) throw new ApiError("not_found", 404);
  const row = {
    name: before.name,
    connector: before.connector,
    power_kw: before.power_kw,
    station_id: before.station_id,
    is_active: before.is_active,
    point_id: before.point_id,
  };
  await c.db.batch([
    c.db.prepare("delete from ev_chargers where id = ?").bind(id),
    c.audit(actor, "ev_chargers", "delete", id, row, { stationId: before.station_id }),
  ]);
  return { ok: true };
}
