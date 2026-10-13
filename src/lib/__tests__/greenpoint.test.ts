import { describe, expect, it } from "vitest";
import { DEFAULT_FACTORS, levelFor, nextLevel, parseFactors, pointsFor, treesFor, validRewardInput } from "../greenpoint";

describe("greenpoint rules", () => {
  it("turns grams into points, levels and trees", () => {
    expect(pointsFor(1999)).toBe(19);
    expect(levelFor(0)).toBe("pousse");
    expect(levelFor(50_000)).toBe("arbuste");
    expect(levelFor(1_000_000)).toBe("foret");
    expect(nextLevel(60_000)).toEqual({ level: "arbre", fromGrams: 250_000 });
    expect(nextLevel(2_000_000)).toBeNull();
    expect(treesFor(30_000)).toBe(1.5);
  });

  it("falls back to the default factors when stored ones are broken", () => {
    expect(parseFactors("{")).toEqual(DEFAULT_FACTORS);
    expect(parseFactors(JSON.stringify({ ...DEFAULT_FACTORS, kwhGrams: -1 }))).toEqual(DEFAULT_FACTORS);
  });

  it("needs a partner name for partner rewards", () => {
    const base = { title: "Jus", description: "", costPoints: 20, provider: "partner", partnerName: "", stock: null, validUntil: null, isActive: true };
    expect(validRewardInput(base)).toBeNull();
    expect(validRewardInput({ ...base, partnerName: "Café" })?.partnerName).toBe("Café");
    expect(validRewardInput({ ...base, provider: "network" })?.partnerName).toBeNull();
  });
});
