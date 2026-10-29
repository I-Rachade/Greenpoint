// The Xingke cloud API for two-wheeler charging devices (V1.0, JSON over HTTPS):
// we POST commands to the vendor platform, it POSTs device events to our
// callback URL. Dependency-free so it runs in the Worker (worker/xingke.ts) and
// in the app's tests. Spec: planung/xingke-two-wheeler-api-v1.0-en.pdf.

import type { DeviceStatus, OutletReading } from "./device-events";
import { xingkeOrderNumber } from "./xingke-commands";

/** Device ids and message ids: 1 to 64 letters, digits, hyphens or underscores. */
export const XINGKE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Longest timed charge the API accepts, in seconds (whole minutes). */
export const XINGKE_MAX_DURATION = 59_880;

export type XingkeCommandAction = "RemoteStartTransaction" | "RemoteStopTransaction" | "AuthorizeResponse";

export interface XingkeCommand {
  messageId: string;
  action: XingkeCommandAction;
  data: Record<string, string | number>;
}

/** Our id for a command, unique and within the API's 64 characters. */
export function xingkeMessageId(kind: "start" | "stop", random: () => string = () => crypto.randomUUID()): string {
  return `pdr-${kind}-${random().replace(/-/g, "")}`.slice(0, 64);
}

/** The 20-digit charging correlation id the API requires. */
export const xingkeTransactionId = xingkeOrderNumber;

/**
 * Switch an outlet on, until the battery is full or for `seconds`. `source` "Card" after a
 * card we accepted (AuthorizeResponse), "Remote" otherwise.
 */
export function xingkeStartRequest(
  messageId: string,
  connectorId: number,
  transactionId: string,
  seconds?: number,
  source: "Remote" | "Card" = "Remote",
): XingkeCommand {
  const data: Record<string, string | number> = { connectorId, transactionId, startSource: source };
  if (seconds === undefined) data.chargingMode = "AutoStop";
  else {
    if (!(Number.isInteger(seconds) && seconds >= 60 && seconds <= XINGKE_MAX_DURATION && seconds % 60 === 0)) {
      throw new Error("duration must be 60 to 59880 seconds, in whole minutes");
    }
    data.chargingMode = "Timed";
    data.duration = seconds;
  }
  return { messageId, action: "RemoteStartTransaction", data };
}

/** Switch an outlet off, ending the charge `transactionId`. */
export function xingkeStopRequest(messageId: string, connectorId: number, transactionId: string): XingkeCommand {
  return { messageId, action: "RemoteStopTransaction", data: { connectorId, transactionId, stopSource: "Remote" } };
}

/** Highest balance the API accepts (section 8). */
const XINGKE_MAX_BALANCE = 2_147_483_647;

/**
 * Our answer to a card event (section 8), with the event's own messageId: a card that may
 * charge, with its credit as balance, or Invalid. The API counts in CNY cents (fen); we send
 * FCFA × 100, so the device's screen shows the amount in FCFA.
 */
export function xingkeAuthorizeResponse(card: XingkeCardEvent, balanceXof: number | null): XingkeCommand {
  // Same channel as the event; a device-wide balance inquiry has none (API 1.2).
  const data: Record<string, string | number> = { ...(card.connectorId ? { connectorId: card.connectorId } : {}), idTag: card.idTag };
  if (balanceXof === null) data.status = "Invalid";
  else Object.assign(data, { status: "Accepted", cardType: "Balance", balance: Math.min(Math.max(0, Math.floor(balanceXof)) * 100, XINGKE_MAX_BALANCE) });
  return { messageId: card.messageId, action: "AuthorizeResponse", data };
}

// Callbacks -------------------------------------------------------------------

export class XingkeCallbackError extends Error {}

