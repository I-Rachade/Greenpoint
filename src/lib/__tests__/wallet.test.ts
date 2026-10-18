import { describe, expect, it } from "vitest";
import { creditCodePayload, formatCreditCode, maskContact, maxTopup, newTrxId, parseAmount, parseCreditCode, personLabel } from "../wallet";

describe("counter codes", () => {
  it("reads the 8 digits from a scanned or typed code", () => {
    expect(parseCreditCode(creditCodePayload("12345678"))).toBe("12345678");
    expect(parseCreditCode("gc-1234 5678")).toBe("12345678");
    expect(parseCreditCode(" 1234-5678 ")).toBe("12345678");
    expect(parseCreditCode("1234567")).toBeNull();
    expect(parseCreditCode("+22890123456")).toBeNull();
    expect(parseCreditCode(null)).toBeNull();
    expect(formatCreditCode("12345678")).toBe("1234 5678");
  });

  it("caps a counter load at the balance limit; 0 means no limit", () => {
    expect(maxTopup(10_000, 50_000)).toBe(40_000);
    expect(maxTopup(60_000, 50_000)).toBe(0);
    expect(maxTopup(10_000, 0)).toBeNull();
  });
});

describe("amounts and settings", () => {
  it("accepts only positive whole francs", () => {
    expect(parseAmount("25 000")).toBe(25_000);
    expect(parseAmount(1500)).toBe(1500);
    expect(parseAmount("12,5")).toBeNull();
    expect(parseAmount(0)).toBeNull();
    expect(parseAmount(-5)).toBeNull();
    expect(parseAmount(1e12)).toBeNull();
  });
});

describe("transaction numbers and labels", () => {
  it("builds numbers from the type prefix and 8 digits 1-9", () => {
    expect(newTrxId("transfer")).toMatch(/^SM[1-9]{8}$/);
    expect(newTrxId("admin_adjust", () => 0)).toBe("AB11111111");
  });

  it("shows the other side a short name or a masked contact", () => {
    expect(personLabel({ fullName: "Kofi Mensah", phone: "+22896123456", email: null })).toBe("Kofi M.");
    expect(personLabel({ fullName: "Ama", phone: null, email: "ama@mail.tg" })).toBe("Ama");
    expect(personLabel({ fullName: null, phone: "+22896123456", email: null })).toBe("+228 96 •• •• 56");
    expect(maskContact("kofi@mail.tg")).toBe("ko••@mail.tg");
  });
});
