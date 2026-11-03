// Swaps priced by the energy given (Omnivoltaic procedure, migration 0065_energy_swap.sql):
// the customer pays only the charge added, (% OUT - % IN) / 100 x the battery type's price for
// 100 %, rounded to the nearest 5 FCFA, by T-Money or Flooz straight to the brand's merchant
// number. The staff dial nothing: the customer dials the code with the amount filled in, and
// the staff type the transaction id the network sent back. Used by the Worker
// (worker/station-work.ts) and the swap form (src/components/station-work/swap-page.tsx).

export type BatteryPricing = "station" | "energy";
export const BATTERY_PRICINGS: readonly BatteryPricing[] = ["station", "energy"];

export const MM_NETWORKS = ["tmoney", "flooz"] as const;
export type MmNetwork = (typeof MM_NETWORKS)[number];

/** Amounts are rounded to this many FCFA (the procedure's internal rule). */
export const ENERGY_ROUND_XOF = 5;
export const ENERGY_PRICE_MAX = 1_000_000;

/** Stands for the amount in a USSD code. */
export const USSD_AMOUNT = "{montant}";

/** The codes of the procedure, offered when a type is switched to energy pricing. */
export const DEFAULT_USSD: Record<MmNetwork, string> = {
  tmoney: "*145*5*{montant}*1088722#",
  flooz: "*155*2*2*22879392818*22879392818*{montant}#",
};

/** State of the battery brought back; anything but "ok" puts it in repair. */
export const BATTERY_CONDITIONS = ["ok", "damaged", "leak", "hot", "smell"] as const;
export type BatteryCondition = (typeof BATTERY_CONDITIONS)[number];

export function isBatteryPricing(v: unknown): v is BatteryPricing {
  return typeof v === "string" && (BATTERY_PRICINGS as readonly string[]).includes(v);
}

export function isMmNetwork(v: unknown): v is MmNetwork {
  return typeof v === "string" && (MM_NETWORKS as readonly string[]).includes(v);
}

export function isBatteryCondition(v: unknown): v is BatteryCondition {
  return typeof v === "string" && (BATTERY_CONDITIONS as readonly string[]).includes(v);
}

/** A battery's charge as read on it: a whole number 0…100. */
export function validPct(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 100;
}

export function validEnergyPrice(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= ENERGY_PRICE_MAX;
}

/**
 * What a swap costs: the charge added (% OUT - % IN) times the price for 100 %, rounded to the
 * nearest 5 FCFA. Null when a percentage is not 0…100 or OUT is not above IN (the procedure:
 * check the swap before taking any money).
 */
export function energySwapAmount(inPct: unknown, outPct: unknown, priceFullXof: number): { suppliedPct: number; amountXof: number } | null {
  if (!validPct(inPct) || !validPct(outPct) || outPct <= inPct || !validEnergyPrice(priceFullXof)) return null;
  const suppliedPct = outPct - inPct;
  const amountXof = Math.round((suppliedPct * priceFullXof) / 100 / ENERGY_ROUND_XOF) * ENERGY_ROUND_XOF;
  return { suppliedPct, amountXof };
}

/** The code the customer dials, the amount filled in. */
export function ussdCode(template: string, amountXof: number): string {
  return template.split(USSD_AMOUNT).join(String(amountXof));
}

