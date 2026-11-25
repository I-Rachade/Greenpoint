import { describe, expect, it } from "vitest";
import { hourly, isToday, latest, peak, type ActivityItem } from "../station-activity";

const now = new Date("2026-11-04T16:38:00Z");

describe("station activity", () => {
  it("counts operations per hour from 7 h (or earlier) to now", () => {
    const buckets = hourly(["2026-11-04T09:10:00Z", "2026-11-04T12:01:00Z", "2026-11-04T12:59:00Z"], now);
    expect(buckets[0]).toEqual({ hour: 7, n: 0 });
    expect(buckets.at(-1)).toEqual({ hour: 16, n: 0 });
    expect(buckets.find((b) => b.hour === 12)).toEqual({ hour: 12, n: 2 });
    expect(hourly(["2026-11-04T05:30:00Z"], now)[0]).toEqual({ hour: 5, n: 1 });
  });

  it("finds the busiest hour, none on a quiet day", () => {
    expect(peak([{ hour: 9, n: 2 }, { hour: 12, n: 5 }, { hour: 13, n: 5 }])).toEqual({ hour: 12, n: 5 });
    expect(peak([{ hour: 9, n: 0 }])).toBeNull();
  });

  it("knows today and keeps the newest operations", () => {
    expect(isToday("2026-11-04T00:01:00Z", now)).toBe(true);
    expect(isToday("2026-11-03T23:59:00Z", now)).toBe(false);
    expect(isToday(null, now)).toBe(false);
    const item = (id: string, at: string): ActivityItem => ({ id, kind: "swap", at, what: null, who: null, amountXof: null });
    expect(latest([item("a", "2026-11-04T09:00:00Z"), item("b", "2026-11-04T15:00:00Z"), item("c", "2026-11-04T12:00:00Z")], 2).map((i) => i.id)).toEqual(["b", "c"]);
  });
});
