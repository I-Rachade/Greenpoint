import { DEVICE_OFFLINE_MINUTES } from "../src/lib/iot/charging-points";
import { handleDeviceRequest, type Ingest } from "../src/lib/iot/device-events";
import type { ChargingPoint, ChargingPointStatus } from "../src/lib/types";
import type { Env } from "./env";
import { ApiError, nowIso, uuid } from "./http";

// Connected sockets (e.g. LoRa). See docs/steckdosen-lora.md.

/** Oldest last_seen_at that still counts as online. */
export function onlineSince(): string {
  return new Date(Date.now() - DEVICE_OFFLINE_MINUTES * 60_000).toISOString();
}

/**
 * Free connected outlets of station ?{station} that reported since ?{since}, so a
 * silent socket is never offered. Same rule as freeConnectedPoints() in the app.
 */
export function liveFreePointsSql(station: string, since: string): string {
  return `(select count(*) from charging_points where station_id = ${station} and device_id is not null
            and status = 'free' and last_seen_at > ${since})`;
}

/** Whether station ?{station} has connected outlets; then they replace the staff counter. */
export function hasConnectedPointsSql(station: string): string {
  return `exists (select 1 from charging_points where station_id = ${station} and device_id is not null)`;
}

interface PointRow {
  id: string;
  station_id: string;
  label: string;
  status: ChargingPointStatus;
  device_id: string | null;
  outlet: number | null;
  power_watts: number | null;
  last_seen_at: string | null;
}

/** Charging points per station, for the station list. */
export async function chargingPointsByStation(db: D1Database): Promise<Map<string, ChargingPoint[]>> {
  const { results } = await db
    .prepare("select id, station_id, label, status, device_id, outlet, power_watts, last_seen_at from charging_points order by label")
    .all<PointRow>();
  const byStation = new Map<string, ChargingPoint[]>();
  for (const p of results) {
    const list = byStation.get(p.station_id) ?? [];
    list.push({
      id: p.id,
      stationId: p.station_id,
      label: p.label,
      status: p.status,
      deviceId: p.device_id,
      outlet: p.outlet,
      powerWatts: p.power_watts,
      lastSeenAt: p.last_seen_at,
    });
    byStation.set(p.station_id, list);
  }
  return byStation;
}

/** Applies one normalized message from a device. */
export function ingest(db: D1Database): Ingest {
  return async (rawId, outlets, payload) => {
    const externalId = rawId.toUpperCase();
    const now = nowIso();
    await db
      .prepare("insert into device_messages (external_id, received_at, payload) values (?, ?, ?)")
      .bind(externalId, now, JSON.stringify(payload ?? {}))
      .run();

    const device = await db
      .prepare("select external_id, station_id from devices where external_id = ?")
      .bind(externalId)
      .first<{ external_id: string; station_id: string }>();
    if (!device) return { error: "unknown_device" };

    const statements: D1PreparedStatement[] = [
      db.prepare("update devices set last_seen_at = ? where external_id = ?").bind(now, externalId),
    ];
    let updated = 0;
    let plugIns = 0;
    for (const o of outlets) {
      const point = await db
        .prepare("select id, status from charging_points where device_id = ? and outlet = ?")
        .bind(externalId, o.outlet)
        .first<{ id: string; status: ChargingPointStatus }>();
      if (!point) continue;
      // A reserved outlet stays reserved while the device reports it free, so the rider's hold is not lost.
      const status = point.status === "reserved" && o.status === "free" ? point.status : (o.status ?? point.status);
      statements.push(
        db
          .prepare(
            "update charging_points set status = ?, power_watts = coalesce(?, power_watts), energy_wh = coalesce(?, energy_wh) where id = ?",
          )
          .bind(status, o.power_watts ?? null, o.energy_wh ?? null, point.id),
      );
      updated++;
      if (o.status === "charging" && point.status !== "charging") plugIns++;
    }

    // A rider plugged in: their slot reservation is used up, otherwise it would keep
    // holding a second outlet until it expires. The oldest ones are taken, since the
    // socket cannot tell who plugged in.
    if (plugIns) {
      const { results } = await db
        .prepare(
          `select id, user_id from reservations where station_id = ? and type = 'slot' and status = 'active' and expires_at > ?
           order by created_at limit ?`,
        )
        .bind(device.station_id, now, plugIns)
        .all<{ id: string; user_id: string }>();
      for (const r of results) {
        statements.push(
          db.prepare("update reservations set status = 'completed' where id = ? and status = 'active'").bind(r.id),
          db
            .prepare(
              "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, null, 'reservations', 'update', ?, ?, ?, ?)",
            )
            .bind(now, r.id, device.station_id, r.user_id, JSON.stringify({ status: ["active", "completed"], device: externalId })),
        );
      }
    }

    // A message without outlet data is a heartbeat: the device is alive.
    statements.push(db.prepare("update charging_points set last_seen_at = ? where device_id = ?").bind(now, externalId));
    // Recount the station's free slots from its live outlets, so the counter matches the map.
    statements.push(
      db
        .prepare(`update station_status set free_slots = ${liveFreePointsSql("?1", "?2")}, updated_at = ?3 where station_id = ?1`)
        .bind(device.station_id, onlineSince(), now),
    );
    await db.batch(statements);
    return { updated };
  };
}

/** POST /api/devices/events: messages from sockets, network servers or a vendor cloud. */
export function handleDeviceEvents(request: Request, env: Env): Promise<Response> {
  return handleDeviceRequest(request, env.DEVICE_WEBHOOK_SECRET, ingest(env.DB));
}

export interface DeviceInput {
  externalId: string;
  stationId: string;
  vendor?: string;
  model?: string;
  link?: "lorawan" | "vendor_cloud" | "own_server";
  outlets?: number;
}

/** Registers a socket and creates one charging point per outlet, labelled "<last 4 of id>-<outlet>". */
export async function createDevice(db: D1Database, input: DeviceInput) {
  const externalId = String(input.externalId ?? "").trim().toUpperCase();
  const outlets = Math.floor(Number(input.outlets ?? 2));
  const link = input.link ?? "lorawan";
  if (!/^[0-9A-Z:_-]{4,64}$/.test(externalId) || !(outlets >= 1 && outlets <= 16)) throw new ApiError("bad_request");
  if (!["lorawan", "vendor_cloud", "own_server"].includes(link)) throw new ApiError("bad_request");
  const station = await db.prepare("select id from stations where id = ?").bind(String(input.stationId)).first();
  if (!station) throw new ApiError("station_not_found", 404);

  const now = nowIso();
  const statements = [
    db
      .prepare("insert into devices (external_id, station_id, vendor, model, link, outlets, created_at) values (?, ?, ?, ?, ?, ?, ?)")
      .bind(externalId, input.stationId, String(input.vendor ?? ""), String(input.model ?? ""), link, outlets, now),
  ];
  for (let n = 1; n <= outlets; n++) {
    statements.push(
      db
        .prepare("insert into charging_points (id, station_id, label, status, device_id, outlet, created_at) values (?, ?, ?, 'free', ?, ?, ?)")
        .bind(uuid(), input.stationId, `${externalId.slice(-4)}-${n}`, externalId, n, now),
    );
  }
  // Nothing is offered until the device reports.
  statements.push(
    db
      .prepare(`update station_status set free_slots = ${liveFreePointsSql("?1", "?2")} where station_id = ?1`)
      .bind(input.stationId, onlineSince()),
  );
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY/i.test(String(err))) throw new ApiError("bad_request", 409);
    throw err;
  }
  return { externalId, outlets };
}
