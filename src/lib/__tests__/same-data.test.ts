import { describe, expect, it } from "vitest";
import { sameData } from "../same-data";

describe("sameData", () => {
  it("compares answers deeply", () => {
    expect(sameData({ a: [1, { b: "x" }], c: null }, { a: [1, { b: "x" }], c: null })).toBe(true);
    expect(sameData({ a: [1, 2] }, { a: [1, 3] })).toBe(false);
    expect(sameData({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(sameData([1], { 0: 1 })).toBe(false);
  });

  it("counts anything that is not plain data as changed", () => {
    expect(sameData(new Map([["a", 1]]), new Map([["a", 1]]))).toBe(false);
    expect(sameData(new Date(0), new Date(0))).toBe(false);
  });
});
