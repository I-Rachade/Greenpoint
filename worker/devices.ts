import { DEVICE_OFFLINE_MINUTES } from "../src/lib/iot/charging-points";
import { deviceKeyError, handleDeviceRequest, type Ingest } from "../src/lib/iot/device-events";
import { xingkeOrderNumber, xingkeStartCommand, xingkeStopCommand } from "../src/lib/iot/xingke-commands";
import {
  XINGKE_ID,
  xingkeMessageId,
  xingkeStartRequest,
  xingkeStopRequest,
  xingkeTransactionId,
  type XingkeCommand,
} from "../src/lib/iot/xingke-cloud";
import {
  commandRoute,
  normalizeDeviceId,
  type CommandRoute,
  outletLabel,
  validDeviceInput,
  type Device,
  type DeviceInput,
  type DeviceLink,
  type DeviceProtocol,
} from "../src/lib/iot/devices";
import type { ChargingPoint, ChargingPointStatus } from "../src/lib/types";
import type { Env } from "./env";
import { ApiError, nowIso, sha256, uuid } from "./http";
import { dispatchXingkeCommand } from "./xingke";
import { evTargetSql } from "./reservations";
import { ocppIdTag, ocppKey, remoteStartRequest, remoteStopRequest } from "../src/lib/iot/ocpp";
import { sendOcppCommand } from "./ocpp";
import { earnStatement } from "./greenpoint";
import { chargeReadingStatement, creditFollowUp, hasOpenCharge } from "./charging";

// Connected sockets (e.g. LoRa). See docs/steckdosen-lora.md.

/** Oldest last_seen_at that still counts as online. */
/** A box's QR token (devices.qr_token): 128 random bits, never derived from the device id. */
export function newBoxToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function onlineSince(): string {
  return new Date(Date.now() - DEVICE_OFFLINE_MINUTES * 60_000).toISOString();
}

/**
 * Free connected outlets of station ?{station} that reported since ?{since}, so a
 * silent socket is never offered. Same rule as freeConnectedPoints() in the app.
 */
export function liveFreePointsSql(station: string, since: string): string {
  return `(select count(*) from charging_points where station_id = ${station} and device_id is not null
            and status = 'free' and last_seen_at > ${since} and ${notEvPointSql("charging_points")})`;
}

/** Whether station ?{station} has connected outlets; then they replace the staff counter. */
export function hasConnectedPointsSql(station: string): string {
  return `exists (select 1 from charging_points where station_id = ${station} and device_id is not null and ${notEvPointSql("charging_points")})`;
}

/**
 * SQL: outlet `alias` is a motorbike place, not the outlet of a connected car charger
 * (ev_chargers.point_id, 0048), which counts as the car charger only.
 */
export function notEvPointSql(alias: string): string {
  return `not exists (select 1 from ev_chargers ev_p where ev_p.point_id = ${alias}.id)`;
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
  qr_start: number;
}

/** Charging points per station, for the station list. */
export async function chargingPointsByStation(db: D1Database): Promise<Map<string, ChargingPoint[]>> {
  const { results } = await db
    .prepare(
      `select id, station_id, label, status, device_id, outlet, power_watts, last_seen_at, qr_start from charging_points
        where ${notEvPointSql("charging_points")} order by label`,
    )
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
      ...(p.qr_start ? { qrStart: true } : {}),
    });
    byStation.set(p.station_id, list);
  }
  return byStation;
}

