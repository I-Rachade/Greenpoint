import { describe, expect, it } from "vitest";
import { DEMO_CODE, DemoBackend } from "../backend/demo";
import { cleanAmenities, cleanPhotos, cleanReview, hasRestArea, ratingOf, shortName, starCounts, stationPhotos } from "../station-extras";

describe("station extras", () => {
  it("keeps known amenities in a fixed order and safe photo URLs", () => {
    expect(cleanAmenities(["wifi", "seating", "wifi", "pool"])).toEqual(["seating", "wifi"]);
    expect(cleanAmenities("seating")).toEqual([]);
    expect(cleanPhotos(["https://x.test/a.jpg", "http://evil.test/a.jpg", "javascript:alert(1)", "/station-photos/hub.svg", "https://x.test/a.jpg"])).toEqual([
      "https://x.test/a.jpg",
      "/station-photos/hub.svg",
    ]);
    expect(cleanPhotos(Array.from({ length: 9 }, (_, i) => `https://x.test/${i}.jpg`))).toHaveLength(6);
  });

  it("checks reviews and shortens author names", () => {
    expect(cleanReview({ rating: 4, comment: "  Super  " })).toEqual({ rating: 4, comment: "Super" });
    expect(cleanReview({ rating: 0, comment: "" })).toBeNull();
    expect(cleanReview({ rating: 4.5, comment: "" })).toBeNull();
    expect(cleanReview({ rating: 5, comment: "x".repeat(501) })).toBeNull();
    expect(shortName("Kossi Mensah Agbeko")).toBe("Kossi A.");
    expect(shortName("Afi")).toBe("Afi");
    expect(shortName("  ")).toBeNull();
  });

  it("averages stars and spots rest areas", () => {
    expect(ratingOf([{ rating: 5 }, { rating: 4 }, { rating: 4 }])).toEqual({ average: 4.3, count: 3 });
    expect(ratingOf([])).toEqual({ average: 0, count: 0 });
    expect(starCounts([{ rating: 5 }, { rating: 1 }, { rating: 5 }])).toEqual([2, 0, 0, 0, 1]);
    expect(hasRestArea(["wifi", "parking"])).toBe(false);
    expect(hasRestArea(["wifi", "shade"])).toBe(true);
    expect(stationPhotos({ id: "x", kind: "swap", photos: [] })).toEqual(["/station-photos/swap.svg"]);
  });
});

describe("DemoBackend reviews", () => {
  it("rates a station once per customer and updates the average", async () => {
    const backend = new DemoBackend();
    const before = (await backend.listStations()).find((s) => s.id === "st-tokoin")!.rating!;
    await expect(backend.saveReview("st-tokoin", { rating: 5, comment: "" })).rejects.toMatchObject({ code: "not_authenticated" });
    await backend.register("+22890123456", DEMO_CODE, "2580", "customer");
    await backend.saveReview("st-tokoin", { rating: 1, comment: "Fermé à l'heure d'ouverture" });
    await backend.saveReview("st-tokoin", { rating: 2, comment: "Mieux" });
    const mine = (await backend.stationReviews("st-tokoin")).filter((r) => r.isMine);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ rating: 2, comment: "Mieux" });
    const after = (await backend.listStations()).find((s) => s.id === "st-tokoin")!.rating!;
    expect(after.count).toBe(before.count + 1);
    await backend.deleteReview(mine[0].id);
    expect((await backend.listStations()).find((s) => s.id === "st-tokoin")!.rating).toEqual(before);
  });
});
