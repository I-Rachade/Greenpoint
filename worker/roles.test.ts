import { describe, expect, it } from "vitest";
import { roleFromDb, roleToDb } from "./roles";

describe("stored roles", () => {
  it("keeps the customer stored as 'rider' and passes the other roles through", () => {
    expect(roleToDb("customer")).toBe("rider");
    expect(roleFromDb("rider")).toBe("customer");
    for (const role of ["operator", "fleet_manager", "admin", "driver"] as const) {
      expect(roleToDb(role)).toBe(role);
      expect(roleFromDb(role)).toBe(role);
    }
  });
});