export interface XingkeCallback {
  messageId: string;
  deviceId: string;
  action: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Checks the envelope every callback shares (section 4). */
export function parseXingkeCallback(body: unknown): XingkeCallback {
  if (typeof body !== "object" || body === null || Array.isArray(body)) throw new XingkeCallbackError("body must be an object");
  const b = body as Record<string, unknown>;
  const messageId = str(b.messageId);
  const deviceId = str(b.deviceId);
  const action = str(b.action);
  const timestamp = str(b.timestamp);
  if (!messageId || !XINGKE_ID.test(messageId)) throw new XingkeCallbackError("messageId is missing or invalid");
  if (!deviceId || !XINGKE_ID.test(deviceId)) throw new XingkeCallbackError("deviceId is missing or invalid");
  if (!action) throw new XingkeCallbackError("action is missing");
  if (!timestamp || Number.isNaN(Date.parse(timestamp))) throw new XingkeCallbackError("timestamp is missing or invalid");
  if (typeof b.data !== "object" || b.data === null || Array.isArray(b.data)) throw new XingkeCallbackError("data must be an object");
  return { messageId, deviceId, action, timestamp, data: b.data as Record<string, unknown> };
}

/** The outcome of one of our commands (CommandResult). */
export interface XingkeCommandOutcome {
  messageId: string;
  requestAction: string;
  /** Succeeded, Failed, Unknown or Sent. */
  status: string;
  code: string;
  connectorId?: number;
}

/** What a callback means for our tables. */
export interface XingkeEffect {
  outlets: OutletReading[];
  /** A fault of the whole device: every outlet takes this status. */
  allOutlets?: DeviceStatus;
  online?: boolean;
  command?: XingkeCommandOutcome;
}

// Why a charge stopped (ChargingStatusNotification.reason). Protections take the
// outlet out until the device reports it available again.
const STOP_REASONS: Record<string, DeviceStatus> = {
  Completed: "done",
  BalanceDepleted: "done",
  NoLoad: "free",
  PowerLossOrUnplugged: "free",
  VoltageProtection: "fault",
  TheftProtection: "fault",
  Overload: "fault",
  OverTemperature: "fault",
  PowerOrTimeLimit: "fault",
};

const CONNECTOR_STATUS: Record<string, DeviceStatus> = { Available: "free", Charging: "charging", Faulted: "fault" };

function connector(value: unknown): number | undefined {
  const n = num(value);
  return n !== undefined && Number.isInteger(n) && n >= 1 && n <= 16 ? n : undefined;
}

function chargingReading(d: Record<string, unknown>): OutletReading | null {
  const outlet = connector(d.connectorId);
  if (!outlet) return null;
  const status = d.status === "Charging" ? "charging" : d.status === "Stopped" ? STOP_REASONS[str(d.reason) ?? ""] : undefined;
  const reading: OutletReading = { outlet, status };
  const power = num(d.power);
  const energy = num(d.energy);
  if (power !== undefined && power >= 0) reading.powerWatts = Math.round(power);
  // kWh in the API, Wh in our tables.
  if (energy !== undefined && energy >= 0) reading.energyWh = Math.round(energy * 1000);
  const tx = str(d.transactionId);
  if (tx && /^\d{20}$/.test(tx)) reading.transactionId = tx;
  return reading;
}

/**
 * Maps a callback to its effect. Card events (answered in worker/xingke.ts) and
 * unknown actions change no outlet, so they return null.
 */
export function xingkeEffect(cb: XingkeCallback): XingkeEffect | null {
  const d = cb.data;
  switch (cb.action) {
    case "ChargingStatusNotification": {
      const reading = chargingReading(d);
      return { outlets: reading ? [reading] : [] };
    }
    case "StatusNotification": {
      const outlets: OutletReading[] = [];
      for (const c of Array.isArray(d.connectors) ? d.connectors : []) {
        const entry = (c ?? {}) as Record<string, unknown>;
        const outlet = connector(entry.connectorId);
        // Unknown states leave the outlet as it is; a partial report says nothing about the others.
        if (outlet) outlets.push({ outlet, status: CONNECTOR_STATUS[str(entry.status) ?? ""] });
      }
      return { outlets };
    }
    case "FaultNotification": {
      if (d.scope === "Device") return { outlets: [], allOutlets: "fault" };
      const outlet = connector(d.connectorId);
      return { outlets: outlet ? [{ outlet, status: "fault" }] : [] };
    }
    case "DeviceOnline":
      return { outlets: [], online: true };
    case "DeviceOffline":
      return { outlets: [], online: false };
    case "CommandResult": {
      const result = (d.result ?? {}) as Record<string, unknown>;
      return {
        outlets: [],
        command: {
          messageId: cb.messageId,
          requestAction: str(d.requestAction) ?? "",
          status: str(d.status) ?? "Unknown",
          code: str(d.code) ?? "",
          connectorId: connector(result.connectorId),
        },
      };
    }
    default:
      return null;
  }
}

/** A card held to an outlet (CardPresented, section 16): to answer before `expiresAt`. */
export interface XingkeCardEvent {
  messageId: string;
  /** Absent for a device-wide balance inquiry (API 1.2); a start always names its outlet. */
  connectorId?: number;
  /** The card number as the device read it (10 decimal digits); our answer repeats it. */
  idTag: string;
  intent: "BalanceInquiry" | "StartCharging";
  expiresAt: string;
}

/** The card event of a CardPresented callback; null for any other callback or a malformed one. */
export function xingkeCardEvent(cb: XingkeCallback): XingkeCardEvent | null {
  if (cb.action !== "CardPresented") return null;
  const d = cb.data;
  const connectorId = connector(d.connectorId);
  const idTag = str(d.idTag);
  const expiresAt = str(d.expiresAt);
  const intent = d.intent;
  if (!idTag || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  if (intent !== "BalanceInquiry" && intent !== "StartCharging") return null;
  if (d.connectorId !== undefined && !connectorId) return null;
  if (intent === "StartCharging" && !connectorId) return null;
  return { messageId: cb.messageId, ...(connectorId ? { connectorId } : {}), idTag, intent, expiresAt };
}

/**
 * Key for dropping repeated deliveries (section 4.1): device + action + messageId,
 * plus the status for command results, since an Unknown can later be confirmed.
 */
export function xingkeDedupKey(cb: XingkeCallback): string {
  const status = cb.action === "CommandResult" ? `:${str(cb.data.status) ?? ""}` : "";
  return `${cb.deviceId.toUpperCase()}:${cb.action}:${cb.messageId}${status}`;
}

/** Our command status for a CommandResult status. Unknown keeps the command open. */
export function commandStatus(status: string): "done" | "failed" | null {
  if (status === "Succeeded" || status === "Sent") return "done";
  if (status === "Failed") return "failed";
  return null;
}
