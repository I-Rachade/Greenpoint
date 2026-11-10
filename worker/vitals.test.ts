import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanVitals } from "../shared/vitals";
import { receiveVitals } from "./vitals";

afterEach(() => vi.restoreAllMocks());

describe("vitals", () => {
  it("keeps the known measures and trims the rest", () => {
    expect(
      cleanVitals({ page: "/station?id=x", platform: "android", net: "3g", memory: 2, version: "2.0.0", metrics: { LCP: 2500.123456, CLS: 0.05, FOO: 1, INP: -1 }, user: "x" }),
    ).toEqual({ page: "/station", platform: "android", net: "3g", memory: 2, version: "2.0.0", metrics: { LCP: 2500.123, CLS: 0.05 } });
    expect(cleanVitals({ page: "/", metrics: {} })).toBeNull();
    expect(cleanVitals({ page: "http://x", metrics: { LCP: 1 } })).toBeNull();
    expect(cleanVitals("nope")).toBeNull();
  });

  it("logs one line per report and always answers 204", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const ok = await receiveVitals(new Request("https://x/api/vitals", { method: "POST", body: JSON.stringify({ page: "/", metrics: { FCP: 900 } }) }));
    const bad = await receiveVitals(new Request("https://x/api/vitals", { method: "POST", body: "{" }));
    expect([ok.status, bad.status]).toEqual([204, 204]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string).vitals).toMatchObject({ page: "/", platform: "web", metrics: { FCP: 900 } });
  });
});
