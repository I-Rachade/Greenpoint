// greenpoint: the green label of poinderecharge. It counts the CO2 a person saves
// by riding electric instead of a petrol motorbike, gives a level (the label) and
// greenpoints (100 g CO2 = 1 point) for rewards. Shared by the app, the demo
// backend and the Worker. Rules: planung/greenpoint-nutzung.md.
//
// greenpoints are never money: not bought, not paid out, not transferable and
// kept apart from the wallet. CO2 figures are estimates ("environ").

import { FLEET_VEHICLE_TYPES, type FleetVehicleType } from "./drivers";
import type { VehicleType } from "./types";

/** 100 g of CO2 saved = 1 greenpoint. */
export const GRAMS_PER_POINT = 100;
/** A tree binds about 20 kg of CO2 a year; the app shows "equals X trees". */
export const TREE_GRAMS_PER_YEAR = 20_000;
/** Grams per km for a trip of `distanceMeters` (rounded down to whole grams). */
export function tripGrams(distanceMeters: number, vehicle: FleetVehicleType, factors: GreenpointFactors): number {
  return Math.floor((Math.max(0, distanceMeters) / 1000) * factors.kmGrams[vehicle]);
}

/** At most this many swaps or charges earn per person and day (all stations). */
export const MAX_EARNINGS_PER_DAY = 3;
/** How long a redemption code is valid. */
export const REDEEM_CODE_MINUTES = 15;

export type GreenpointLevel = "pousse" | "arbuste" | "arbre" | "foret";

/** Levels by the CO2 saved in total (never expires). */
export const LEVELS: { level: GreenpointLevel; fromGrams: number }[] = [
  { level: "pousse", fromGrams: 0 },
  { level: "arbuste", fromGrams: 50_000 },
  { level: "arbre", fromGrams: 250_000 },
  { level: "foret", fromGrams: 1_000_000 },
];

export const LEVEL_EMOJI: Record<GreenpointLevel, string> = { pousse: "🌱", arbuste: "🌿", arbre: "🌳", foret: "🌲" };

/**
 * CO2 saved, estimated against a petrol motorbike in Lomé (about 55 g/km)
 * versus an electric one on the Togolese grid (about 16 g/km).
 */
export interface GreenpointFactors {
  /** Per battery swap or charge without a meter, by vehicle (one battery of typical size). */
  batteryGrams: Record<VehicleType, number>;
  /** Per measured kWh (connected sockets that report energy). */
  kwhGrams: number;
  /** Per km a driver carries a parcel on one of our electric vehicles, by vehicle. */
  kmGrams: Record<FleetVehicleType, number>;
}



export const DEFAULT_FACTORS: GreenpointFactors = {
  batteryGrams: { scooter: 1500, moped: 2000, tricycle: 4000, ebike: 500 },
  kwhGrams: 1000,
  kmGrams: { moto: 40, tricycle: 60, cargo_tricycle: 60 },
};

/** Highest factor accepted, as a sanity bound (50 kg per battery). */
const MAX_FACTOR_GRAMS = 50_000;

export function validFactors(input: unknown): GreenpointFactors | null {
  const f = input as Partial<GreenpointFactors> | null;
  if (!f || typeof f !== "object" || !f.batteryGrams || typeof f.batteryGrams !== "object") return null;
  const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= MAX_FACTOR_GRAMS;
  const batteryGrams = {} as Record<VehicleType, number>;
  for (const v of Object.keys(DEFAULT_FACTORS.batteryGrams) as VehicleType[]) {
    if (!ok(f.batteryGrams[v])) return null;
    batteryGrams[v] = f.batteryGrams[v];
  }
  if (!ok(f.kwhGrams)) return null;
  // Factors saved before driver trips counted have no kmGrams: they get the defaults.
  const km = (f.kmGrams ?? DEFAULT_FACTORS.kmGrams) as Partial<Record<FleetVehicleType, unknown>>;
  const kmGrams = {} as Record<FleetVehicleType, number>;
  for (const v of FLEET_VEHICLE_TYPES) {
    if (!ok(km[v])) return null;
    kmGrams[v] = km[v] as number;
  }
  return { batteryGrams, kwhGrams: f.kwhGrams!, kmGrams };
}

/** Reads stored factors; anything broken falls back to the defaults. */
export function parseFactors(raw: string | null | undefined): GreenpointFactors {
  if (!raw) return DEFAULT_FACTORS;
  try {
    return validFactors(JSON.parse(raw)) ?? DEFAULT_FACTORS;
  } catch {
    return DEFAULT_FACTORS;
  }
}

