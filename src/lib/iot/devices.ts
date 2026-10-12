import type { ChargingPoint } from "../types";

// Connected sockets as the backoffice manages them. See docs/steckdosen-lora.md.

export type DeviceLink = "lorawan" | "vendor_cloud" | "own_server";
export const DEVICE_LINKS: DeviceLink[] = ["lorawan", "vendor_cloud", "own_server"];

export const MAX_OUTLETS = 16;

export interface DeviceInput {
  /** DevEUI (LoRaWAN) or the vendor's device number. */
  externalId: string;
  stationId: string;
  vendor?: string;
  model?: string;
  link?: DeviceLink;
  outlets?: number;
}

export interface Device {
  externalId: string;
  stationId: string;
  vendor: string;
  model: string;
  link: DeviceLink;
  outlets: number;
  lastSeenAt: string | null;
  createdAt: string;
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
    !!input.stationId
  );
}

/** Label of a new outlet's charging point: last 4 characters of the id and the outlet number. */
export function outletLabel(externalId: string, outlet: number): string {
  return `${externalId.slice(-4)}-${outlet}`;
}

/** Only Xingke sockets (6-digit device number) can be switched on and off so far. */
export function canSwitch(externalId: string): boolean {
  return /^\d{6}$/.test(externalId);
}