/** Applies one normalized message from a device. */
export function ingest(db: D1Database): Ingest {
  return async (rawId, outlets, payload, extra = {}) => {
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
    /** Outlets a customer plugged into now: a reservation for one of them is the one used. */
    const plugged: string[] = [];
    for (const o of outlets) {
      const point = await db
        .prepare("select id, status from charging_points where device_id = ? and outlet = ?")
        .bind(externalId, o.outlet)
        .first<{ id: string; status: ChargingPointStatus }>();
      if (!point) continue;
      // A reserved outlet stays reserved while the device reports it free, so the customer's hold is not lost.
      const status = point.status === "reserved" && o.status === "free" ? point.status : (o.status ?? point.status);
      statements.push(
        db
          .prepare(
            "update charging_points set status = ?, power_watts = coalesce(?, power_watts), energy_wh = coalesce(?, energy_wh) where id = ?",
          )
          .bind(status, o.power_watts ?? null, o.energy_wh ?? null, point.id),
      );
      // The charge staff started on this outlet adds up the energy and ends with it (worker/charging.ts).
      statements.push(chargeReadingStatement(db, point.id, o.status, o.energy_wh, now, o.transaction_id));
      updated++;
      // A charge staff started is not a reservation's plug-in.
      if (o.status === "charging" && point.status !== "charging" && !(await hasOpenCharge(db, point.id))) {
        plugIns++;
        plugged.push(point.id);
      }
    }

    // A customer plugged in: their outlet reservation is used up, otherwise it would keep
    // holding a second outlet until it expires. A reservation for that outlet first, then
    // the oldest ones, since the socket cannot tell who plugged in. Car chargers never.
    if (plugIns) {
      const { results } = await db
        .prepare(
          `select r.id, r.user_id from reservations r where r.station_id = ?1 and r.kind = 'charging_point' and r.status = 'active' and r.expires_at > ?2
             and not ${evTargetSql("r")}
           order by case when r.target in (select value from json_each(?4)) then 0 else 1 end, r.created_at limit ?3`,
        )
        .bind(device.station_id, now, plugIns, JSON.stringify(plugged))
        .all<{ id: string; user_id: string }>();
      for (const r of results) {
        // The rider's CO2 and greenpoints for this charge (worker/greenpoint.ts).
        const earned = await earnStatement(db, { userId: r.user_id, type: "slot", stationId: device.station_id, reservationId: r.id, createdBy: null });
        if (earned) statements.push(earned.statement);
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

    // A fault of the whole device takes every outlet out until it reports again.
    if (extra.allOutlets) {
      statements.push(db.prepare("update charging_points set status = ? where device_id = ?").bind(extra.allOutlets, externalId));
    }
    // The answer to a command we queued closes it.
    if (extra.ack) {
      statements.push(
        db
          .prepare(
            `update device_commands set status = ?, result = ?, done_at = ?
             where external_id = ? and order_no = ? and kind = ? and status in ('pending', 'sent')`,
          )
          .bind(extra.ack.ok ? "done" : "failed", extra.ack.code ?? null, now, externalId, extra.ack.order, extra.ack.kind),
      );
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
  const apply = ingest(env.DB);
  return handleDeviceRequest(request, env.DEVICE_WEBHOOK_SECRET, async (externalId, outlets, payload, extra) => {
    const result = await apply(externalId, outlets, payload, extra);
    // Green Credit charges: stopped when the credit is used up, paid once they ended (0047).
    await creditFollowUp(env, externalId);
    return result;
  });
}

function auditDevice(db: D1Database, actor: string, action: "insert" | "delete", device: string, stationId: string, changes: object) {
  return db
    .prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'charging_points', ?, ?, ?, null, ?)",
    )
    .bind(nowIso(), actor, action, device, stationId, JSON.stringify(changes));
}

/** Recounts a station's free slots from its live outlets, if it still has any. */
export function recountFreeSlots(db: D1Database, stationId: string) {
  return db
    .prepare(
      `update station_status set free_slots = ${liveFreePointsSql("?1", "?2")}, updated_at = ?3
       where station_id = ?1 and ${hasConnectedPointsSql("?1")}`,
    )
    .bind(stationId, onlineSince(), nowIso());
}

/**
 * A station's charging places are its connected outlets: sets charging_slots to their
 * number and keeps the staff counter within it.
 */
export function syncChargingSlots(db: D1Database, stationId: string): D1PreparedStatement[] {
  return [
    db
      .prepare(`update stations set charging_slots = (select count(*) from charging_points where station_id = ?1 and device_id is not null
         and ${notEvPointSql("charging_points")}) where id = ?1`)
      .bind(stationId),
    db
      .prepare("update station_status set free_slots = min(free_slots, (select charging_slots from stations where id = ?1)) where station_id = ?1")
      .bind(stationId),
  ];
}

/** Registers a socket and creates one charging point per outlet, labelled "<last 4 of id>-<outlet>". */
export async function createDevice(db: D1Database, input: DeviceInput, actor: string) {
  if (!validDeviceInput(input)) throw new ApiError("invalid_device");
  const externalId = normalizeDeviceId(input.externalId);
  const outlets = input.outlets ?? 2;
  const link = input.link ?? "lorawan";
  const stationId = String(input.stationId);
  const station = await db.prepare("select id from stations where id = ?").bind(stationId).first();
  if (!station) throw new ApiError("station_not_found", 404);

  const now = nowIso();
  const vendor = String(input.vendor ?? "").trim().slice(0, 80);
  const model = String(input.model ?? "").trim().slice(0, 80);
  // The vendor's API wants the id exactly as typed.
  const vendorRef = String(input.externalId).trim();
  const protocol = input.protocol ?? null;
  if (commandRoute({ externalId, vendor, link, protocol }) === "xingke_cloud" && !XINGKE_ID.test(vendorRef)) throw new ApiError("invalid_device");
  // An OCPP charge point logs in with this key; only its hash is kept, so it is shown once.
  // Without a key (firmware that cannot send a password) anyone with the id can connect.
  const key = protocol === "ocpp1.6" && !input.ocppNoPassword ? ocppKey() : null;
  const statements = [
    db
      .prepare(
        `insert into devices (external_id, station_id, vendor, model, link, outlets, vendor_ref, protocol, ocpp_key_hash, qr_token, created_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(externalId, stationId, vendor, model, link, outlets, vendorRef, protocol, key && (await sha256(key)), newBoxToken(), now),
  ];
  for (let n = 1; n <= outlets; n++) {
    statements.push(
      db
        .prepare("insert into charging_points (id, station_id, label, status, device_id, outlet, created_at) values (?, ?, ?, 'free', ?, ?, ?)")
        .bind(uuid(), stationId, outletLabel(externalId, n), externalId, n, now),
    );
  }
  // Nothing is offered until the device reports.
  statements.push(...syncChargingSlots(db, stationId), recountFreeSlots(db, stationId));
  // A connected socket makes the station a charging point.
  statements.push(
    db
      .prepare(
        `update stations set kind = case when has_battery = 0 or kind = 'charging' then 'charging' else 'both' end, has_battery = 1
         where id = ? and not (has_battery = 1 and kind in ('charging', 'both'))`,
      )
      .bind(stationId),
  );
  const noPassword = protocol === "ocpp1.6" && !key;
  statements.push(auditDevice(db, actor, "insert", externalId, stationId, { device: externalId, outlets, vendor, model, link, protocol, ...(noPassword ? { ocppNoPassword: true } : {}) }));
  try {
    await db.batch(statements);
  } catch (err) {
    if (/UNIQUE|PRIMARY KEY/i.test(String(err))) throw new ApiError("device_exists", 409);
    throw err;
  }
  return key ? { externalId, outlets, ocppKey: key } : { externalId, outlets };
}

interface DeviceRow {
  external_id: string;
  station_id: string;
  vendor: string;
  model: string;
  link: DeviceLink;
  outlets: number;
  protocol: DeviceProtocol | null;
  ocpp_key_hash: string | null;
  last_seen_at: string | null;
  created_at: string;
  partner_id: string | null;
  qr_token: string | null;
}

/** All sockets with their outlets, newest first. */
export async function listDevices(db: D1Database): Promise<Device[]> {
  const [{ results }, points] = await Promise.all([
    db.prepare("select * from devices order by created_at desc").all<DeviceRow>(),
    chargingPointsByStation(db),
  ]);
  const all = [...points.values()].flat();
  return results.map((d) => ({
    externalId: d.external_id,
    stationId: d.station_id,
    vendor: d.vendor,
    model: d.model,
    link: d.link,
    outlets: d.outlets,
    protocol: d.protocol,
    ocppOpen: d.protocol === "ocpp1.6" && !d.ocpp_key_hash,
    lastSeenAt: d.last_seen_at,
    createdAt: d.created_at,
    partnerId: d.partner_id ?? null,
    qrToken: d.qr_token ?? null,
    points: all.filter((p) => p.deviceId === d.external_id).sort((a, b) => (a.outlet ?? 0) - (b.outlet ?? 0)),
  }));
}

/** Removes a socket, its charging points and queued commands; refused while one of its outlets is charging. */
export async function deleteDevice(db: D1Database, rawId: string, actor: string) {
  const externalId = normalizeDeviceId(rawId);
  const device = await db
    .prepare("select station_id, outlets from devices where external_id = ?")
    .bind(externalId)
    .first<{ station_id: string; outlets: number }>();
  if (!device) throw new ApiError("not_found", 404);
  // A running charge would lose its outlet and could never be stopped from the app.
  const charging = await db
    .prepare("select 1 as busy from charging_sessions where device_id = ? and status = 'charging' limit 1")
    .bind(externalId)
    .first<{ busy: number }>();
  if (charging) throw new ApiError("charge_busy", 409);
  await db.batch([
    db.prepare("delete from device_commands where external_id = ?").bind(externalId),
    db.prepare("delete from charging_points where device_id = ?").bind(externalId),
    db.prepare("delete from devices where external_id = ?").bind(externalId),
    ...syncChargingSlots(db, device.station_id),
    recountFreeSlots(db, device.station_id),
    auditDevice(db, actor, "delete", externalId, device.station_id, { device: externalId, outlets: device.outlets }),
  ]);
  return { ok: true };
}

// Commands -------------------------------------------------------------------

/** A command not fetched by the bridge within this time is dropped, so an outlet never switches on late. */
const COMMAND_TTL_SECONDS = 120;

interface CommandTarget {
  externalId: string;
  /** The id the vendor's API knows the device by. */
  vendorRef: string;
  route: CommandRoute;
}

async function commandTarget(db: D1Database, rawId: string, outlet: number): Promise<CommandTarget> {
  const externalId = normalizeDeviceId(rawId);
  const device = await db
    .prepare(
      `select d.vendor, d.link, d.vendor_ref, d.protocol from devices d join charging_points p on p.device_id = d.external_id
       where d.external_id = ? and p.outlet = ?`,
    )
    .bind(externalId, outlet)
    .first<{ vendor: string; link: DeviceLink; vendor_ref: string | null; protocol: DeviceProtocol | null }>();
  if (!device) throw new ApiError("not_found", 404);
  const route = commandRoute({ externalId, vendor: device.vendor, link: device.link, protocol: device.protocol });
  if (!route) throw new ApiError("bad_request"); // this socket only reports
  return { externalId, vendorRef: device.vendor_ref ?? externalId, route };
}

/** Stores a cloud command, then sends it to the vendor platform. */
async function sendCloud(env: Env, target: CommandTarget, outlet: number, kind: "start" | "stop", command: XingkeCommand, actor: string) {
  await env.DB.prepare(
    `insert into device_commands (external_id, outlet, kind, order_no, line, message_id, created_by, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(target.externalId, outlet, kind, String(command.data.transactionId), JSON.stringify(command), command.messageId, actor, nowIso())
    .run();
  await dispatchXingkeCommand(env, target.vendorRef, command);
}

/** Stores an OCPP command, then hands it to the charge point's connection. */
async function sendOcpp(env: Env, target: CommandTarget, outlet: number, kind: "start" | "stop", order: string, action: string, payload: object, actor: string) {
  const messageId = uuid();
  const row = await env.DB.prepare(
    `insert into device_commands (external_id, outlet, kind, order_no, line, message_id, created_by, created_at)
     values (?, ?, ?, ?, ?, ?, ?, ?) returning id`,
  )
    .bind(target.externalId, outlet, kind, order, JSON.stringify([2, messageId, action, payload]), messageId, actor, nowIso())
    .first<{ id: number }>();
  await sendOcppCommand(env, target.externalId, row!.id, messageId, action, payload);
}

/** Switches an outlet on, until full or for `minutes` (1 to 998). */
export async function startOutlet(env: Env, rawId: string, outlet: number, actor: string, minutes?: number) {
  const target = await commandTarget(env.DB, rawId, outlet);
  if (minutes !== undefined && !(Number.isInteger(minutes) && minutes >= 1 && minutes <= 998)) throw new ApiError("bad_request");
  if (target.route === "ocpp") {
    // OCPP 1.6 has no timed start without charging profiles; the charge runs until stopped or full.
    if (minutes !== undefined) throw new ApiError("bad_request");
    const idTag = ocppIdTag();
    await sendOcpp(env, target, outlet, "start", idTag, "RemoteStartTransaction", remoteStartRequest(outlet, idTag), actor);
    return { order: idTag };
  }
  if (target.route === "xingke_cloud") {
    const order = xingkeTransactionId();
    const command = xingkeStartRequest(xingkeMessageId("start"), outlet, order, minutes === undefined ? undefined : minutes * 60);
    await sendCloud(env, target, outlet, "start", command, actor);
    return { order };
  }
  const order = xingkeOrderNumber();
  const line = xingkeStartCommand(target.externalId, outlet, order, minutes);
  await env.DB.prepare(
    "insert into device_commands (external_id, outlet, kind, order_no, line, created_by, created_at) values (?, ?, 'start', ?, ?, ?, ?)",
  )
    .bind(target.externalId, outlet, order, line, actor, nowIso())
    .run();
  return { order };
}

/** Switches a Xingke cloud outlet on for the card charge `order` (worker/xingke.ts), until full. */
export async function startCardOutlet(env: Env, externalId: string, outlet: number, order: string, actor: string) {
  const target = await commandTarget(env.DB, externalId, outlet);
  if (target.route !== "xingke_cloud") throw new ApiError("bad_request");
  await sendCloud(env, target, outlet, "start", xingkeStartRequest(xingkeMessageId("start"), outlet, order, undefined, "Card"), actor);
}

/** Switches an outlet off, ending its last started charge. */
export async function stopOutlet(env: Env, rawId: string, outlet: number, actor: string) {
  const target = await commandTarget(env.DB, rawId, outlet);
  if (target.route === "ocpp") {
    // OCPP stops a charge, not an outlet: the connector's open transaction.
    const tx = await env.DB.prepare(
      "select id from ocpp_transactions where external_id = ? and connector_id = ? and stopped_at is null order by id desc limit 1",
    )
      .bind(target.externalId, outlet)
      .first<{ id: number }>();
    if (!tx) {
      // Not started yet: a start still waiting on the charge point may no longer charge (tagStatus in ocpp.ts).
      await env.DB.prepare(
        `update device_commands set status = 'expired', done_at = ? where external_id = ? and outlet = ? and kind = 'start'
         and message_id is not null and status in ('pending', 'sent', 'done')
         and not exists (select 1 from ocpp_transactions t where t.external_id = device_commands.external_id and t.id_tag = device_commands.order_no)`,
      )
        .bind(nowIso(), target.externalId, outlet)
        .run();
      throw new ApiError("device_not_charging", 409);
    }
    await sendOcpp(env, target, outlet, "stop", String(tx.id), "RemoteStopTransaction", remoteStopRequest(tx.id), actor);
    return { order: String(tx.id) };
  }
  const last = await env.DB.prepare(
    `select order_no from device_commands where external_id = ? and outlet = ? and kind = 'start' and status in ('sent', 'done')
     order by id desc limit 1`,
  )
    .bind(target.externalId, outlet)
    .first<{ order_no: string }>();
  const order = last?.order_no ?? xingkeOrderNumber();
  if (target.route === "xingke_cloud") {
    await sendCloud(env, target, outlet, "stop", xingkeStopRequest(xingkeMessageId("stop"), outlet, order), actor);
    return { order };
  }
  await env.DB.prepare(
    "insert into device_commands (external_id, outlet, kind, order_no, line, created_by, created_at) values (?, ?, 'stop', ?, ?, ?, ?)",
  )
    .bind(target.externalId, outlet, order, xingkeStopCommand(target.externalId, outlet, order), actor, nowIso())
    .run();
  return { order };
}

/**
 * GET /api/devices/commands[?device=123456]: pending command lines as plain text,
 * oldest first. Each is handed out once; stale ones expire instead.
 */
export async function handleDeviceCommands(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET") return Response.json({ error: "method_not_allowed" }, { status: 405 });
  const denied = deviceKeyError(request, env.DEVICE_WEBHOOK_SECRET);
  if (denied) return denied;
  const device = new URL(request.url).searchParams.get("device")?.toUpperCase() ?? null;
  const now = nowIso();
  const cutoff = new Date(Date.now() - COMMAND_TTL_SECONDS * 1000).toISOString();
  await env.DB.prepare("update device_commands set status = 'expired' where status = 'pending' and message_id is null and created_at < ?").bind(cutoff).run();
  const { results } = await env.DB.prepare(
    `update device_commands set status = 'sent', sent_at = ?1
     where status = 'pending' and message_id is null and (?2 is null or external_id = ?2)
     returning id, line`,
  )
    .bind(now, device)
    .all<{ id: number; line: string }>();
  const lines = results.sort((a, b) => a.id - b.id).map((r) => r.line);
  return new Response(lines.join(""), { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
