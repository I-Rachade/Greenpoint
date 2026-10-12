import { describe, expect, it } from "vitest";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { validPinFormat, weakPin } from "../pin";

describe("PIN rules", () => {
  it("needs exactly four digits", () => {
    expect(validPinFormat("2580")).toBe(true);
    expect(validPinFormat("258")).toBe(false);
    expect(validPinFormat("25801")).toBe(false);
    expect(validPinFormat("25a0")).toBe(false);
  });

  it("rejects PINs that are easy to guess", () => {
    for (const pin of ["0000", "7777", "1234", "4321", "6789"]) expect(weakPin(pin)).toBe(true);
    for (const pin of ["2580", "1243", "9081"]) expect(weakPin(pin)).toBe(false);
  });
});

describe("DemoBackend PIN login", () => {
  const phone = "+22890123456";

  it("registers with the SMS code, then logs in with the PIN only", async () => {
    const backend = new DemoBackend();
    await expect(backend.signIn(phone, "2580")).rejects.toMatchObject({ code: "invalid_pin" });
    await expect(backend.register(phone, DEMO_CODE, "1234")).rejects.toMatchObject({ code: "weak_pin" });
    await expect(backend.register(phone, "000000", "2580")).rejects.toMatchObject({ code: "invalid_code" });
    await backend.register(phone, DEMO_CODE, "2580");
    await backend.signOut();
    expect(await backend.getProfile()).toBeNull();
    await expect(backend.signIn(phone, "1111")).rejects.toMatchObject({ code: "invalid_pin" });
    const profile = await backend.signIn(phone, "2580");
    expect(profile.phone).toBe(phone);
  });

  it("sets a new PIN through the SMS code when the old one is forgotten", async () => {
    const backend = new DemoBackend();
    await backend.register(phone, DEMO_CODE, "2580");
    await backend.register(phone, DEMO_CODE, "9081");
    await backend.signOut();
    await expect(backend.signIn(phone, "2580")).rejects.toMatchObject({ code: "invalid_pin" });
    await backend.signIn(phone, "9081");
  });
});

describe("DemoBackend e-mail login", () => {
  const email = "awa@exemple.tg";

  it("registers with an e-mail address and adds a phone number later", async () => {
    const backend = new DemoBackend();
    const profile = await backend.register(email, DEMO_CODE, "2580");
    expect(profile).toMatchObject({ email, phone: null });
    const updated = await backend.addContact("+22890123456", DEMO_CODE);
    expect(updated).toMatchObject({ email, phone: "+22890123456" });
    await backend.signOut();
    // The same PIN works with either one.
    await backend.signIn(email, "2580");
    await backend.signOut();
    await backend.signIn("+22890123456", "2580");
  });
});
