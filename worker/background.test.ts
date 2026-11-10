import { describe, expect, it } from "vitest";
import { afterResponse, withBackground } from "./background";

describe("afterResponse", () => {
  it("waits for the work outside a request", async () => {
    let done = false;
    await afterResponse("test", async () => {
      done = true;
    });
    expect(done).toBe(true);
  });

  it("hands the work to waitUntil inside a request, and never throws", async () => {
    const later: Promise<unknown>[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await withBackground(
      (p) => later.push(p),
      () => afterResponse("test", () => gate.then(() => Promise.reject(new Error("mail down")))),
    );
    expect(later).toHaveLength(1);
    release();
    await expect(later[0]).resolves.toBeUndefined();
  });
});
