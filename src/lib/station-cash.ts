/**
 * Station types and the daily cash handover (migration 0045).
 *
 * Each activity of a station has its own owner. Charging sockets belong to poinderecharge or
 * a point partner (0039). The battery swapping belongs to the operator at an operator station,
 * or to poinderecharge at a shop station, a partner that only hosts the station. At our own
 * stations everything is ours.
 *
 * The cash a partner station takes for poinderecharge (charges, our swaps, parcels, drivers'
 * cash, card top-ups) is handed back every day: the owner closes the day in the backoffice
 * and records the handover, an admin confirms it once the money arrived or rejects it. The
 * host earns a commission on what belongs to poinderecharge at the station, kept back at each
 * handover or paid monthly. A day not closed by 10:00 the next morning raises an alert.
 * Worker: worker/station-cash.ts. Demo: src/lib/backend/demo.ts. UI: src/components/owner/cash.tsx,
 * src/components/backoffice/station-cash-manager.tsx.
 */

export type SwapOwner = "operator" | "poinderecharge";
export type CommissionMode = "deduct" | "monthly";
export type StationType = "own" | "operator" | "shop";
export type HandoverMethod = "cash" | "mobile_money" | "bank";
export type HandoverStatus = "pending" | "confirmed" | "rejected";

export const HANDOVER_METHODS: readonly HandoverMethod[] = ["cash", "mobile_money", "bank"];
export const COMMISSION_MODES: readonly CommissionMode[] = ["deduct", "monthly"];
/** A day must be closed by this hour (Lomé = UTC) the next morning. */
export const CASH_DEADLINE_HOUR = 10;
export const HANDOVER_REFERENCE_MAX = 80;
export const HANDOVER_NOTE_MAX = 200;
const MAX_XOF = 1_000_000_000;

/** Who owns the swaps of a station: always us at our own stations; null = automatic. */
export function swapOwnerOf(isOwn: boolean, swapOwner: SwapOwner | null | undefined): SwapOwner {
  return isOwn ? "poinderecharge" : (swapOwner ?? "operator");
}

export function stationType(isOwn: boolean, swapOwner: SwapOwner | null | undefined): StationType {
  if (isOwn) return "own";
  return swapOwnerOf(false, swapOwner) === "poinderecharge" ? "shop" : "operator";
}

export function cleanSwapOwner(value: unknown): SwapOwner | null {
  return value === "operator" || value === "poinderecharge" ? value : null;
}

export function cleanCommissionMode(value: unknown): CommissionMode {
  return value === "deduct" ? "deduct" : "monthly";
}

export function validCommissionPct(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 100;
}

export function commissionOf(baseXof: number, pct: number): number {
  return Math.round((Math.max(0, baseXof) * pct) / 100);
}

/** POST /api/admin/cash/stations/:id: the station type and the host's commission. */
export interface StationCashSettings {
  swapOwner: SwapOwner;
  commissionPct: number;
  commissionMode: CommissionMode;
}

/** Cash taken for poinderecharge, by what it was for. */
export interface CashLines {
  chargesXof: number;
  swapsXof: number;
  parcelsXof: number;
  /** Drivers' cash settled at the station; negative when the station paid a driver out. */
  driversXof: number;
  cardsXof: number;
  /** Green Credit loaded at the counter (0047). */
  creditXof: number;
  totalXof: number;
}

export type CashKind = Exclude<keyof CashLines, "totalXof">;

export interface CashHandover {
  id: string;
  stationId: string;
  periodFrom: string;
  periodUntil: string;
  cashXof: number;
  carryXof: number;
  commissionXof: number;
  dueXof: number;
  amountXof: number;
  method: HandoverMethod;
  reference: string;
  note: string | null;
  status: HandoverStatus;
  createdBy: string;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
}

/** GET /api/owner/cash: a partner station's balance, what is due now and its handovers. */
export interface StationCash {
  stationId: string;
  stationName: string;
  operatorName: string;
  type: Exclude<StationType, "own">;
  commissionPct: number;
  commissionMode: CommissionMode;
  /** Start of the open period: the last closing, or where the station's balance starts. */
  since: string;
  /** Cash taken for poinderecharge since then. */
  lines: CashLines;
  /** What the commission is computed on in the open period. */
  commissionBaseXof: number;
  /** Kept back now (deduct mode only). */
  commissionXof: number;
  /** Left over from earlier closings (+ still owed, − owed to the station). */
  carryXof: number;
  /** To hand over now: lines + carry − commission. */
  dueXof: number;
  /** Handed over, waiting for the admin's confirmation. */
  pendingXof: number;
  /** Oldest cash of the open period, if any. */
  oldestOpenAt: string | null;
  /** A day with cash for poinderecharge not closed by 10:00 the next morning. */
  late: boolean;
  /** This calendar month: the commission earned (either mode). */
  monthCommissionXof: number;
  /** Newest first, at most 30. */
  handovers: CashHandover[];
}

export interface HandoverInput {
  stationId: string;
  amountXof: number;
  method: HandoverMethod;
  /** Agent's name (cash) or transaction / receipt number. */
  reference: string;
  note?: string | null;
  /** The amount due the owner saw: a different one now means the figures moved (409). */
  expectedDueXof: number;
}

