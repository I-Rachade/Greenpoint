import { toIngestOutlets } from "../src/lib/iot/device-events";
import { normalizeDeviceId } from "../src/lib/iot/devices";
import {
  OCPP_HEARTBEAT_SECONDS,
  OCPP_ID,
  OCPP_SUBPROTOCOL,
  OCPP_TAG_PREFIX,
  OcppCallError,
  OcppFrameError,
  accepted,
  basicAuth,
  callFrame,
  errorFrame,
  meterReading,
  parseFrame,
  resultFrame,
  statusEffect,
  type OcppCall,
  type OcppErrorFrame,
  type OcppResult,
} from "../src/lib/iot/ocpp";
import { swipeCard } from "./charge-cards";
import { cancelRefusedStart, openCardCharge } from "./charging";
import { ingest, recountFreeSlots } from "./devices";
import type { Env } from "./env";
import { ApiError, nowIso, sha256 } from "./http";

// OCPP 1.6J central system: charge points connect to
//   wss://app.poinderecharge.com/api/devices/ocpp/<chargePointId>
// with subprotocol "ocpp1.6" and HTTP Basic auth (security profile 1: the user is
// the charge point id, the password the AuthorizationKey shown once when the
// socket was added). Each charge point's WebSocket lives in its own Durable
// Object (OcppConnection), which answers its requests and forwards our commands.
// See docs/steckdosen-lora.md.

function str(value: unknown, what: string): string {
  if (typeof value !== "string") throw new OcppCallError("TypeConstraintViolation", what);
  return value;
}

function int(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) throw new OcppCallError("TypeConstraintViolation", what);
  return value;
}

/**
 * Only an idTag we sent this charge point for a remote start may charge, once, on the
 * connector it was sent for, and only while nothing came after it: no newer command for
 * that outlet, and the charge it was sent for (if any) still running. A charge point that
 * remembers a start after the customer stopped, or any made-up "PDR…" tag, is refused.
 * Any other tag is a swiped card (swipeCard in worker/charge-cards.ts).
 */
async function tagStatus(db: D1Database, externalId: string, idTag: string, connectorId?: number): Promise<"Accepted" | "Invalid"> {
  if (!idTag.startsWith(OCPP_TAG_PREFIX)) return "Invalid";
  const ours = await db
    .prepare(
      `select 1 from device_commands c
       where c.external_id = ?1 and c.kind = 'start' and c.order_no = ?2 and c.message_id is not null
         and c.status in ('pending', 'sent', 'done') and (?3 is null or c.outlet = ?3)
         and not exists (select 1 from device_commands n where n.external_id = c.external_id and n.outlet = c.outlet and n.id > c.id)
         and not exists (select 1 from charging_sessions s where s.device_id = c.external_id and s.outlet = c.outlet and s.order_no = c.order_no and s.status <> 'charging')
         and not exists (select 1 from ocpp_transactions t where t.external_id = c.external_id and t.id_tag = c.order_no)
       limit 1`,
    )
    .bind(externalId, idTag, connectorId ?? null)
    .first();
  return ours ? "Accepted" : "Invalid";
}

/** Our remote start tags; case does not matter in OCPP. */
const isOurTag = (idTag: string) => idTag.toUpperCase().startsWith(OCPP_TAG_PREFIX);

/** The charge's start reading, by transactionId or else the connector's open charge. */
async function meterStart(db: D1Database, externalId: string, connectorId: number, transactionId: unknown) {
  const row =
    typeof transactionId === "number"
      ? await db
          .prepare("select meter_start from ocpp_transactions where id = ? and external_id = ?")
          .bind(transactionId, externalId)
          .first<{ meter_start: number }>()
      : await db
          .prepare("select meter_start from ocpp_transactions where external_id = ? and connector_id = ? and stopped_at is null order by id desc limit 1")
          .bind(externalId, connectorId)
          .first<{ meter_start: number }>();
  return row?.meter_start;
}

