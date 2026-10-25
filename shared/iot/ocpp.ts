// OCPP 1.6J: charge points connect straight to our server over a WebSocket
// (wss://<host>/api/devices/ocpp/<chargePointId>, subprotocol "ocpp1.6") and
// exchange JSON frames with us as the central system. Dependency-free so it
// runs in the Worker (worker/ocpp.ts) and in the app's tests.
// Spec: OCPP 1.6 edition 2 (Open Charge Alliance), JSON over WebSocket 1.6.

import type { DeviceStatus, OutletReading } from "./device-events";

export const OCPP_SUBPROTOCOL = "ocpp1.6";

/** How often a charge point sends a Heartbeat; well within DEVICE_OFFLINE_MINUTES. */
export const OCPP_HEARTBEAT_SECONDS = 300;

/** Charge point ids as they appear in the URL: the spec allows up to 20 characters, we take what device ids allow. */
export const OCPP_ID = /^[A-Za-z0-9:_-]{4,64}$/;

/** idTags we hand out for remote starts start with this; others are not ours. */
export const OCPP_TAG_PREFIX = "PDR";

export class OcppFrameError extends Error {}

/** A CALL from either side: [2, id, action, payload]. */
export interface OcppCall {
  type: 2;
  id: string;
  action: string;
  payload: Record<string, unknown>;
}
/** A CALLRESULT: [3, id, payload]. */
export interface OcppResult {
  type: 3;
  id: string;
  payload: Record<string, unknown>;
}
/** A CALLERROR: [4, id, code, description, details]. */
export interface OcppErrorFrame {
  type: 4;
  id: string;
  code: string;
  description: string;
}
export type OcppFrame = OcppCall | OcppResult | OcppErrorFrame;

/** Error codes of the RPC framework (OCPP-J 1.6, section 4.2.3). */
export type OcppErrorCode =
  | "NotImplemented"
  | "NotSupported"
  | "InternalError"
  | "ProtocolError"
  | "SecurityError"
  | "FormationViolation"
  | "PropertyConstraintViolation"
  | "OccurenceConstraintViolation"
  | "TypeConstraintViolation"
  | "GenericError";