/** What a closing checks before anything is looked up; the error code, or null. */
export function handoverInputError(input: Partial<HandoverInput> | null | undefined): string | null {
  if (!input || typeof input.stationId !== "string") return "bad_request";
  if (typeof input.amountXof !== "number" || !Number.isInteger(input.amountXof) || input.amountXof < 0 || input.amountXof > MAX_XOF) return "invalid_amount";
  if (!HANDOVER_METHODS.includes(input.method as HandoverMethod)) return "bad_request";
  const reference = typeof input.reference === "string" ? input.reference.trim() : "";
  if (!reference || reference.length > HANDOVER_REFERENCE_MAX) return "handover_reference_required";
  if (input.note != null && (typeof input.note !== "string" || input.note.trim().length > HANDOVER_NOTE_MAX)) return "bad_request";
  if (typeof input.expectedDueXof !== "number" || !Number.isInteger(input.expectedDueXof)) return "bad_request";
  // A different amount than due needs a reason.
  if (input.amountXof !== Math.max(0, input.expectedDueXof) && !input.note?.trim()) return "handover_note_required";
  return null;
}

/** Midnight in Lomé (UTC) of the day of `now`. */
export function dayStartOf(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
}

export function monthStartOf(now: Date): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

/** Cash taken before today and still not closed, once today's deadline has passed. */
export function isLate(oldestOpenAt: string | null, now: Date): boolean {
  return !!oldestOpenAt && oldestOpenAt < dayStartOf(now) && now.getUTCHours() >= CASH_DEADLINE_HOUR;
}

/** One cash amount taken for poinderecharge. */
export interface CashItem {
  kind: CashKind;
  at: string;
  amountXof: number;
}

/** What the commission counts: a sale of ours at the station (any payment). */
export interface CommissionItem {
  at: string;
  amountXof: number;
}

export interface StationCashInput {
  stationId: string;
  stationName: string;
  operatorName: string;
  swapOwner: SwapOwner;
  commissionPct: number;
  commissionMode: CommissionMode;
  /** Where the balance starts (stations.cash_since, else the station's creation). */
  start: string;
  /** Cash items from `start` on (older ones are ignored). */
  cash: CashItem[];
  /** Commission items from the earlier of `start` and the month's start on. */
  sales: CommissionItem[];
  /** Every handover of the station, any order. */
  handovers: CashHandover[];
}

/** Counted as handed over: confirmed, or pending (the owner is not asked twice); rejected counts nothing. */
const counted = (h: CashHandover) => (h.status === "rejected" ? 0 : h.amountXof);

/** The open period of a station: from its last closing (or its start) to now. */
export function openPeriodStart(start: string, handovers: { periodUntil: string }[]): string {
  return handovers.reduce((a, h) => (h.periodUntil > a ? h.periodUntil : a), start);
}

/** The balance of a station from its rows (shared by the Worker and the demo). */
export function stationCash(input: StationCashInput, now: Date): StationCash {
  const since = openPeriodStart(input.start, input.handovers);
  const nowIso = now.toISOString();
  // A closing covers up to and including its end: what happened at that instant is not counted twice.
  const open = (at: string) => (since === input.start ? at >= since : at > since) && at <= nowIso;
  const lines: CashLines = { chargesXof: 0, swapsXof: 0, parcelsXof: 0, driversXof: 0, cardsXof: 0, creditXof: 0, totalXof: 0 };
  let oldestOpenAt: string | null = null;
  for (const c of input.cash) {
    if (!open(c.at) || !c.amountXof) continue;
    lines[c.kind] += c.amountXof;
    lines.totalXof += c.amountXof;
    if (!oldestOpenAt || c.at < oldestOpenAt) oldestOpenAt = c.at;
  }
  const inOpen = input.sales.filter((s) => open(s.at));
  const commissionBaseXof = inOpen.reduce((a, s) => a + s.amountXof, 0);
  const commissionXof = input.commissionMode === "deduct" ? commissionOf(commissionBaseXof, input.commissionPct) : 0;
  const carryXof = input.handovers.reduce((a, h) => a + h.cashXof - h.commissionXof - counted(h), 0);
  const monthStart = monthStartOf(now);
  const monthBase = input.sales.filter((s) => s.at >= monthStart && s.at >= input.start && s.at <= nowIso).reduce((a, s) => a + s.amountXof, 0);
  return {
    stationId: input.stationId,
    stationName: input.stationName,
    operatorName: input.operatorName,
    type: input.swapOwner === "poinderecharge" ? "shop" : "operator",
    commissionPct: input.commissionPct,
    commissionMode: input.commissionMode,
    since,
    lines,
    commissionBaseXof,
    commissionXof,
    carryXof,
    dueXof: lines.totalXof + carryXof - commissionXof,
    pendingXof: input.handovers.filter((h) => h.status === "pending").reduce((a, h) => a + h.amountXof, 0),
    oldestOpenAt,
    late: isLate(oldestOpenAt, now),
    monthCommissionXof: commissionOf(monthBase, input.commissionPct),
    handovers: [...input.handovers].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
  };
}
