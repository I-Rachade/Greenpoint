import { describe, expect, it } from "vitest";
import { distanceMeters, formatDistance } from "../geo";
import { en } from "../i18n/en";
import { format } from "../i18n/format";
import { fr } from "../i18n/fr";
import { normalizeTogoPhone } from "../phone";

describe("geo", () => {
  it("measures distances across Lomé", () => {
    // Grand Marché to Université de Lomé: roughly 5.4 km.
    const d = distanceMeters({ lat: 6.1262, lng: 1.2236 }, { lat: 6.1735, lng: 1.2115 });
    expect(d).toBeGreaterThan(5000);
    expect(d).toBeLessThan(5800);
  });

  it("formats metres and kilometres", () => {
    expect(formatDistance(234)).toBe("230 m");
    expect(formatDistance(5432)).toBe("5,4 km");
  });
});

describe("normalizeTogoPhone", () => {
  it.each([
    ["90 12 34 56", "+22890123456"],
    ["90123456", "+22890123456"],
    ["+228 90 12 34 56", "+22890123456"],
    ["0022890123456", "+22890123456"],
    ["22890123456", "+22890123456"],
    ["+4915112345678", "+4915112345678"],
  ])("accepts %s", (input, expected) => {
    expect(normalizeTogoPhone(input)).toBe(expected);
  });

  it.each(["", "1234", "9012345678", "abc"])("rejects %s", (input) => {
    expect(normalizeTogoPhone(input)).toBeNull();
  });
});

describe("i18n", () => {
  function keys(obj: object, prefix = ""): string[] {
    return Object.entries(obj).flatMap(([k, v]) =>
      typeof v === "object" ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`],
    );
  }

  it("has the same keys in French and English", () => {
    expect(keys(en).sort()).toEqual(keys(fr).sort());
  });

  it("fills placeholders", () => {
    expect(format(fr.time.minutesAgo, { n: 5 })).toBe("il y a 5 min");
    expect(format("{a} {b}", { a: 1 })).toBe("1 {b}");
  });
});
