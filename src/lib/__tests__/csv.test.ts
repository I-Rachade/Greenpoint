import { describe, expect, it } from "vitest";
import { toCsv } from "../csv";

describe("toCsv", () => {
  it("splits by semicolons, quotes what needs it and defuses formulas", () => {
    expect(toCsv([["Date", "Prix"], ["16/10", 1500], ['a;b "c"', null], ["=SUM(A1)", "-5"]])).toBe(
      '﻿Date;Prix\r\n16/10;1500\r\n"a;b ""c""";\r\n\'=SUM(A1);\'-5\r\n',
    );
  });
});
