import { deviceKeyError, toIngestOutlets } from "../shared/iot/device-events";
import {
  commandStatus,
  parseXingkeCallback,
  xingkeAuthorizeResponse,
  xingkeCardEvent,
  xingkeDedupKey,
  xingkeEffect,
  xingkeTransactionId,
  XingkeCallbackError,
  type XingkeCallback,
  type XingkeCommand,
} from "../shared/iot/xingke-cloud";
import { swipeCard } from "./charge-cards";
import { chargeStartFailed, chargeStopFailed, creditFollowUp, openCardCharge } from "./charging";
import { ingest, recountFreeSlots, startCardOutlet } from "./devices";
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
  // A start that may have reached the device keeps its charge open: the CommandResult tells
  // whether it runs, and a "Failed" one closes it (chargeStartFailed).
  if (result.uncertain && command.action === "RemoteStartTransaction") return;
  if (BUSY_CODES.has(result.code)) throw new ApiError("device_offline", 409);
  throw new ApiError("device_command_failed", 502);
}

const ok = () => Response.json({ code: "OK" });

/**
 *   POST /api/devices/xingke
 *   Authorization: Bearer <XINGKE_CALLBACK_TOKEN>
 * Device events from the vendor platform. Answers {"code":"OK"} once an event is
 * stored, also for repeats, so the platform stops retrying (section 4.1). What follows
 * (answering a card, stopping a charge) runs through `defer` after the answer, if given.
 */
export async function handleXingkeCallback(request: Request, env: Env, defer?: (work: Promise<unknown>) => void): Promise<Response> {
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
  // After the acknowledgement when the Worker lets us (`defer`): the platform waits at most
  // 3 seconds for it, and our card answer is a request to that same platform.
  const followUp = (async () => {
    await cardFollowUp(env, cb);
    // Green Credit charges: stopped when the credit is used up, paid once they ended (0047).
    await creditFollowUp(env, cb.deviceId);
  })();
  if (defer) defer(followUp);
  else await followUp;
  return ok();
}

async function applyCallback(db: D1Database, cb: XingkeCallback, body: unknown) {
  const deviceId = cb.deviceId.toUpperCase();
  const effect = xingkeEffect(cb);

  if (!effect || effect.online === false) {
    // Card events (answered in cardFollowUp) and unknown actions are only kept.
    await db
      .prepare("insert into device_messages (external_id, received_at, payload) values (?, ?, ?)")
      .bind(deviceId, nowIso(), JSON.stringify(body))
      .run();
    if (!effect) return;
    // Offline: its outlets are no longer offered, until the device reports again.
    const device = await db.prepare("select station_id from devices where external_id = ?").bind(deviceId).first<{ station_id: string | null }>();
    if (!device?.station_id) return;
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
      .prepare("select kind, outlet, order_no from device_commands where message_id = ? and external_id = ?")
      .bind(c.messageId, deviceId)
      .first<{ kind: "start" | "stop"; outlet: number; order_no: string }>();
    if (row) {
      // A late Unknown never overwrites a confirmed result.
      const closed = await db
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
      // The device refused: a refused start ends its charge at no cost, a refused stop lets it run on.
      if (c.status === "Failed" && closed.meta.changes > 0) {
        if (row.kind === "start") await chargeStartFailed(db, deviceId, row.outlet, row.order_no);
        else await chargeStopFailed(db, deviceId, row.outlet, row.order_no);
      }
    }
  }
  // Unknown devices are stored by ingest and acknowledged, so the platform does not retry for 24 hours.
  await ingest(db)(deviceId, outlets, body, { allOutlets: effect.allOutlets });
}

// Cards -------------------------------------------------------------------------------

/** A card charge whose start was not sent this long after the swipe is given up (the device never got our answer). */
const CARD_START_WINDOW_MS = 120_000;

/**
 * Card charging on Xingke sockets (sections 8 and 16), with the same cards as OCPP charge points
 * (swipeCard in worker/charge-cards.ts: linked to an account, paying with its Green Credit):
 * 1. CardPresented: we answer with AuthorizeResponse within its 30 seconds, Accepted with the
 *    credit as balance or Invalid. A balance inquiry may be for the whole device (no outlet,
 *    API 1.2). For StartCharging the card's charge opens at once on that outlet with a new
 *    transactionId, so a second swipe or another customer cannot take it.
 * 2. CommandResult of that answer: "Sent", or "Unknown" (DELIVERY_UNCERTAIN, what the platform
 *    reports today, as it gets no receipt from the device), so we start the outlet with
 *    startSource "Card" (the platform never starts by itself). An answer refused with
 *    PROFILE_UNCONFIRMED or whose send timed out starts the outlet at once. "Failed", another
 *    refusal, or no result within CARD_START_WINDOW_MS cancels the charge at no cost.
 * Then it runs like a Green Credit charge: stopped when the credit is used up and paid once it
 * ended (creditFollowUp). Never throws: the event is stored and acknowledged either way.
 */
async function cardFollowUp(env: Env, cb: XingkeCallback) {
  const deviceId = cb.deviceId.toUpperCase();
  try {
    // First, so a card left with an unstarted charge by an earlier swipe can charge again.
    await dropUnstartedCardCharges(env.DB, deviceId);
    if (cb.action === "CardPresented") await answerCard(env, cb);
    else if (cb.action === "CommandResult" && cb.data.requestAction === "AuthorizeResponse") await cardAnswerDelivered(env, cb);
    await dropUnstartedCardCharges(env.DB, deviceId);
  } catch (err) {
    console.error("xingke card", deviceId, cb.messageId, err);
  }
}