/** Answers one request of the charge point; returns the CALLRESULT payload. */
export async function handleOcppCall(db: D1Database, externalId: string, action: string, payload: Record<string, unknown>): Promise<object> {
  const apply = ingest(db);
  switch (action) {
    case "BootNotification": {
      const vendor = str(payload.chargePointVendor, "chargePointVendor").slice(0, 80);
      const model = str(payload.chargePointModel, "chargePointModel").slice(0, 80);
      // Fill in what the admin left empty.
      await db
        .prepare("update devices set vendor = case when vendor = '' then ? else vendor end, model = case when model = '' then ? else model end where external_id = ?")
        .bind(vendor, model, externalId)
        .run();
      await apply(externalId, [], payload);
      return { status: "Accepted", currentTime: nowIso(), interval: OCPP_HEARTBEAT_SECONDS };
    }
    case "Heartbeat":
      await apply(externalId, [], payload);
      return { currentTime: nowIso() };
    case "StatusNotification": {
      const effect = statusEffect(payload);
      await apply(externalId, toIngestOutlets({ externalId, outlets: effect.outlets }), payload, { allOutlets: effect.allOutlets });
      return {};
    }
    case "Authorize": {
      const idTag = str(payload.idTag, "idTag");
      const status = isOurTag(idTag) ? await tagStatus(db, externalId, idTag) : (await swipeCard(db, externalId, idTag)).status;
      return { idTagInfo: { status } };
    }
    case "StartTransaction": {
      const connectorId = int(payload.connectorId, "connectorId");
      const idTag = str(payload.idTag, "idTag");
      const start = int(payload.meterStart, "meterStart");
      if (connectorId < 1) throw new OcppCallError("PropertyConstraintViolation", "connectorId");
      let status: string;
      if (isOurTag(idTag)) {
        status = await tagStatus(db, externalId, idTag, connectorId);
      } else {
        // A swiped card: its customer's charge opens on this outlet, or the card is refused.
        const card = await swipeCard(db, externalId, idTag);
        status = card.status === "Accepted" && !(await openCardCharge(db, externalId, connectorId, card.userId!, idTag.slice(0, 20))) ? "Invalid" : card.status;
      }
      // Every start gets a transactionId, also a refused one; the charge point then stops it.
      const tx = await db
        .prepare("insert into ocpp_transactions (external_id, connector_id, id_tag, meter_start, started_at) values (?, ?, ?, ?, ?) returning id")
        .bind(externalId, connectorId, idTag.slice(0, 20), start, str(payload.timestamp, "timestamp"))
        .first<{ id: number }>();
      if (status === "Accepted") {
        await apply(externalId, [{ outlet: connectorId, status: "charging", power_watts: undefined, energy_wh: 0 }], payload);
      }
      return { transactionId: tx!.id, idTagInfo: { status } };
    }
    case "StopTransaction": {
      const transactionId = int(payload.transactionId, "transactionId");
      const stop = int(payload.meterStop, "meterStop");
      const tx = await db
        .prepare(
          `update ocpp_transactions set meter_stop = ?, stopped_at = ?, stop_reason = ?
           where id = ? and external_id = ? returning connector_id, meter_start`,
        )
        .bind(stop, str(payload.timestamp, "timestamp"), typeof payload.reason === "string" ? payload.reason : "Local", transactionId, externalId)
        .first<{ connector_id: number; meter_start: number }>();
      if (tx) {
        const energy = Math.max(0, stop - tx.meter_start);
        await apply(externalId, [{ outlet: tx.connector_id, status: "done", power_watts: 0, energy_wh: energy }], payload);
      }
      return { idTagInfo: { status: "Accepted" } };
    }
    case "MeterValues": {
      const connectorId = int(payload.connectorId, "connectorId");
      const reading = meterReading(payload, await meterStart(db, externalId, connectorId, payload.transactionId));
      if (reading) await apply(externalId, toIngestOutlets({ externalId, outlets: [reading] }), payload);
      return {};
    }
    case "DataTransfer":
      return { status: "UnknownVendorId" };
    case "DiagnosticsStatusNotification":
    case "FirmwareStatusNotification":
      return {};
    default:
      throw new OcppCallError("NotImplemented", `${action} is not supported`);
  }
}

/** The frame that answers a CALL. */
export async function answerCall(db: D1Database, externalId: string, call: OcppCall): Promise<string> {
  try {
    return resultFrame(call.id, await handleOcppCall(db, externalId, call.action, call.payload));
  } catch (err) {
    if (err instanceof OcppCallError) return errorFrame(call.id, err.code, err.message);
    console.error("ocpp", externalId, call.action, err);
    return errorFrame(call.id, "InternalError", "");
  }
}

/** Closes one of our commands with the charge point's answer. */
export async function applyOcppResult(db: D1Database, commandId: number, frame: OcppResult | OcppErrorFrame) {
  const ok = frame.type === 3 && accepted(frame.payload);
  const result = frame.type === 3 ? String(frame.payload.status ?? "") : `${frame.code}: ${frame.description}`.slice(0, 300);
  const command = await db
    .prepare("update device_commands set status = ?, result = ?, done_at = ? where id = ? and status in ('pending', 'sent') returning external_id, outlet, kind, order_no")
    .bind(ok ? "done" : "failed", result, nowIso(), commandId)
    .first<{ external_id: string; outlet: number; kind: "start" | "stop"; order_no: string }>();
  // A refused start never charges: the charge waiting for it is closed again.
  if (command && !ok && command.kind === "start") await cancelRefusedStart(db, command.external_id, command.outlet, command.order_no);
}

