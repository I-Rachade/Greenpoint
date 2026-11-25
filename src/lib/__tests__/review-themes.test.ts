import { describe, expect, it } from "vitest";
import { reviewThemes } from "@shared/station-extras";

describe("reviewThemes", () => {
  it("counts each review once per theme, most mentioned first", () => {
    const themes = reviewThemes([
      { comment: "Échange rapide, batterie déjà prête." },
      { comment: "Très rapide et personnel aimable" },
      { comment: "Un peu d'attente vers 18 h" },
      { comment: "" },
    ]);
    expect(themes[0]).toEqual({ theme: "fast", n: 2 });
    expect(themes.map((t) => t.theme)).toContain("friendly");
    expect(themes).toHaveLength(3);
  });

  it("is empty without comments", () => {
    expect(reviewThemes([{ comment: "" }])).toEqual([]);
  });
});
