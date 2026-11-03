import { BATTERY_LABEL_MAX, cleanBatteryLabel, REASON_MAX, type StationRole } from "./station-work";

/**
 * Battery register (migration 0041_batteries.sql): every swap battery by its number, per
 * brand, with its own history. Worker: worker/batteries.ts and recordSwap() in
 * worker/station-work.ts; the demo backend (src/lib/backend/demo.ts) follows the same rules.
 *
 * A battery gets into the register in two ways:
 *   registered     an admin enters it in advance (one number or a pasted list) for a battery type
 *   added at swap  a swap names a number nobody registered yet: it is added with the swap's type
 * A number is unique within a brand. At a station that lists no battery types the brand is
 * not known: such a battery has brand "" until a register entry or a swap names its type.
 *
 * Swap rules:
 *   - at a station with battery types the numbers are required (the one handed out, and the
 *     one brought back unless it is a first purchase), so every swap is in a battery's history
 *   - a number registered under another brand than the swap's type is refused (battery_wrong_brand)
 *   - handed out: the battery is with the customer; brought back: at the station
 *
 * Who sees it: admins (and change the status, register batteries); a station's owner reads
 * the batteries that went through their stations, without the people of other operators' stations.
 */

export const BATTERY_STATUSES = ["in_service", "repair", "lost", "retired"] as const;
export type BatteryStatus = (typeof BATTERY_STATUSES)[number];

export type BatterySource = "registered" | "swap";
export type BatteryLocation = "station" | "customer" | "unknown";
export type BatteryHistoryType = "registered" | "added_at_swap" | "out" | "in" | "status";

/** Most numbers one register request takes. */
export const REGISTER_MAX = 500;

export interface BatteryView {
  id: string;
  serial: string;
  /** "" = not known yet (added at a station without battery types). */
  brand: string;
  batteryTypeId: string | null;
  /** Brand and model of its type; null without one. */
  typeLabel: string | null;
  status: BatteryStatus;
  source: BatterySource;
  location: BatteryLocation;
  /** location "station": where. */
  stationId: string | null;
  stationName: string | null;
  /** location "customer": the customer or driver, when known (an owner: only at own stations). */
  holder: string | null;
  /** Swaps it was part of (handed out or brought back). */
  swaps: number;
  lastSwapAt: string | null;
  createdAt: string;
}

export interface BatteryHistoryEntry {
  id: string;
  type: BatteryHistoryType;
  stationId: string | null;
  stationName: string | null;
  swapId: string | null;
  /** out / in: the customer or driver; null for a cash customer, or hidden from an owner. */
  holder: string | null;
  /** Payment of the swap (out / in), as the swap log has it. */
  payment: string | null;
  amountXof: number | null;
  /** status: the new status. */
  status: BatteryStatus | null;
  reason: string | null;
  /** Who did it; "" when hidden from an owner (another operator's station). */
  person: string;
  role: StationRole;
  createdAt: string;
}

export interface BatteryDetail extends BatteryView {
  /** Newest first. */
  history: BatteryHistoryEntry[];
}

export interface BrandCount {
  /** "" = brand not known yet. */
  brand: string;
  count: number;
}

export interface BatteryList {
  /** Every brand with a battery type or a battery, sorted (unknown last), with its batteries. */
  brands: BrandCount[];
  /** The batteries of the filter, last swapped first (at most BATTERY_LIST_MAX). */
  batteries: BatteryView[];
  /** The viewer may register batteries and change a status (admins). */
  canEdit: boolean;
}

export const BATTERY_LIST_MAX = 500;

export interface BatteryFilter {
  /** One brand ("" = not known yet); undefined/null = all. */
  brand?: string | null;
  /** Part of the number. */
  q?: string | null;
  status?: BatteryStatus | null;
  /** Batteries that went through this station. */
  stationId?: string | null;
}

export interface RegisterBatteriesInput {
  batteryTypeId: string;
  /** Numbers, as typed or pasted. */
  serials: string[];
}

export interface RegisterBatteriesResult {
  added: number;
  /** Already registered for this brand: left as they are. */
  existing: string[];
  /** Empty or longer than BATTERY_LABEL_MAX. */
  invalid: string[];
}

export interface BatteryStatusInput {
  status: BatteryStatus;
  reason?: string | null;
}

/** What the swap form shows under a battery number before the swap is saved. */
export interface BatteryLookup {
  state: "known" | "new" | "wrong_brand";
  /** known / wrong_brand: the brand it is registered under ("" = not known yet). */
  brand: string | null;
  status: BatteryStatus | null;
}

export function isBatteryStatus(value: unknown): value is BatteryStatus {
  return typeof value === "string" && (BATTERY_STATUSES as readonly string[]).includes(value);
}

/** A swap at a station with battery types needs the battery numbers. */
export function batteryNumbersRequired(stationHasTypes: boolean): boolean {
  return stationHasTypes;
}

/** Numbers of a pasted list (lines, commas, semicolons or spaces), cleaned, each once, in order. */
export function parseSerials(text: string): { serials: string[]; invalid: string[] } {
  const serials: string[] = [];
  const invalid: string[] = [];
  for (const part of String(text ?? "").split(/[\s,;]+/)) {
    if (!part) continue;
    const clean = cleanBatteryLabel(part);
    if (!clean) invalid.push(part);
    else if (!serials.includes(clean)) serials.push(clean);
  }
  return { serials, invalid };
}

export function cleanStatusReason(reason: unknown): string | null | undefined {
  if (reason === undefined || reason === null) return null;
  const text = String(reason).trim();
  if (!text) return null;
  return text.length <= REASON_MAX ? text : undefined;
}

/** Brands sorted by name, the unknown brand ("") last. */
export function sortBrands(brands: BrandCount[]): BrandCount[] {
  return [...brands].sort((a, b) => (a.brand === "") !== (b.brand === "") ? (a.brand === "" ? 1 : -1) : a.brand.localeCompare(b.brand));
}

export { BATTERY_LABEL_MAX };