/** The charge point hung up: its outlets are no longer offered until it is back. */
export async function markOcppOffline(db: D1Database, externalId: string) {
  const device = await db.prepare("select station_id from devices where external_id = ?").bind(externalId).first<{ station_id: string }>();
  if (!device) return;
  await db.batch([
    db.prepare("update charging_points set last_seen_at = null where device_id = ?").bind(externalId),
    recountFreeSlots(db, device.station_id),
  ]);
}

// The WebSocket ---------------------------------------------------------------

const stub = (env: Env, externalId: string) => env.OCPP!.get(env.OCPP!.idFromName(externalId));

/**
 * GET /api/devices/ocpp/<chargePointId> with "Upgrade: websocket": checks the
 * charge point and its key, then hands the connection to its Durable Object.
 * The key comes as the HTTP Basic password, or in the URL
 * (/api/devices/ocpp/k/<key>/<chargePointId>) for firmware that cannot send one.
 */
export async function handleOcppUpgrade(request: Request, env: Env, rawId: string, urlKey?: string): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
  if (!env.OCPP) return new Response("OCPP is not set up", { status: 503 });
  if (offeredProtocol(request) === false) return new Response("Only ocpp1.6 is supported", { status: 400 });

  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return new Response("Unknown charge point", { status: 404 });
  }
  if (!OCPP_ID.test(id)) return new Response("Unknown charge point", { status: 404 });
  const externalId = normalizeDeviceId(id);
  const device = await env.DB.prepare("select ocpp_key_hash from devices where external_id = ? and protocol = 'ocpp1.6'")
    .bind(externalId)
    .first<{ ocpp_key_hash: string | null }>();
  if (!device) return new Response("Unknown charge point", { status: 404 });
  // No stored key: the socket was added "without password" and connects with its id alone.
  const key = urlKey ?? basicAuth(request.headers.get("Authorization"))?.password;
  if (device.ocpp_key_hash && (!key || (await sha256(key)) !== device.ocpp_key_hash)) {
    return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="OCPP"' } });
  }
  return stub(env, externalId).fetch(new Request(`https://ocpp/connect?id=${encodeURIComponent(externalId)}`, request));
}

/**
 * The OCPP 1.6 subprotocol token the charge point offered, as it spelled it
 * ("ocpp1.6", any case, or "ocpp1.6j"); null when it offered none, false when
 * it offered only others. A server may only answer with a token the client
 * offered: a strict client drops the connection otherwise.
 */
