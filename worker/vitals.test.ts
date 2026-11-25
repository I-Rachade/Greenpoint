import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanVitals } from "../shared/vitals";
import type { Env } from "./env";
import { fakeD1 } from "./test-d1";
import { pruneVitals, receiveVitals } from "./vitals";

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

  it("keeps one row and logs one line per report, and always answers 204", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const { db, d1 } = fakeD1();
    const env = { DB: d1 } as unknown as Env;
    const post = (body: string) => receiveVitals(new Request("https://x/api/vitals", { method: "POST", body }), env);
    const ok = await post(JSON.stringify({ page: "/", platform: "android", metrics: { FCP: 900, LCP: 2100 } }));
    const bad = await post("{");
    expect([ok.status, bad.status]).toEqual([204, 204]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0] as string).vitals).toMatchObject({ page: "/", platform: "android", metrics: { FCP: 900 } });
    expect(db.prepare("select page, platform, fcp, lcp, inp from web_vitals").all()).toEqual([{ page: "/", platform: "android", fcp: 900, lcp: 2100, inp: null }]);
  });

  it("forgets measures after 30 days", async () => {
    const { db, d1 } = fakeD1();
    db.exec("insert into web_vitals (at, page, platform) values ('2020-01-01T00:00:00.000Z', '/', 'web'), ('2999-01-01T00:00:00.000Z', '/', 'web')");
    await pruneVitals(d1 as unknown as D1Database);
    expect(db.prepare("select at from web_vitals").all()).toHaveLength(1);
  });
});