/** A USSD code as typed in the backoffice: digits, * and #, with {montant} once or more; "" = none (null). Undefined when not valid. */
export function cleanUssdTemplate(raw: unknown): string | null | undefined {
  const text = String(raw ?? "").replace(/\s+/g, "");
  if (!text) return null;
  if (text.length > 80 || !text.includes(USSD_AMOUNT) || !/^[0-9*#]+$/.test(text.split(USSD_AMOUNT).join(""))) return undefined;
  return text;
}

/** The transaction id sent by T-Money or Flooz, as typed: spaces dropped, upper case, 4…40 letters, digits, dots or dashes. */
export function cleanMmRef(raw: unknown): string | null {
  const text = String(raw ?? "").replace(/\s+/g, "").toUpperCase();
  return /^[A-Z0-9.\-]{4,40}$/.test(text) ? text : null;
}

/** A vehicle plate as typed: upper case, inner spaces kept single, 2…20 characters. */
export function cleanPlate(raw: unknown): string | null {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ").toUpperCase();
  return text.length >= 2 && text.length <= 20 ? text : null;
}

/** A walk-in customer's name: 1…80 characters; empty = none. Undefined when too long. */
export function cleanCustomerName(raw: unknown): string | null | undefined {
  const text = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!text) return null;
  return text.length <= 80 ? text : undefined;
}

/** What a station's counter row says about energy pricing; null = the station's price applies. */
export interface EnergyPricing {
  priceFullXof: number;
  /** The USSD codes per network ("{montant}" for the amount); a network without one is not offered. */
  ussd: Partial<Record<MmNetwork, string>>;
}

/** Energy pricing of a type row from the database, or null when it is priced by the station or has no price. */
export function energyPricingOf(r: { pricing?: string | null; price_full_xof?: number | null; ussd_tmoney?: string | null; ussd_flooz?: string | null }): EnergyPricing | null {
  if (r.pricing !== "energy" || !validEnergyPrice(r.price_full_xof)) return null;
  const ussd: Partial<Record<MmNetwork, string>> = {};
  if (r.ussd_tmoney) ussd.tmoney = r.ussd_tmoney;
  if (r.ussd_flooz) ussd.flooz = r.ussd_flooz;
  return { priceFullXof: r.price_full_xof, ussd };
}

/** What a swap priced by energy needs from the form, as the Worker and the demo check it. */
export interface EnergySwapFields {
  customerType: string;
  inPct?: number | null;
  outPct?: number | null;
  plate?: string | null;
  customerName?: string | null;
  batteryInCondition?: string | null;
  batteryOutChecked?: boolean;
  mmNetwork?: string | null;
  mmRef?: string | null;
}

export interface EnergySwap {
  inPct: number;
  outPct: number;
  amountXof: number;
  plate: string;
  customerName: string | null;
  condition: BatteryCondition;
  mmNetwork: MmNetwork;
  mmRef: string;
}

/**
 * Checks a swap priced by energy as the procedure asks: an app or walk-in customer, both charges
 * read and OUT above IN, the plate, the state of the battery brought back, the battery handed out
 * checked, and the payment's network (one the type offers) and transaction id. Returns the error
 * code of the first thing missing.
 */
export type EnergySwapError =
  | "energy_customer_type"
  | "energy_pct_required"
  | "energy_out_not_above_in"
  | "plate_required"
  | "bad_request"
  | "battery_condition_required"
  | "battery_out_check_required"
  | "mm_network_invalid"
  | "mm_ref_required";

export function checkEnergySwap(input: EnergySwapFields, energy: EnergyPricing): { ok: true; swap: EnergySwap } | { ok: false; error: EnergySwapError } {
  const fail = (error: EnergySwapError) => ({ ok: false as const, error });
  if (input.customerType !== "app" && input.customerType !== "cash") return fail("energy_customer_type");
  if (!validPct(input.inPct) || !validPct(input.outPct)) return fail("energy_pct_required");
  const priced = energySwapAmount(input.inPct, input.outPct, energy.priceFullXof);
  if (!priced) return fail("energy_out_not_above_in");
  const plate = cleanPlate(input.plate);
  if (!plate) return fail("plate_required");
  const customerName = cleanCustomerName(input.customerName);
  if (customerName === undefined) return fail("bad_request");
  if (!isBatteryCondition(input.batteryInCondition)) return fail("battery_condition_required");
  if (input.batteryOutChecked !== true) return fail("battery_out_check_required");
  if (!isMmNetwork(input.mmNetwork) || !energy.ussd[input.mmNetwork]) return fail("mm_network_invalid");
  const mmRef = cleanMmRef(input.mmRef);
  if (!mmRef) return fail("mm_ref_required");
  return {
    ok: true,
    swap: { inPct: input.inPct, outPct: input.outPct, amountXof: priced.amountXof, plate, customerName, condition: input.batteryInCondition, mmNetwork: input.mmNetwork, mmRef },
  };
}

/** Why a battery brought back is put in repair, in its history. */
export const CONDITION_REASON: Record<Exclude<BatteryCondition, "ok">, string> = {
  damaged: "Swap : rendue endommagée",
  leak: "Swap : rendue avec une fuite",
  hot: "Swap : rendue anormalement chaude",
  smell: "Swap : rendue avec une odeur inhabituelle",
};