export function offeredProtocol(request: Request): string | null | false {
  const offered = (request.headers.get("Sec-WebSocket-Protocol") ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (!offered.length) return null;
  return offered.find((p) => [OCPP_SUBPROTOCOL, `${OCPP_SUBPROTOCOL}j`].includes(p.toLowerCase())) ?? false;
}

/**
 * Keeps one connection attempt in device_messages (key in the URL masked), so
 * a charger that cannot connect shows why. At most one per charge point and
 * minute, as a failing charger retries in a loop.
 */
export async function logOcppAttempt(db: D1Database, request: Request, rawId: string | undefined, status: number) {
  const url = new URL(request.url);
  let externalId = "OCPP";
  try {
    if (rawId) externalId = normalizeDeviceId(decodeURIComponent(rawId)).slice(0, 64);
  } catch {
    // keep the placeholder
  }
  const since = new Date(Date.now() - 60_000).toISOString();
  const recent = await db
    .prepare("select 1 from device_messages where external_id = ? and received_at > ? and payload like '{\"action\":\"OcppConnect\"%' limit 1")
    .bind(externalId, since)
    .first();
  if (recent) return;
  const payload = {
    action: "OcppConnect",
    status,
    path: url.pathname.replace(/\/k\/[^/]+\//, "/k/***/").slice(0, 200),
    scheme: url.protocol,
    upgrade: request.headers.get("Upgrade"),
    protocols: request.headers.get("Sec-WebSocket-Protocol"),
    auth: request.headers.get("Authorization")?.split(" ")[0] ?? null,
    userAgent: request.headers.get("User-Agent")?.slice(0, 120) ?? null,
  };
  await db.prepare("insert into device_messages (external_id, received_at, payload) values (?, ?, ?)").bind(externalId, nowIso(), JSON.stringify(payload)).run();
}

/** Sends a stored command (device_commands row `commandId`) to a connected charge point. */
export async function sendOcppCommand(env: Env, externalId: string, commandId: number, messageId: string, action: string, payload: object) {
  if (!env.OCPP) throw new ApiError("device_not_configured", 503);
  const res = await stub(env, externalId).fetch(`https://ocpp/call?id=${encodeURIComponent(externalId)}`, {
    method: "POST",
    body: JSON.stringify({ commandId, messageId, action, payload }),
  });
  const sent = (await res.json()) as { ok: boolean; code?: string };
  const now = nowIso();
  if (!sent.ok) {
    await env.DB.prepare("update device_commands set status = 'failed', result = ?, sent_at = ?, done_at = ? where id = ?")
      .bind(sent.code ?? "DEVICE_OFFLINE", now, now, commandId)
      .run();
    throw new ApiError("device_offline", 409);
  }
  await env.DB.prepare("update device_commands set status = 'sent', sent_at = ? where id = ? and status = 'pending'").bind(now, commandId).run();
}

/** What each charge point's socket carries through hibernation. */
interface Attachment {
  externalId: string;
  connectedAt?: number;
}

/** Frames are kept for the first minutes of each connection, enough to see a charger boot. */
const TRACE_MS = 15 * 60_000;

const tracing = (a: Attachment) => a.connectedAt !== undefined && Date.now() - a.connectedAt < TRACE_MS;
const secondsSince = (t?: number) => (t === undefined ? null : Math.round((Date.now() - t) / 1000));

/**
 * Keeps one step of a charge point's connection in device_messages: frames in
 * and out at first, errors and how the connection ended always. Never fails the
 * connection itself.
 */
export async function traceOcpp(db: D1Database, externalId: string, entry: Record<string, unknown>) {
  const payload: Record<string, unknown> = { action: "OcppTrace", ...entry };
  if (typeof payload.frame === "string") payload.frame = payload.frame.slice(0, 500);
  try {
    await db.prepare("insert into device_messages (external_id, received_at, payload) values (?, ?, ?)").bind(externalId, nowIso(), JSON.stringify(payload)).run();
  } catch (err) {
    console.error("ocpp trace", externalId, err);
  }
}

interface Pending {
  commandId: number;
  action: string;
}

/** One charge point's WebSocket. It hibernates between messages, so state lives in storage and on the socket. */
export class OcppConnection implements DurableObject {
  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {}

  private open(except?: WebSocket) {
    return this.ctx.getWebSockets().filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const externalId = url.searchParams.get("id") ?? "";
    if (url.pathname === "/connect") {
      // A charge point that reconnects replaces its old connection.
      for (const old of this.ctx.getWebSockets()) old.close(1000, "Replaced by a new connection");
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({ externalId, connectedAt: Date.now() } satisfies Attachment);
      const protocol = offeredProtocol(request);
      return new Response(null, { status: 101, webSocket: client, headers: protocol ? { "Sec-WebSocket-Protocol": protocol } : {} });
    }
    if (url.pathname === "/call" && request.method === "POST") {
      const { commandId, messageId, action, payload } = (await request.json()) as Pending & { messageId: string; payload: object };
      const ws = this.open()[0];
      if (!ws) return Response.json({ ok: false, code: "DEVICE_OFFLINE" });
      await this.ctx.storage.put<Pending>(`pending:${messageId}`, { commandId, action });
      ws.send(callFrame(messageId, action, payload));
      return Response.json({ ok: true });
    }
    return new Response("Not found", { status: 404 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const attachment = ws.deserializeAttachment() as Attachment;
    const { externalId } = attachment;
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const trace = tracing(attachment);
    if (trace) await traceOcpp(this.env.DB, externalId, { dir: "in", frame: text });
    let frame;
    try {
      frame = parseFrame(text);
    } catch (err) {
      if (err instanceof OcppFrameError) {
        // without a message id there is nothing to answer
        if (!trace) await traceOcpp(this.env.DB, externalId, { dir: "in", frame: text, error: err.message });
        return;
      }
      throw err;
    }
    if (frame.type === 2) {
      const reply = await answerCall(this.env.DB, externalId, frame);
      ws.send(reply);
      if (trace || reply.startsWith("[4,")) await traceOcpp(this.env.DB, externalId, { dir: "out", frame: reply });
      return;
    }
    const key = `pending:${frame.id}`;
    const pending = await this.ctx.storage.get<Pending>(key);
    if (!pending) return;
    await this.ctx.storage.delete(key);
    await applyOcppResult(this.env.DB, pending.commandId, frame);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean) {
    const { externalId, connectedAt } = ws.deserializeAttachment() as Attachment;
    await traceOcpp(this.env.DB, externalId, { dir: "close", code, reason, wasClean, seconds: secondsSince(connectedAt) });
    try {
      // 1005 and 1006 only describe a close without a status; they cannot be sent back.
      ws.close(code === 1005 || code === 1006 ? 1000 : code, reason);
    } catch {
      // already closed
    }
    if (!this.open(ws).length) await markOcppOffline(this.env.DB, externalId);
  }

  async webSocketError(ws: WebSocket, error: unknown) {
    const { externalId, connectedAt } = ws.deserializeAttachment() as Attachment;
    await traceOcpp(this.env.DB, externalId, { dir: "error", error: String(error).slice(0, 200), seconds: secondsSince(connectedAt) });
    if (!this.open(ws).length) await markOcppOffline(this.env.DB, externalId);
  }
}
