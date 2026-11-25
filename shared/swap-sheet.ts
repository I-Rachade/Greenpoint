// The swap sheet ("ANNEXE - FICHE DE SWAP" of the Omnivoltaic agent training): a station's swaps over
// one or more days, one numbered line each, the day's total and the calculation reminder.
// Exported as CSV for a spreadsheet and as a printable page (src/components/station-work/swap-sheet.tsx).
import type { SwapEntry } from "./station-work";

export interface SwapSheetLabels {
  title: string;
  station: string;
  date: string;
  agent: string;
  /** The 12 columns, in the annex's order. */
  columns: readonly string[];
  total: string;
  calc: string;
  signature: string;
  networks: { tmoney: string; flooz: string };
}

export interface SwapSheet {
  station: string;
  /** dd/mm/yyyy, or "dd/mm/yyyy – dd/mm/yyyy" over several days. */
  date: string;
  /** The agents who recorded the swaps, each once. */
  agents: string;
  /** One line per swap, oldest first: the 12 cells of the annex. */
  rows: string[][];
  totalXof: number;
}

const dmy = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** "Omnivoltaic 30 Ah" → "30"; a type without Ah keeps its name; no type → "". */
export function typeAh(label: string | null | undefined): string {
  if (!label) return "";
  const m = /(\d+(?:[.,]\d+)?)\s*Ah\b/i.exec(label);
  return m ? m[1] : label;
}

/**
 * The sheet of `swaps` (any order) between `from` and `to` (YYYY-MM-DD, Lomé = UTC).
 * Hours are Lomé time; over several days each hour carries its day. `amount` formats a sum.
 */
export function swapSheet(
  swaps: readonly SwapEntry[],
  opts: { station: string; from: string; to: string; labels: Pick<SwapSheetLabels, "networks">; amount: (xof: number) => string },
): SwapSheet {
  const oneDay = opts.from === opts.to;
  const sorted = [...swaps].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const hour = (iso: string) => {
    const hm = iso.slice(11, 16);
    return oneDay ? hm : `${iso.slice(8, 10)}/${iso.slice(5, 7)} ${hm}`;
  };
  const pct = (v: number | null | undefined) => (v == null ? "" : `${v} %`);
  const rows = sorted.map((s, i) => [
    String(i + 1),
    hour(s.createdAt),
    typeAh(s.batteryTypeLabel),
    s.customerName ?? s.customer ?? s.driver ?? "",
    s.plate ?? "",
    s.batteryIn ?? "",
    pct(s.inPct),
    s.batteryOut ?? "",
    pct(s.outPct),
    opts.amount(s.amountXof),
    s.mmRef ? `${s.mmRef}${s.mmNetwork ? ` (${opts.labels.networks[s.mmNetwork]})` : ""}` : "",
    s.person,
  ]);
  return {
    station: opts.station,
    date: oneDay ? dmy(opts.from) : `${dmy(opts.from)} – ${dmy(opts.to)}`,
    agents: [...new Set(sorted.map((s) => s.person).filter(Boolean))].join(", "),
    rows,
    totalXof: sorted.reduce((sum, s) => sum + s.amountXof, 0),
  };
}

/** The sheet as spreadsheet rows (for toCsv): title, header line, columns, swaps, total, calculation. */
export function swapSheetRows(sheet: SwapSheet, labels: SwapSheetLabels, amount: (xof: number) => string): string[][] {
  const blank = (n: number) => Array<string>(n).fill("");
  return [
    [labels.title],
    [labels.station, sheet.station, labels.date, sheet.date, labels.agent, sheet.agents],
    [],
    [...labels.columns],
    ...sheet.rows,
    [...blank(8), labels.total, amount(sheet.totalXof)],
    [],
    [labels.calc],
    [labels.signature],
  ];
}