export function pointsFor(grams: number): number {
  return Math.floor(grams / GRAMS_PER_POINT);
}

export function levelFor(grams: number): GreenpointLevel {
  let current: GreenpointLevel = "pousse";
  for (const l of LEVELS) if (grams >= l.fromGrams) current = l.level;
  return current;
}

/** The next level and how much CO2 it needs in total, or null at the top. */
export function nextLevel(grams: number): { level: GreenpointLevel; fromGrams: number } | null {
  return LEVELS.find((l) => l.fromGrams > grams) ?? null;
}

export function treesFor(grams: number): number {
  return Math.round((grams / TREE_GRAMS_PER_YEAR) * 10) / 10;
}

/** Where a person's CO2 and points come from. */
export type GreenpointKind = "swap" | "charge" | "visit" | "delivery" | "redeem" | "admin_adjust";

export interface GreenpointEntry {
  id: string;
  kind: GreenpointKind;
  co2Grams: number;
  points: number;
  vehicle: VehicleType | null;
  stationName: string | null;
  /** Title of the reward for "redeem". */
  rewardTitle: string | null;
  createdAt: string;
}

export interface GreenpointReward {
  id: string;
  title: string;
  description: string;
  costPoints: number;
  provider: "network" | "partner";
  partnerName: string | null;
  /** null = unlimited. */
  stock: number | null;
  validUntil: string | null;
  isActive: boolean;
}

export type GreenpointRewardInput = Omit<GreenpointReward, "id">;

export interface GreenpointRedemption {
  id: string;
  code: string;
  rewardTitle: string;
  costPoints: number;
  expiresAt: string;
}

/** What a rider sees on the greenpoint page. */
export interface GreenpointView {
  co2Grams: number;
  points: number;
  level: GreenpointLevel;
  next: { level: GreenpointLevel; fromGrams: number } | null;
  trees: number;
  vehicle: VehicleType;
  /** The open code, if the person is redeeming right now. */
  redemption: GreenpointRedemption | null;
  rewards: GreenpointReward[];
  history: GreenpointEntry[];
}

/** What staff see after entering a visit or a code. */
export interface GreenpointReceipt {
  person: string;
  co2Grams: number;
  points: number;
  rewardTitle: string | null;
}

export interface AdminGreenpoint {
  factors: GreenpointFactors;
  rewards: GreenpointReward[];
  totals: { co2Grams: number; pointsEarned: number; pointsRedeemed: number; members: number };
  recent: (GreenpointEntry & { person: string })[];
}

export const REWARD_TITLE_MAX = 80;
export const REWARD_DESCRIPTION_MAX = 240;

export function validRewardInput(input: unknown): GreenpointRewardInput | null {
  const r = input as Partial<GreenpointRewardInput> | null;
  if (!r || typeof r !== "object") return null;
  const title = String(r.title ?? "").trim();
  const description = String(r.description ?? "").trim();
  if (!title || title.length > REWARD_TITLE_MAX || description.length > REWARD_DESCRIPTION_MAX) return null;
  if (!Number.isInteger(r.costPoints) || r.costPoints! < 1 || r.costPoints! > 1_000_000) return null;
  const provider = r.provider === "partner" ? "partner" : "network";
  const partnerName = provider === "partner" ? String(r.partnerName ?? "").trim() : "";
  if (provider === "partner" && (!partnerName || partnerName.length > REWARD_TITLE_MAX)) return null;
  const stock = r.stock === null || r.stock === undefined ? null : r.stock;
  if (stock !== null && (!Number.isInteger(stock) || stock < 0)) return null;
  const validUntil = r.validUntil ? String(r.validUntil) : null;
  if (validUntil && Number.isNaN(Date.parse(validUntil))) return null;
  return {
    title,
    description,
    costPoints: r.costPoints!,
    provider,
    partnerName: partnerName || null,
    stock,
    validUntil,
    isActive: r.isActive !== false,
  };
}

/** Whether a reward can be redeemed now. */
export function rewardAvailable(r: GreenpointReward, now = new Date().toISOString()): boolean {
  return r.isActive && (r.stock === null || r.stock > 0) && (!r.validUntil || r.validUntil > now);
}

/** Start of the current UTC day, for the daily limit. */
export function dayStart(now = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

/** Formats grams as kg with one decimal ("1,5 kg" / "1.5 kg"). */
export function formatKg(grams: number, locale: "fr" | "en"): string {
  const kg = grams / 1000;
  return `${kg.toLocaleString(locale === "fr" ? "fr-FR" : "en-GB", { maximumFractionDigits: kg >= 100 ? 0 : 1 })} kg`;
}
