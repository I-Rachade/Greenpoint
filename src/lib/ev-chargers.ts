import type { ChargingPoint, StationView } from "./types";

// Charging stations for electric cars ("bornes VE"). The admin adds them in the
// backoffice, then assigns each to a station; a station with at least one active
// charger assigned can charge electric cars and the app says so.
// Migrations 0020_ev_chargers.sql, 0024_ev_schuko.sql.
//
// A charger can be connected (0048): linked to an outlet of a connected device (OCPP or a
// vendor's cloud API, like the motorbike sockets). The app then starts, stops and meters it
// itself, and the customer pays it like a motorbike outlet (QR code, PIN, Green Credit; cash
// at the counter), at the car price (DEFAULT_EV_TARIFF in charging.ts). Its outlet is not one
// of the station's motorbike places.

/** Plug types common on electric cars in West Africa. */
export type EvConnector = "type2" | "ccs2" | "chademo" | "gbt_ac" | "gbt_dc" | "schuko";
export const EV_CONNECTORS: EvConnector[] = ["type2", "ccs2", "chademo", "gbt_ac", "gbt_dc", "schuko"];

/** Highest charging power accepted, in kW. */
export const MAX_EV_POWER_KW = 400;

export interface EvCharger {
  id: string;
  /** Name shown to riders and staff, e.g. "Borne 1". */
  name: string;
  connector: EvConnector;
  /** Charging power in kW. */
  powerKw: number;
  /** Station the charger is assigned to; null until the admin assigns it. */
  stationId: string | null;
  isActive: boolean;
  /** The connected outlet that switches and meters it; null: not connected. */
  pointId: string | null;
}

/** The outlet of a connected charger, as the app shows its state. */
export type EvPoint = Pick<ChargingPoint, "id" | "status" | "deviceId" | "outlet" | "lastSeenAt" | "qrStart">;

/** A charger as the app shows it at its station. */
export type StationEvCharger = Pick<EvCharger, "id" | "name" | "connector" | "powerKw"> & {
  /** Station list only: an active reservation holds this charger (src/lib/reservations.ts). */
  reserved?: boolean;
  /** Connected chargers: the outlet that switches and meters it. */
  point?: EvPoint;
};

export interface EvChargerInput {
  name: string;
  connector: EvConnector;
  powerKw: number;
  stationId: string | null;
  isActive: boolean;
  /** Connects the charger to this outlet of a connected device (same station); null: none. */
  pointId?: string | null;
}

export function validEvCharger(input: EvChargerInput): boolean {
  const name = String(input?.name ?? "").trim();
  const power = Number(input?.powerKw);
  return (
    name.length >= 1 &&
    name.length <= 80 &&
    EV_CONNECTORS.includes(input?.connector) &&
    Number.isFinite(power) &&
    power > 0 &&
    power <= MAX_EV_POWER_KW &&
    (input.stationId === null || typeof input.stationId === "string") &&
    (input.pointId === undefined || input.pointId === null || (typeof input.pointId === "string" && !!input.stationId))
  );
}

/** Whether the station can charge electric cars: it has at least one active charger assigned. */
export function chargesEvs(station: Pick<StationView, "evChargers">): boolean {
  return (station.evChargers ?? []).length > 0;
}

/** Highest power among the station's chargers, in kW (0 when it has none). */
export function maxEvPower(station: Pick<StationView, "evChargers">): number {
  return Math.max(0, ...(station.evChargers ?? []).map((c) => c.powerKw));
}
