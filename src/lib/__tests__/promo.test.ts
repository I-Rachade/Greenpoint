import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { isRunning, localDay, pickPromotion, safeImage, safeLink, seenMarker, type Promotion } from "../promo";

const NOW = new Date("2026-10-12T12:00:00Z");

function promo(over: Partial<Promotion>): Promotion {
  return {
    id: "p",
    title: "Promo",
    body: "",
    imageUrl: null,
    linkUrl: null,
    linkLabel: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: "2026-10-01T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    ...over,
  };
}

describe("promotion rules", () => {
  it("runs only when switched on and within its period", () => {
    expect(isRunning(promo({}), NOW)).toBe(true);
    expect(isRunning(promo({ isActive: false }), NOW)).toBe(false);
    expect(isRunning(promo({ startsAt: "2026-10-13T00:00:00Z" }), NOW)).toBe(false);
    expect(isRunning(promo({ endsAt: "2026-10-12T12:00:00Z" }), NOW)).toBe(false);
    expect(isRunning(promo({ startsAt: "2026-10-12T00:00:00Z", endsAt: "2026-10-13T00:00:00Z" }), NOW)).toBe(true);
  });

  it("shows the running ad changed last, or none", () => {
    expect(pickPromotion([], NOW)).toBeNull();
    expect(pickPromotion([promo({ isActive: false })], NOW)).toBeNull();
    const older = promo({ id: "old", updatedAt: "2026-10-01T00:00:00Z" });
    const newer = promo({ id: "new", updatedAt: "2026-10-10T00:00:00Z" });
    const future = promo({ id: "future", startsAt: "2026-11-01T00:00:00Z", updatedAt: "2026-10-11T00:00:00Z" });
    expect(pickPromotion([older, future, newer], NOW)?.id).toBe("new");
  });

  it("comes back the next day or when the ad is edited", () => {
    const p = promo({});
    const today = seenMarker(p, NOW);
    expect(seenMarker(p, new Date(NOW.getTime() + 60_000))).toBe(today);
    expect(seenMarker(p, new Date(NOW.getTime() + 86_400_000))).not.toBe(today);
    expect(seenMarker({ ...p, updatedAt: "2026-10-12T11:00:00Z" }, NOW)).not.toBe(today);
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });

  it("only follows http(s) links and accepts inline images", () => {
    expect(safeLink("https://poinderecharge.com/offre")).toBe("https://poinderecharge.com/offre");
    expect(safeLink("javascript:alert(1)")).toBeNull();
    expect(safeLink("pas un lien")).toBeNull();
    expect(safeImage("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
    expect(safeImage("data:text/html;base64,AAAA")).toBeNull();
  });
});

describe("DemoBackend promotions", () => {
  let backend: DemoBackend;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    backend = new DemoBackend();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows nothing until an admin switches an ad on, and logs the change", async () => {
    expect(await backend.currentPromotion()).toBeNull();
    await expect(backend.listPromotions()).rejects.toMatchObject({ code: "not_authenticated" });

    await backend.register("+22890123456", DEMO_CODE, "2580", "rider");
    await expect(backend.listPromotions()).rejects.toMatchObject({ code: "forbidden" });

    await backend.register("+22890000001", DEMO_CODE, "2580", "admin");
    const [example] = await backend.listPromotions();
    await backend.savePromotion(example.id, { ...example, isActive: true });
    expect((await backend.currentPromotion())?.id).toBe(example.id);

    vi.setSystemTime(new Date(NOW.getTime() + 60_000));
    await backend.savePromotion(null, {
      title: "Nouvelle offre",
      body: "",
      imageUrl: null,
      linkUrl: "https://poinderecharge.com",
      linkLabel: null,
      isActive: true,
      startsAt: "2026-10-12T11:00:00Z",
      endsAt: null,
    });
    expect((await backend.currentPromotion())?.title).toBe("Nouvelle offre");

    const log = await backend.auditLog({ table: "promotions" });
    expect(log.map((e) => e.action)).toEqual(["insert", "update"]);
    expect(log[1].changes).toEqual({ is_active: [false, true] });

    await backend.deletePromotion(example.id);
    expect((await backend.listPromotions()).map((p) => p.title)).toEqual(["Nouvelle offre"]);
  });
});
