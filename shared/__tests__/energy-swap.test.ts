import { describe, expect, it } from "vitest";
import { checkEnergySwap, cleanMmRef, cleanPlate, cleanUssdTemplate, DEFAULT_USSD, energySwapAmount, ussdCode, type EnergyPricing } from "../energy-swap";

// Swaps priced by the energy given: the procedure's own examples and its controls.

describe("energySwapAmount", () => {
  it("gives the procedure's examples", () => {
    expect(energySwapAmount(20, 100, 900)).toEqual({ suppliedPct: 80, amountXof: 720 });
    expect(energySwapAmount(35, 100, 1200)).toEqual({ suppliedPct: 65, amountXof: 780 });
    expect(energySwapAmount(10, 90, 2600)).toEqual({ suppliedPct: 80, amountXof: 2080 });
  });

  it("rounds to the nearest 5 FCFA", () => {
    expect(energySwapAmount(50, 83, 1200)?.amountXof).toBe(395); // 396
    expect(energySwapAmount(0, 1, 900)?.amountXof).toBe(10); // 9
    expect(energySwapAmount(0, 3, 2600)?.amountXof).toBe(80); // 78
    expect(energySwapAmount(0, 1, 250)?.amountXof).toBe(5); // 2.5
  });

  it("refuses OUT at or below IN and charges outside 0…100", () => {
    expect(energySwapAmount(50, 50, 900)).toBeNull();
    expect(energySwapAmount(60, 40, 900)).toBeNull();
    expect(energySwapAmount(-1, 40, 900)).toBeNull();
    expect(energySwapAmount(10, 101, 900)).toBeNull();
    expect(energySwapAmount(10.5, 90, 900)).toBeNull();
    expect(energySwapAmount(null, 90, 900)).toBeNull();
  });
});

describe("USSD codes and typed fields", () => {
  it("fills the amount into the code", () => {
    expect(ussdCode(DEFAULT_USSD.tmoney, 720)).toBe("*145*5*720*1088722#");
    expect(ussdCode(DEFAULT_USSD.flooz, 2080)).toBe("*155*2*2*22879392818*22879392818*2080#");
  });

  it("takes only digits, * and # around {montant}", () => {
    expect(cleanUssdTemplate(" *145*5*{montant}*1088722# ")).toBe("*145*5*{montant}*1088722#");
    expect(cleanUssdTemplate("")).toBeNull();
    expect(cleanUssdTemplate("*145*5*1088722#")).toBeUndefined();
    expect(cleanUssdTemplate("*145*{montant}*abc#")).toBeUndefined();
  });

  it("cleans transaction ids and plates", () => {
    expect(cleanMmRef(" tm 2611 0212 ")).toBe("TM26110212");
    expect(cleanMmRef("abc")).toBeNull();
    expect(cleanMmRef("ref/123")).toBeNull();
    expect(cleanPlate("  tg   1234 ab ")).toBe("TG 1234 AB");
    expect(cleanPlate("x")).toBeNull();
  });
});

describe("checkEnergySwap", () => {
  const energy: EnergyPricing = { priceFullXof: 900, ussd: { tmoney: DEFAULT_USSD.tmoney } };
  const ok = { customerType: "cash", inPct: 20, outPct: 100, plate: "TG 1", batteryInCondition: "ok", batteryOutChecked: true, mmNetwork: "tmoney", mmRef: "TM1234" };

  it("returns the swap's amount and fields", () => {
    expect(checkEnergySwap(ok, energy)).toEqual({
      ok: true,
      swap: { inPct: 20, outPct: 100, amountXof: 720, plate: "TG 1", customerName: null, condition: "ok", mmNetwork: "tmoney", mmRef: "TM1234" },
    });
  });

  it("names the first thing missing", () => {
    const err = (extra: Record<string, unknown>) => {
      const r = checkEnergySwap({ ...ok, ...extra }, energy);
      return r.ok ? null : r.error;
    };
    expect(err({ customerType: "fleet" })).toBe("energy_customer_type");
    expect(err({ outPct: 10 })).toBe("energy_out_not_above_in");
    expect(err({ plate: "" })).toBe("plate_required");
    expect(err({ batteryInCondition: "wet" })).toBe("battery_condition_required");
    expect(err({ batteryOutChecked: undefined })).toBe("battery_out_check_required");
    // Flooz has no code here: not offered.
    expect(err({ mmNetwork: "flooz" })).toBe("mm_network_invalid");
    expect(err({ mmRef: "" })).toBe("mm_ref_required");
  });
});
