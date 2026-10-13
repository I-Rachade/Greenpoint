import { describe, expect, it } from "vitest";
import {
  checkLimits,
  maskContact,
  newTrxId,
  parseAmount,
  parseReceivePayload,
  personLabel,
  quoteFee,
  receivePayload,
  remaining,
  validFeeSetting,
  type WalletFeeSetting,
} from "../wallet";

const SETTING: WalletFeeSetting = {
  product: "transfer",
  fixedXof: 50,
  percent: 1.5,
  minXof: 100,
  maxXof: 100_000,
  dailyXof: 150_000,
  monthlyXof: 0,
  isActive: true,
};

describe("quoteFee", () => {
  it("adds the fixed fee and the percentage, in whole francs, to what the sender pays", () => {
    expect(quoteFee(10_000, SETTING)).toEqual({ fixedXof: 50, percentXof: 150, feeXof: 200, payableXof: 10_200 });
    expect(quoteFee(333, SETTING).percentXof).toBe(5);
    expect(quoteFee(1_000, { fixedXof: 0, percent: 0 }).payableXof).toBe(1_000);
  });
});

describe("checkLimits", () => {
  it("checks the single amount and the running day and month totals; 0 means no limit", () => {
    const none = { todayXof: 0, monthXof: 0 };
    expect(checkLimits(99, SETTING, none)).toBe("amount_too_small");
    expect(checkLimits(100_001, SETTING, none)).toBe("amount_too_large");
    expect(checkLimits(60_000, SETTING, { todayXof: 100_000, monthXof: 100_000 })).toBe("daily_limit_exceeded");
    expect(checkLimits(50_000, SETTING, { todayXof: 100_000, monthXof: 10_000_000 })).toBeNull();
    expect(checkLimits(50_000, { ...SETTING, monthlyXof: 120_000 }, { todayXof: 0, monthXof: 100_000 })).toBe("monthly_limit_exceeded");
    expect(remaining(SETTING, { todayXof: 200_000, monthXof: 0 })).toEqual({ todayXof: 0, monthXof: null });
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

  it("rejects fee settings that make no sense", () => {
    expect(validFeeSetting(SETTING)).toEqual(SETTING);
    expect(validFeeSetting({ ...SETTING, percent: 80 })).toBeNull();
    expect(validFeeSetting({ ...SETTING, minXof: 200_000 })).toBeNull();
    expect(validFeeSetting({ ...SETTING, fixedXof: 10.5 })).toBeNull();
    expect(validFeeSetting({ ...SETTING, product: "other" as "transfer" })).toBeNull();
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

  it("reads back the contact from a receive QR code or typed text", () => {
    expect(parseReceivePayload(receivePayload("+22896123456"))).toBe("+22896123456");
    expect(parseReceivePayload(" ama@mail.tg ")).toBe("ama@mail.tg");
  });
});