/** Raised by a handler to answer a CALL with a CALLERROR. */
export class OcppCallError extends Error {
  constructor(
    readonly code: OcppErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFrame(text: string): OcppFrame {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new OcppFrameError("not JSON");
  }
  if (!Array.isArray(value) || typeof value[1] !== "string" || !value[1]) throw new OcppFrameError("not an OCPP frame");
  const [type, id] = value;
  if (type === 2 && typeof value[2] === "string" && isObject(value[3])) return { type, id, action: value[2], payload: value[3] };
  if (type === 3 && isObject(value[2])) return { type, id, payload: value[2] };
  if (type === 4 && typeof value[2] === "string") return { type, id, code: value[2], description: String(value[3] ?? "") };
  throw new OcppFrameError("not an OCPP frame");
}

export const callFrame = (id: string, action: string, payload: object) => JSON.stringify([2, id, action, payload]);
export const resultFrame = (id: string, payload: object) => JSON.stringify([3, id, payload]);
export const errorFrame = (id: string, code: OcppErrorCode, description: string) =>
  JSON.stringify([4, id, code, description.slice(0, 255), {}]);

// Requests to the charge point --------------------------------------------------

/** A fresh idTag (CiString20) for one remote start; it also names the charge in our command log. */
export function ocppIdTag(random: () => string = () => crypto.randomUUID()): string {
  return `${OCPP_TAG_PREFIX}${random().replace(/-/g, "").toUpperCase()}`.slice(0, 20);
}

export const remoteStartRequest = (connectorId: number, idTag: string) => ({ connectorId, idTag });
export const remoteStopRequest = (transactionId: number) => ({ transactionId });

/** Whether the charge point took a Remote*Transaction request ({status: "Accepted"|"Rejected"}). */
export function accepted(payload: Record<string, unknown>): boolean {
  return payload.status === "Accepted";
}

// What the charge point reports -------------------------------------------------

// ChargePointStatus (section 7.7). Preparing and Reserved leave the outlet as it is:
// a car is plugged in but not charging yet, or the app holds the slot.
const CONNECTOR_STATUS: Record<string, DeviceStatus> = {
  Available: "free",
  Charging: "charging",
  SuspendedEV: "charging",
  SuspendedEVSE: "charging",
  Finishing: "done",
  Unavailable: "fault",
  Faulted: "fault",
};

export interface OcppStatusEffect {
  outlets: OutletReading[];
  /** Connector 0 is the charge point itself: its fault takes every outlet out. */
  allOutlets?: DeviceStatus;
}

function connector(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 16 ? value : undefined;
}

/** StatusNotification.req */
export function statusEffect(payload: Record<string, unknown>): OcppStatusEffect {
  const id = connector(payload.connectorId);
  const status = CONNECTOR_STATUS[String(payload.status)];
  if (id === undefined) throw new OcppCallError("TypeConstraintViolation", "connectorId");
  if (id === 0) return { outlets: [], allOutlets: status === "fault" ? "fault" : undefined };
  return { outlets: [{ outlet: id, status }] };
}

interface SampledValue {
  value?: unknown;
  measurand?: unknown;
  unit?: unknown;
  phase?: unknown;
}

/** One measurand of a meterValue, in W or Wh; per-phase values are added up when there is no total. */
function measure(samples: SampledValue[], measurand: string): number | undefined {
  const matching = samples.filter((s) => (s.measurand ?? "Energy.Active.Import.Register") === measurand);
  const total = matching.filter((s) => s.phase === undefined);
  const use = total.length ? total.slice(-1) : matching.filter((s) => /^L[123]$/.test(String(s.phase)));
  if (!use.length) return undefined;
  let sum = 0;
  for (const s of use) {
    const n = Number(s.value);
    if (!Number.isFinite(n)) return undefined;
    sum += /^k/i.test(String(s.unit ?? "")) ? n * 1000 : n;
  }
  return sum;
}

/**
 * MeterValues.req: the latest power draw and meter reading of a connector. The
 * meter counts up for the life of the charge point, so the energy of the charge
 * is the reading minus the transaction's meterStart.
 */
export function meterReading(payload: Record<string, unknown>, meterStart?: number): OutletReading | null {
  const id = connector(payload.connectorId);
  if (!id) return null; // connector 0 is the main meter
  const values = Array.isArray(payload.meterValue) ? payload.meterValue : [];
  const last = values.filter(isObject).slice(-1)[0];
  const samples = (last && Array.isArray(last.sampledValue) ? last.sampledValue : []).filter(isObject) as SampledValue[];
  const reading: OutletReading = { outlet: id };
  const power = measure(samples, "Power.Active.Import");
  const register = measure(samples, "Energy.Active.Import.Register");
  if (power !== undefined && power >= 0) reading.powerWatts = Math.round(power);
  if (register !== undefined && meterStart !== undefined && register >= meterStart) reading.energyWh = Math.round(register - meterStart);
  return reading;
}

/** A Basic auth header (security profile 1): the user is the charge point id, the password its key. */
export function basicAuth(header: string | null): { user: string; password: string } | null {
  const m = /^Basic\s+([A-Za-z0-9+/=]+)$/i.exec(header?.trim() ?? "");
  if (!m) return null;
  let decoded: string;
  try {
    decoded = atob(m[1]);
  } catch {
    return null;
  }
  const colon = decoded.indexOf(":");
  return colon < 0 ? null : { user: decoded.slice(0, colon), password: decoded.slice(colon + 1) };
}

/** A new AuthorizationKey for a charge point: 32 hex characters (the spec allows 16 to 40 bytes). */
export function ocppKey(random: () => string = () => crypto.randomUUID()): string {
  return random().replace(/-/g, "");
}
