import { beforeEach, describe, expect, it } from "vitest";
import type { Profile } from "@shared/types";
import { checkOfflineAt, OFFLINE_QUEUE_MAX } from "@shared/station-work";
import { offlineSignIn, rememberOfflineLogin, forgetOfflineLogin, mayLoginOffline } from "../offline/offline-login";
import { enqueueSwap, flushQueue, queuedSwaps, QueueFullError } from "../offline/swap-queue";
import { keepAnswer, keptAnswer, setKeptUser } from "../offline/kept";

// The staff app without network (src/lib/offline/): login with the PIN kept as a fingerprint,
// up to 10 swaps kept on the phone, sent later in order and never lost on a network failure.

class MemoryStorage {
  private data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const staff: Profile = { id: "afi", phone: "+22890000004", email: null, fullName: "Afi", role: "operator" };
const DAY = 86_400_000;

beforeEach(() => {
  (globalThis as { localStorage?: unknown }).localStorage = new MemoryStorage();
});

describe("offline login", () => {
  it("lets staff who signed in on this phone in, without network, with the right PIN only", async () => {
    await rememberOfflineLogin("90 00 00 04", "2580", staff);
    const stored = (globalThis as unknown as { localStorage: MemoryStorage }).localStorage.getItem("poinderecharge-offline-logins") ?? "";
    expect(stored).not.toContain("2580");
    expect(await offlineSignIn("+22890000004", "2580")).toEqual({ ok: true, profile: staff });
    expect(await offlineSignIn("+22890000004", "1111")).toEqual({ ok: false, error: "wrong_pin" });
    expect(await offlineSignIn("+22890000099", "2580")).toEqual({ ok: false, error: "unknown_account" });
  });

  it("lasts 14 days after the last login with the server", async () => {
    const now = Date.now();
    await rememberOfflineLogin("+22890000004", "2580", staff, now - 13 * DAY);
    expect((await offlineSignIn("+22890000004", "2580", now)).ok).toBe(true);
    await rememberOfflineLogin("+22890000004", "2580", staff, now - 15 * DAY);
    expect(await offlineSignIn("+22890000004", "2580", now)).toEqual({ ok: false, error: "expired" });
  });

  it("locks after 5 wrong PINs for 15 minutes", async () => {
    const now = Date.now();
    await rememberOfflineLogin("+22890000004", "2580", staff, now);
    for (let i = 0; i < 4; i++) expect((await offlineSignIn("+22890000004", "0000", now)).ok).toBe(false);
    expect(await offlineSignIn("+22890000004", "0000", now)).toEqual({ ok: false, error: "locked" });
    expect(await offlineSignIn("+22890000004", "2580", now + 60_000)).toEqual({ ok: false, error: "locked" });
    expect((await offlineSignIn("+22890000004", "2580", now + 16 * 60_000)).ok).toBe(true);
  });

  it("is only for station staff and owners who act at stations", async () => {
    expect(mayLoginOffline(staff)).toBe(true);
    expect(mayLoginOffline({ ...staff, role: "customer" })).toBe(false);
    expect(mayLoginOffline({ ...staff, role: "admin" })).toBe(false);
    expect(mayLoginOffline({ ...staff, ownerReadOnly: true })).toBe(false);
    await rememberOfflineLogin("+22890000005", "2580", { ...staff, id: "ama", role: "customer" });
    expect((await offlineSignIn("+22890000005", "2580")).ok).toBe(false);
    await rememberOfflineLogin("+22890000004", "2580", staff);
    forgetOfflineLogin("afi");
    expect((await offlineSignIn("+22890000004", "2580")).ok).toBe(false);
  });
});

const item = (n: number, userId = "afi") => ({
  stationId: "be",
  stationName: "Bè",
  userId,
  person: "Afi",
  input: { requestId: `offline-req-${n}`, customerType: "cash" as const, offlineAt: new Date(Date.now() - n * 60_000).toISOString() },
});

const networkError = () => Object.assign(new Error("network"), { code: "unknown" });

describe("offline swap queue", () => {
  it("keeps at most 10 swaps, and the same swap once", () => {
    for (let i = 0; i < OFFLINE_QUEUE_MAX; i++) enqueueSwap(item(i));
    enqueueSwap(item(0));
    expect(queuedSwaps()).toHaveLength(OFFLINE_QUEUE_MAX);
    expect(() => enqueueSwap(item(99))).toThrow(QueueFullError);
  });

  it("sends the person's swaps in order, stops at a network failure and marks refusals", async () => {
    enqueueSwap(item(1));
    enqueueSwap(item(2));
    enqueueSwap(item(3, "kossi"));
    enqueueSwap(item(4));
    const sent: string[] = [];
    let calls = 0;
    const first = await flushQueue("afi", async (_station, input) => {
      calls += 1;
      if (calls === 2) throw Object.assign(new Error("battery_wrong_brand"), { code: "battery_wrong_brand" });
      if (calls === 3) throw networkError();
      sent.push(input.requestId);
    });
    expect(first).toEqual({ sent: 1, refused: 1, stopped: true });
    expect(sent).toEqual(["offline-req-1"]);
    expect(queuedSwaps().map((q) => [q.input.requestId, q.status, q.error ?? null])).toEqual([
      ["offline-req-2", "refused", "battery_wrong_brand"],
      ["offline-req-3", "pending", null],
      ["offline-req-4", "pending", null],
    ]);
    // Network back: the rest goes; another person's swap waits for them.
    const second = await flushQueue("afi", async () => undefined);
    expect(second).toEqual({ sent: 1, refused: 0, stopped: false });
    expect(queuedSwaps().map((q) => q.input.requestId)).toEqual(["offline-req-2", "offline-req-3"]);
  });

  it("keeps the swaps while the session is over", async () => {
    enqueueSwap(item(1));
    const result = await flushQueue("afi", async () => {
      throw Object.assign(new Error("not_authenticated"), { code: "not_authenticated" });
    });
    expect(result.stopped).toBe(true);
    expect(queuedSwaps()[0].status).toBe("pending");
  });
});

describe("kept answers", () => {
  it("belong to the account that read them", () => {
    setKeptUser("afi");
    keepAnswer("/api/staff/stations", [{ id: "be" }]);
    expect(keptAnswer("/api/staff/stations")).toEqual([{ id: "be" }]);
    setKeptUser("kossi");
    expect(keptAnswer("/api/staff/stations")).toBeUndefined();
  });
});

describe("checkOfflineAt", () => {
  it("takes a time of the last 14 days, a little ahead for phone clocks", () => {
    const now = Date.parse("2026-11-10T12:00:00.000Z");
    expect(checkOfflineAt("2026-11-10T11:00:00.000Z", now)).toEqual({ ok: true, at: "2026-11-10T11:00:00.000Z" });
    expect(checkOfflineAt("2026-11-10T12:05:00.000Z", now)).toEqual({ ok: true, at: "2026-11-10T12:00:00.000Z" });
    expect(checkOfflineAt("2026-11-10T13:00:00.000Z", now)).toEqual({ ok: false, error: "offline_in_future" });
    expect(checkOfflineAt("2026-10-20T12:00:00.000Z", now)).toEqual({ ok: false, error: "offline_too_old" });
    expect(checkOfflineAt("yesterday", now)).toEqual({ ok: false, error: "bad_request" });
  });
});
