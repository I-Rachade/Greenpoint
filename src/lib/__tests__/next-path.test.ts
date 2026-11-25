import { describe, expect, it } from "vitest";
import { loginHref, safeNextPath } from "../next-path";

describe("safeNextPath", () => {
  it("keeps paths inside the app", () => {
    expect(safeNextPath("/station?id=abc")).toBe("/station?id=abc");
    expect(safeNextPath("/reservations")).toBe("/reservations");
  });

  it("refuses other sites and odd values", () => {
    for (const bad of [null, "", "station", "https://evil.example", "//evil.example", "/\\evil.example", "/\t/evil.example"]) {
      expect(safeNextPath(bad)).toBeNull();
    }
  });
});

describe("loginHref", () => {
  it("adds the way back", () => {
    expect(loginHref("/station?id=a b")).toBe("/login?next=%2Fstation%3Fid%3Da%20b");
    expect(loginHref("/")).toBe("/login");
  });
});