async function answerCard(env: Env, cb: XingkeCallback) {
  const card = xingkeCardEvent(cb);
  // An expired event is only kept (section 16): no answer, no charge.
  if (!card || Date.parse(card.expiresAt) <= Date.now()) return;
  const db = env.DB;
  const deviceId = cb.deviceId.toUpperCase();
  const swipe = await swipeCard(db, deviceId, card.idTag);
  let credit = swipe.status === "Accepted" && swipe.tag && swipe.creditXof !== undefined ? swipe.creditXof : null;
  const order = xingkeTransactionId();
  const outlet = card.intent === "StartCharging" ? card.connectorId : undefined;
  if (credit !== null && outlet) {
    const opened = await openCardCharge(db, deviceId, outlet, { tag: swipe.tag!, userId: swipe.userId }, order);
    if (!opened) credit = null;
  }
  const charging = credit !== null && !!outlet;
  // The platform's own id for the device, as it called us.
  // A balance inquiry shows the whole credit; a start, what the charge may spend (its hold).
  const answer = xingkeAuthorizeResponse(card, credit !== null && card.intent === "BalanceInquiry" ? (swipe.balanceXof ?? credit) : credit);
  const result = await sendXingkeCommand(env, cb.deviceId, answer);
  // Kept with the device's events, so a card the device showed nothing for can be traced.
  await db
    .prepare("insert into device_messages (external_id, received_at, payload) values (?, ?, ?)")
    .bind(deviceId, nowIso(), JSON.stringify({ sent: answer, result }))
    .run();
  if (!charging || result.ok) return;
  // The platform has not confirmed card authorization for this device (section 6.3), or our
  // send timed out: no CommandResult may follow, so the outlet is started directly, as for an
  // app start. A late CommandResult then finds the charge started and does nothing.
  if (result.uncertain || result.code === "PROFILE_UNCONFIRMED") return startCardCharge(env, deviceId, outlet, order);
  // Refused for sure: the device will not wait for a start.
  await chargeStartFailed(db, deviceId, outlet, order);
}

async function startCardCharge(env: Env, deviceId: string, outlet: number, order: string) {
  try {
    await startCardOutlet(env, deviceId, outlet, order, "card");
  } catch (err) {
    // Refused by the platform (e.g. device offline): stored on the command.
    console.error("xingke card start", deviceId, order, err);
    await chargeStartFailed(env.DB, deviceId, outlet, order);
  }
}

/** The card charge opened by answerCard on this outlet that has not been started yet. */
async function unstartedCardCharge(db: D1Database, deviceId: string, outlet: number) {
  return db
    .prepare(
      `select order_no from charging_sessions cs
        where cs.device_id = ? and cs.outlet = ? and cs.status = 'charging' and cs.charge_card is not null and cs.seen_charging = 0 and cs.energy_wh = 0
          and not exists (select 1 from device_commands d where d.external_id = cs.device_id and d.kind = 'start' and d.order_no = cs.order_no)`,
    )
    .bind(deviceId, outlet)
    .first<{ order_no: string }>();
}

async function cardAnswerDelivered(env: Env, cb: XingkeCallback) {
  const db = env.DB;
  const deviceId = cb.deviceId.toUpperCase();
  // The answer reuses the card event's messageId, so the event tells which outlet it was for.
  const event = await db
    .prepare(
      `select payload from device_messages where external_id = ? and received_at > ?
          and json_extract(payload, '$.action') = 'CardPresented' and json_extract(payload, '$.messageId') = ?
        order by id desc limit 1`,
    )
    .bind(deviceId, new Date(Date.now() - CARD_START_WINDOW_MS).toISOString(), cb.messageId)
    .first<{ payload: string }>();
  const card = event && xingkeCardEvent(parseXingkeCallback(JSON.parse(event.payload)));
  const outlet = card?.intent === "StartCharging" ? card.connectorId : undefined;
  if (!outlet) return;
  const charge = await unstartedCardCharge(db, deviceId, outlet);
  if (!charge) return;
  const status = cb.data.status;
  if (status === "Failed") return chargeStartFailed(db, deviceId, outlet, charge.order_no);
  if (status !== "Sent" && status !== "Unknown") return;
  await startCardCharge(env, deviceId, outlet, charge.order_no);
}

/** Cancels card charges whose start was never sent (the device did not confirm our answer in time). */
async function dropUnstartedCardCharges(db: D1Database, deviceId: string) {
  const { results } = await db
    .prepare(
      `select outlet, order_no from charging_sessions cs
        where cs.device_id = ? and cs.status = 'charging' and cs.charge_card is not null and cs.seen_charging = 0 and cs.energy_wh = 0 and cs.started_at < ?
          and not exists (select 1 from device_commands d where d.external_id = cs.device_id and d.kind = 'start' and d.order_no = cs.order_no)`,
    )
    .bind(deviceId, new Date(Date.now() - CARD_START_WINDOW_MS).toISOString())
    .all<{ outlet: number; order_no: string }>();
  for (const r of results) await chargeStartFailed(db, deviceId, r.outlet, r.order_no);
}
