import { describe, expect, it } from "vitest";
import { swapDayRange, type SwapEntry } from "../station-work";
import { swapSheet, swapSheetRows, typeAh, type SwapSheetLabels } from "../swap-sheet";

const labels: SwapSheetLabels = {
  title: "ANNEXE - FICHE DE SWAP",
  station: "Station :",
  date: "Date :",
  agent: "Agent :",
  columns: ["N°", "Heure", "Type (Ah)", "Client", "N° Plaque", "Batterie IN ID", "IN %", "Batterie OUT ID", "OUT %", "Montant", "ID trans. Mobile Money", "Signature Agent"],
  total: "MONTANT TOTAL",
  calc: "Calcul : (% OUT - % IN) × tarif 100 % ÷ 100.",
  signature: "Signature Agent :",
  networks: { tmoney: "T-Money", flooz: "Flooz" },
};

const entry = (over: Partial<SwapEntry>): SwapEntry => ({
  id: "s",
  stationId: "be",
  batteryTypeId: "ov30",
  batteryTypeLabel: "Omnivoltaic 30 Ah",
  batteryIn: "OV30-1",
  batteryOut: "OV30-2",
  customerType: "cash",
  customer: null,
  driver: null,
  payment: "mobile_money",
  amountXof: 720,
  reservationId: null,
  inPct: 20,
  outPct: 100,
  plate: "TG 1234 AB",
  customerName: "Koffi",
  mmNetwork: "tmoney",
  mmRef: "TM2611",
  person: "Afi",
  role: "staff",
  createdAt: "2026-11-02T09:05:00.000Z",
  ...over,
});

describe("swap sheet (annex of the agent training)", () => {
  it("reads the Ah of a type", () => {
    expect(typeAh("Omnivoltaic 30 Ah")).toBe("30");
    expect(typeAh("Spiro 72 V")).toBe("Spiro 72 V");
    expect(typeAh(null)).toBe("");
  });

  it("numbers the swaps oldest first with the annex's 12 columns, the total and the calculation", () => {
    const swaps = [
      entry({ id: "b", createdAt: "2026-11-02T14:40:00.000Z", amountXof: 780, batteryTypeLabel: "Omnivoltaic 45 Ah", inPct: 35, mmNetwork: "flooz", mmRef: "FL77", person: "Yao", customerName: null }),
      entry({ id: "a" }),
    ];
    const sheet = swapSheet(swaps, { station: "Bè", from: "2026-11-02", to: "2026-11-02", labels, amount: String });
    expect(sheet.date).toBe("02/11/2026");
    expect(sheet.agents).toBe("Afi, Yao");
    expect(sheet.totalXof).toBe(1500);
    expect(sheet.rows).toEqual([
      ["1", "09:05", "30", "Koffi", "TG 1234 AB", "OV30-1", "20 %", "OV30-2", "100 %", "720", "TM2611 (T-Money)", "Afi"],
      ["2", "14:40", "45", "", "TG 1234 AB", "OV30-1", "35 %", "OV30-2", "100 %", "780", "FL77 (Flooz)", "Yao"],
    ]);
    const rows = swapSheetRows(sheet, labels, String);
    expect(rows[0]).toEqual(["ANNEXE - FICHE DE SWAP"]);
    expect(rows[1]).toEqual(["Station :", "Bè", "Date :", "02/11/2026", "Agent :", "Afi, Yao"]);
    expect(rows[3]).toHaveLength(12);
    expect(rows.find((r) => r.includes("MONTANT TOTAL"))).toEqual(["", "", "", "", "", "", "", "", "MONTANT TOTAL", "1500"]);
  });

  it("puts the day before the hour over several days, and leaves energy cells empty for other swaps", () => {
    const sheet = swapSheet([entry({ inPct: null, outPct: null, mmRef: null, mmNetwork: null, plate: null, payment: "cash", amountXof: 500 })], {
      station: "Bè",
      from: "2026-11-01",
      to: "2026-11-02",
      labels,
      amount: String,
    });
    expect(sheet.date).toBe("01/11/2026 – 02/11/2026");
    expect(sheet.rows[0]).toEqual(["1", "02/11 09:05", "30", "Koffi", "", "OV30-1", "", "OV30-2", "", "500", "", "Afi"]);
  });

  it("accepts a range of real days, first before last, at most 366 days", () => {
    expect(swapDayRange("2026-11-01", "2026-11-02")).toEqual({ since: "2026-11-01T00:00:00.000Z", until: "2026-11-03T00:00:00.000Z" });
    expect(swapDayRange("2026-11-02", "2026-11-01")).toBeNull();
    expect(swapDayRange("2026-02-30", "2026-03-01")).toBeNull();
    expect(swapDayRange("2025-01-01", "2026-01-02")).toBeNull();
    expect(swapDayRange("2025-01-01", "2026-01-01")).not.toBeNull();
    expect(swapDayRange(null, "2026-11-01")).toBeNull();
  });
});
