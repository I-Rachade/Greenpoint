import { afterEach, describe, expect, it, vi } from "vitest";
import { dropHot, hot } from "./hot-cache";

/** A Cache API stand-in: keeps responses by URL. */
function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (req: Request) => store.get(req.url)?.clone(),
    put: async (req: Request, res: Response) => void store.set(req.url, res.clone()),
    delete: async (req: Request) => store.delete(req.url),
  };
  vi.stubGlobal("caches", { default: cache });
}

afterEach(() => vi.unstubAllGlobals());

describe("hot cache", () => {
  it("loads once, then serves the copy until a change drops it", async () => {
    fakeCaches();
    const load = vi.fn(async () => [{ id: "s1" }]);
    expect(await hot("stations", load)).toEqual([{ id: "s1" }]);
    expect(await hot("stations", load)).toEqual([{ id: "s1" }]);
    expect(load).toHaveBeenCalledTimes(1);
    await dropHot();
    await hot("stations", load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("loads every time where there is no cache (tests, local tools)", async () => {
    const load = vi.fn(async () => 1);
    await hot("stations", load);
    await hot("stations", load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});
