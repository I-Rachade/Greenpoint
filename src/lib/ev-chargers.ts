import type { StationView } from "./types";

// Charging stations for electric cars ("bornes VE"). The admin adds them in the
// backoffice, then assigns each to a station; a station with at least one active
// charger assigned can charge electric cars and the app says so.
// Migrations 0020_ev_chargers.sql, 0024_ev_schuko.sql.

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
}

/** A charger as the app shows it at its station. */
export type StationEvCharger = Pick<EvCharger, "id" | "name" | "connector" | "powerKw">;

export interface EvChargerInput {
  name: string;
  connector: EvConnector;
  powerKw: number;
  stationId: string | null;
  isActive: boolean;
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
    (input.stationId === null || typeof input.stationId === "string")
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
