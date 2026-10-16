import type { ChargingPoint } from "../types";

// Connected sockets as the backoffice manages them. See docs/steckdosen-lora.md.

export type DeviceLink = "lorawan" | "vendor_cloud" | "own_server";
export const DEVICE_LINKS: DeviceLink[] = ["lorawan", "vendor_cloud", "own_server"];

export const MAX_OUTLETS = 16;

/** How a socket on our own server talks to us; null for the text-line bridge. */
export type DeviceProtocol = "ocpp1.6";

export interface DeviceInput {
  /** DevEUI (LoRaWAN) or the vendor's device number. */
  externalId: string;
  stationId: string;
  vendor?: string;
  model?: string;
  link?: DeviceLink;
  outlets?: number;
  /** "ocpp1.6": the charge point connects straight to us (link "own_server"), see worker/ocpp.ts. */
  protocol?: DeviceProtocol | null;
  /** OCPP only: the charge point connects without a password (firmware that cannot send one). */
  ocppNoPassword?: boolean;
}

export interface Device {
  externalId: string;
  stationId: string;
  vendor: string;
  model: string;
  link: DeviceLink;
  outlets: number;
  protocol: DeviceProtocol | null;
  /** OCPP charge point that connects without a password. */
  ocppOpen: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  /** The point partner who owns the socket; null: poinderecharge (src/lib/point-partners.ts). */
  partnerId: string | null;
  /** One charging point per outlet, by outlet number. */
  points: ChargingPoint[];
}

/** Ids are stored upper-case, so a DevEUI matches however the network server spells it. */
export function normalizeDeviceId(id: string): string {
  return id.trim().toUpperCase();
}

export function validDeviceInput(input: DeviceInput): boolean {
  const outlets = input.outlets ?? 2;
  return (
    /^[0-9A-Z:_-]{4,64}$/.test(normalizeDeviceId(String(input.externalId ?? ""))) &&
    Number.isInteger(outlets) &&
    outlets >= 1 &&
    outlets <= MAX_OUTLETS &&
    DEVICE_LINKS.includes(input.link ?? "lorawan") &&
    (!input.protocol || (input.protocol === "ocpp1.6" && input.link === "own_server")) &&
    !!input.stationId
  );
}

/** Label of a new outlet's charging point: last 4 characters of the id and the outlet number. */
export function outletLabel(externalId: string, outlet: number): string {
  return `${externalId.slice(-4)}-${outlet}`;
}

/**
 * How we send commands to a socket:
 * - `xingke_cloud`: the Xingke cloud API (link "vendor_cloud", vendor "Xingke"), see worker/xingke.ts.
 * - `ocpp`: OCPP 1.6J over the charge point's own WebSocket to us, see worker/ocpp.ts.
 * - `xingke_bridge`: text lines of protocol V1.1 queued for a bridge (6-digit device number).
 * Other sockets only report and cannot be switched.
 */
export type CommandRoute = "xingke_cloud" | "ocpp" | "xingke_bridge";

type RouteFields = Pick<Device, "externalId" | "vendor" | "link"> & { protocol?: DeviceProtocol | null };

export function commandRoute(device: RouteFields): CommandRoute | null {
  if (device.protocol === "ocpp1.6") return "ocpp";
  if (device.link === "vendor_cloud" && /xingke/i.test(device.vendor)) return "xingke_cloud";
  if (/^\d{6}$/.test(device.externalId)) return "xingke_bridge";
  return null;
}

export function canSwitch(device: RouteFields): boolean {
  return commandRoute(device) !== null;
}
