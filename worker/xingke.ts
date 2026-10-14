import { deviceKeyError, toIngestOutlets } from "../src/lib/iot/device-events";
import {
  commandStatus,
  parseXingkeCallback,
  xingkeDedupKey,
  xingkeEffect,
  XingkeCallbackError,
  type XingkeCallback,
  type XingkeCommand,
} from "../src/lib/iot/xingke-cloud";
import { ingest, recountFreeSlots } from "./devices";
import type { Env } from "./env";
import { ApiError, nowIso } from "./http";

// Sockets on the Xingke cloud API (V1.0): commands go out to the vendor platform,
// device events come back to POST /api/devices/xingke. See docs/steckdosen-lora.md
// and planung/xingke-two-wheeler-api-v1.0-en.pdf.

/** How long we wait for the vendor platform to accept a command. */
const SEND_TIMEOUT_MS = 10_000;

/** Error codes of the vendor platform (section 5) that mean the device cannot take commands now. */
const BUSY_CODES = new Set(["DEVICE_OFFLINE", "DEVICE_BUSY"]);

export type SendResult = { ok: true } | { ok: false; code: string; uncertain: boolean; detail?: string };

/** The platform host as configured, tolerating a pasted "https://" or trailing slash. */
export function xingkeHost(value: string): string {
  return value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
}

/** Our access credential, tolerating a pasted "Bearer " prefix. */
export function xingkeToken(value: string): string {
  return value.trim().replace(/^bearer\s+/i, "");
}

/**
 * Sends one command to the vendor platform. HTTP 202 (or 200 for a repeated
 * messageId) only means accepted; the CommandResult callback tells what the device did.
 */
export async function sendXingkeCommand(env: Env, deviceRef: string, command: XingkeCommand, fetcher: typeof fetch = fetch): Promise<SendResult> {
  if (!env.XINGKE_API_HOST || !env.XINGKE_API_TOKEN) throw new ApiError("device_not_configured", 503);
  const url = `https://${xingkeHost(env.XINGKE_API_HOST)}/openapi/v1/devices/${encodeURIComponent(deviceRef)}/commands`;
  let response: Response;
  try {
    response = await fetcher(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${xingkeToken(env.XINGKE_API_TOKEN)}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    // Timeout or network error: the command may have been accepted (section 5).
    return { ok: false, code: "DELIVERY_UNCERTAIN", uncertain: true };
  }
  const body = (await response.json().catch(() => null)) as { code?: string; message?: string } | null;
  if (response.status === 202 || response.status === 200) return { ok: true };
  // The platform's message says which field it rejected; kept for troubleshooting.
  const detail = typeof body?.message === "string" ? body.message.slice(0, 300) : undefined;
  return { ok: false, code: body?.code ?? `HTTP_${response.status}`, uncertain: response.status >= 500, detail };
}

/** Sends a command we stored as pending and records how the platform answered. */
export async function dispatchXingkeCommand(env: Env, deviceRef: string, command: XingkeCommand, fetcher?: typeof fetch) {
  const result = await sendXingkeCommand(env, deviceRef, command, fetcher);
  const now = nowIso();
  if (result.ok) {
    await env.DB.prepare("update device_commands set status = 'sent', sent_at = ? where message_id = ?").bind(now, command.messageId).run();
    return;
  }
  // An uncertain send stays open: a late CommandResult still closes it.
  await env.DB.prepare(
    `update device_commands set status = ?, result = ?, sent_at = ?, done_at = ? where message_id = ?`,
  )
    .bind(result.uncertain ? "sent" : "failed", result.detail ? `${result.code}: ${result.detail}` : result.code, now, result.uncertain ? null : now, command.messageId)
    .run();
  if (BUSY_CODES.has(result.code)) throw new ApiError("device_offline", 409);
  throw new ApiError("device_command_failed", 502);
}

const ok = () => Response.json({ code: "OK" });

/**
 *   POST /api/devices/xingke
 *   Authorization: Bearer <XINGKE_CALLBACK_TOKEN>
 * Device events from the vendor platform. Answers {"code":"OK"} once an event is
 * stored, also for repeats, so the platform stops retrying (section 4.1).
 */
export async function handleXingkeCallback(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") return Response.json({ code: "METHOD_NOT_ALLOWED" }, { status: 405 });
  const denied = deviceKeyError(request, env.XINGKE_CALLBACK_TOKEN);
  if (denied) return Response.json({ code: denied.status === 401 ? "UNAUTHORIZED" : "SERVICE_UNAVAILABLE" }, { status: denied.status });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ code: "INVALID_JSON" }, { status: 400 });
  }
  let cb: XingkeCallback;
  try {
    cb = parseXingkeCallback(body);
  } catch (err) {
    if (err instanceof XingkeCallbackError) return Response.json({ code: "INVALID_ARGUMENT", message: err.message }, { status: 400 });
    throw err;
  }

  const key = xingkeDedupKey(cb);
  const seen = await env.DB.prepare("select 1 from device_callbacks where key = ?").bind(key).first();
  if (seen) return ok();
  await applyCallback(env.DB, cb, body);
  await env.DB.prepare("insert or ignore into device_callbacks (key, received_at) values (?, ?)").bind(key, nowIso()).run();
  return ok();
}

async function applyCallback(db: D1Database, cb: XingkeCallback, body: unknown) {
  const deviceId = cb.deviceId.toUpperCase();
  const effect = xingkeEffect(cb);

  if (!effect || effect.online === false) {
    // Card events and unknown actions are only kept; we have no card accounts.
    await db
      .prepare("insert into device_messages (external_id, received_at, payload) values (?, ?, ?)")
      .bind(deviceId, nowIso(), JSON.stringify(body))
      .run();
    if (!effect) return;
    // Offline: its outlets are no longer offered, until the device reports again.
    const device = await db.prepare("select station_id from devices where external_id = ?").bind(deviceId).first<{ station_id: string }>();
    if (!device) return;
    await db.batch([
      db.prepare("update charging_points set last_seen_at = null where device_id = ?").bind(deviceId),
      recountFreeSlots(db, device.station_id),
    ]);
    return;
  }

  const outlets = toIngestOutlets({ externalId: deviceId, outlets: effect.outlets });
  if (effect.command) {
    const c = effect.command;
    const status = commandStatus(c.status);
    const row = await db
      .prepare("select kind, outlet from device_commands where message_id = ? and external_id = ?")
      .bind(c.messageId, deviceId)
      .first<{ kind: "start" | "stop"; outlet: number }>();
    if (row) {
      // A late Unknown never overwrites a confirmed result.
      await db
        .prepare(
          `update device_commands set status = coalesce(?, status), result = ?, done_at = case when ? is null then done_at else ? end
           where message_id = ? and status in ('pending', 'sent')`,
        )
        .bind(status, c.code, status, nowIso(), c.messageId)
        .run();
      // A confirmed start or stop shows at once; the next status report confirms it.
      if (c.status === "Succeeded") {
        const shown = row.kind === "start" ? "charging" : "free";
        outlets.push({ outlet: row.outlet, status: shown, power_watts: undefined, energy_wh: undefined });
      }
    }
  }
  // Unknown devices are stored by ingest and acknowledged, so the platform does not retry for 24 hours.
  await ingest(db)(deviceId, outlets, body, { allOutlets: effect.allOutlets });
}
