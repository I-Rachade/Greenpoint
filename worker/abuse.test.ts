import { afterEach, describe, expect, it } from "vitest";
import { handleApi } from "./api";
import { hashPin, signIn } from "./auth";
import type { Env } from "./env";
import { ApiError, sha256 } from "./http";
import {
  LOGIN_ALARM_FAILURES,
  LOGIN_CAPTCHA_AFTER,
  guardedSignIn,
  limitByIp,
  limitByUser,
  partnerAllowed,
  securityOverview,
  unlockAccount,
} from "./security";
import { fakeD1 } from "./test-d1";
import type { Profile } from "../shared/types";

// Protection against abuse (plan of 26.10.2026): robot check on the PIN login after failed tries,
// the security log, the warning on a lock, request limits and the back office page.

const PHONE = "+22890000001";
const TURNSTILE = { TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k" };
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

async function setup(extra: Partial<Env> = {}) {
  const { db, d1 } = fakeD1();
  const env = { DB: d1, ...extra } as unknown as Env;
  db.prepare("insert into users (id, phone, role, created_at, pin_hash) values ('ama', ?, 'rider', '2026-01-01T00:00:00.000Z', ?)").run(PHONE, await hashPin("4826"));
  return { db, env };
}

const loginFrom = (ip: string) => new Request("https://app.poinderecharge.com/api/auth/login", { method: "POST", headers: { "CF-Connecting-IP": ip } });
const code = (p: Promise<unknown>) => p.then(() => "ok", (err: unknown) => (err instanceof ApiError ? err.code : String(err)));
const turnstileSays = (success: boolean) => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ success }))) as typeof fetch;
};

describe("robot check on the PIN login", () => {
  it("asks for it after a few failed tries for one contact, known or not, and lets a good token through", async () => {
    const { env } = await setup(TURNSTILE);
    for (const contact of [PHONE, "+22890000099"]) {
      for (let i = 0; i < LOGIN_CAPTCHA_AFTER; i++) {
        expect(await code(guardedSignIn(env, loginFrom(`198.51.100.${i}`), contact, "1111", undefined))).toBe("invalid_pin");
      }
      // Same answer whether the account exists or not.
      expect(await code(guardedSignIn(env, loginFrom("198.51.100.200"), contact, "1111", undefined))).toBe("captcha_required");
    }
    turnstileSays(false);
    expect(await code(guardedSignIn(env, loginFrom("198.51.100.200"), PHONE, "4826", "bad"))).toBe("captcha_failed");
    turnstileSays(true);
    expect(await code(guardedSignIn(env, loginFrom("198.51.100.200"), PHONE, "4826", "good"))).toBe("ok");
  });

  it("asks for it after a few failed tries from one address, whatever the contact", async () => {
    const { env } = await setup(TURNSTILE);
    for (let i = 0; i < LOGIN_CAPTCHA_AFTER; i++) await code(guardedSignIn(env, loginFrom("203.0.113.9"), `+2289000010${i}`, "1111", undefined));
    expect(await code(guardedSignIn(env, loginFrom("203.0.113.9"), PHONE, "4826", undefined))).toBe("captcha_required");
    expect(await code(guardedSignIn(env, loginFrom("203.0.113.10"), PHONE, "4826", undefined))).toBe("ok");
  });

  it("asks everyone while the whole app sees many failed logins (alarm), for an hour", async () => {
    const { db, env } = await setup(TURNSTILE);
    const insert = db.prepare("insert into security_events (at, kind, subject) values (?, 'pin_failed', ?)");
    for (let i = 0; i < LOGIN_ALARM_FAILURES; i++) insert.run(new Date().toISOString(), `s${i}`);
    expect(await code(guardedSignIn(env, loginFrom("192.0.2.1"), PHONE, "4826", undefined))).toBe("captcha_required");
    expect(db.prepare("select count(*) as n from security_events where kind = 'alarm'").get()).toMatchObject({ n: 1 });
    // The failures age out of the window; the alarm still holds.
    db.prepare("update security_events set at = ? where kind = 'pin_failed'").run(new Date(Date.now() - 20 * 60_000).toISOString());
    expect(await code(guardedSignIn(env, loginFrom("192.0.2.1"), PHONE, "4826", undefined))).toBe("captcha_required");
    expect((await securityOverview(env)).alarm).toBe(true);
  });

  it("never asks while Turnstile is not set up", async () => {
    const { env } = await setup();
    for (let i = 0; i < 4; i++) await code(guardedSignIn(env, loginFrom("203.0.113.9"), PHONE, "1111", undefined));
    // Four wrong PINs: the fifth try is a normal answer, not captcha_required.
    expect(await code(guardedSignIn(env, loginFrom("203.0.113.9"), PHONE, "1111", undefined))).toBe("pin_locked");
  });

  it("logs failed logins with a masked contact and the account when there is one", async () => {
    const { db, env } = await setup();
    await code(guardedSignIn(env, loginFrom("203.0.113.9"), PHONE, "1111", undefined));
    await code(guardedSignIn(env, loginFrom("203.0.113.9"), "nobody@example.com", "1111", undefined));
    const rows = db.prepare("select user_id, ip, detail, subject from security_events where kind = 'pin_failed' order by id").all() as Record<string, string | null>[];
    expect(rows.map((r) => [r.user_id, r.ip, r.detail])).toEqual([
      ["ama", "203.0.113.9", "+22890****01"],
      [null, "203.0.113.9", "no***@example.com"],
    ]);
    expect(JSON.stringify(rows)).not.toContain(PHONE);
  });
});

describe("account lock", () => {
  it("logs the lock, tells how long it lasts, and the API sends Retry-After", async () => {
    const { db, env } = await setup();
    const login = new Request("https://app.poinderecharge.com/api/auth/login", { method: "POST" });
    let last: unknown;
    for (let i = 0; i < 5; i++) last = await signIn(env, login, PHONE, "1111").catch((err: unknown) => err);
    expect(last).toMatchObject({ code: "pin_locked", status: 429, retryAfter: 900 });
    expect(db.prepare("select kind, user_id from security_events where kind = 'pin_locked'").all()).toEqual([{ kind: "pin_locked", user_id: "ama" }]);
    const res = await handleApi(
      new Request("https://app.poinderecharge.com/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contact: PHONE, pin: "4826" }) }),
      env,
    );
    expect(res.status).toBe(429);
    const wait = Number(res.headers.get("Retry-After"));
    expect(wait).toBeGreaterThan(890);
    expect(wait).toBeLessThanOrEqual(900);
    expect(await res.json()).toEqual({ error: "pin_locked", retryAfter: wait });
  });

  it("lets an admin unlock an account from the back office page", async () => {
    const { db, env } = await setup();
    const login = new Request("https://app.poinderecharge.com/api/auth/login", { method: "POST" });
    for (let i = 0; i < 5; i++) await code(signIn(env, login, PHONE, "1111"));
    const overview = await securityOverview(env);
    expect(overview.locked.map((a) => [a.userId, a.phone, a.lockCount])).toEqual([["ama", PHONE, 1]]);
    expect(overview.last24h.pin_locked).toBe(1);
    expect(overview.captchaOn).toBe(false);
    await unlockAccount(env, { id: "boss" } as Profile, "ama");
    expect(await code(signIn(env, login, PHONE, "4826"))).toBe("ok");
    expect(db.prepare("select detail from security_events where kind = 'unlocked'").get()).toEqual({ detail: "boss" });
    expect(await code(unlockAccount(env, { id: "boss" } as Profile, "nobody"))).toBe("not_found");
  });

  it("keeps the back office page for admins", async () => {
    const { db, env } = await setup();
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, 'ama', ?, ?)").run(
      await sha256("token-of-ama-0123456789"),
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    const res = await handleApi(new Request("https://app.poinderecharge.com/api/admin/security", { headers: { Authorization: "Bearer token-of-ama-0123456789" } }), env);
    expect(res.status).toBe(403);
  });
});

describe("registration", () => {
  it("counts registrations towards the login limit of an address", async () => {
    const { env } = await setup();
    const post = () =>
      handleApi(
        new Request("https://app.poinderecharge.com/api/auth/register", {
          method: "POST",
          headers: { "Content-Type": "application/json", "CF-Connecting-IP": "203.0.113.50" },
          body: JSON.stringify({ contact: "+22890000077", code: "000000", pin: "4826" }),
        }),
        env,
      );
    const answers = [];
    for (let i = 0; i < 61; i++) answers.push(await post());
    expect(answers.slice(0, 60).every((r) => r.status !== 429)).toBe(true);
    const refused = answers[60];
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
  });
});

describe("request limits", () => {
  /** A rate limiting binding that allows `max` requests per key. */
  const binding = (max: number) => {
    const counts = new Map<string, number>();
    return {
      async limit({ key }: { key: string }) {
        counts.set(key, (counts.get(key) ?? 0) + 1);
        return { success: counts.get(key)! <= max };
      },
    } as RateLimit;
  };
  const req = (method = "GET", ip = "203.0.113.1") => new Request("https://app.poinderecharge.com/api/stations", { method, headers: { "CF-Connecting-IP": ip } });
  const customer = { id: "ama", role: "customer" } as Profile;
  const staff = { id: "afi", role: "operator" } as Profile;

  it("limits each address, and the API answers 429 with Retry-After", async () => {
    const { db, env } = await setup({ API_IP_LIMIT: binding(2) });
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await handleApi(req(), env));
    expect(answers.map((r) => r.status)).toEqual([200, 200, 429, 429]);
    expect(answers[2].headers.get("Retry-After")).toBe("60");
    expect((await handleApi(req("GET", "203.0.113.2"), env)).status).toBe(200);
    // One log row per address and minute, however many requests were refused.
    expect(db.prepare("select count(*) as n from security_events where kind = 'api_limited'").get()).toEqual({ n: 1 });
  });

  it("limits changes of customers, not of staff", async () => {
    const { env } = await setup({ API_USER_LIMIT: binding(100), API_STAFF_LIMIT: binding(100), API_WRITE_LIMIT: binding(2) });
    const tries = async (user: Profile, method: string) => {
      const out = [];
      for (let i = 0; i < 3; i++) out.push(await code(limitByUser(env, req(method), user)));
      return out;
    };
    expect(await tries(customer, "POST")).toEqual(["ok", "ok", "rate_limited"]);
    expect(await tries(customer, "GET")).toEqual(["ok", "ok", "ok"]);
    expect(await tries(staff, "POST")).toEqual(["ok", "ok", "ok"]);
  });

  it("limits all requests per account, staff higher", async () => {
    const { env } = await setup({ API_USER_LIMIT: binding(1), API_STAFF_LIMIT: binding(3) });
    expect([await code(limitByUser(env, req(), customer)), await code(limitByUser(env, req(), customer))]).toEqual(["ok", "rate_limited"]);
    const staffAnswers = [];
    for (let i = 0; i < 4; i++) staffAnswers.push(await code(limitByUser(env, req(), staff)));
    expect(staffAnswers).toEqual(["ok", "ok", "ok", "rate_limited"]);
  });

  it("lets everything through without bindings or when a binding fails", async () => {
    const { env } = await setup();
    await expect(limitByIp(env, req())).resolves.toBeUndefined();
    const broken = { async limit() { throw new Error("down"); } } as unknown as RateLimit;
    await expect(limitByIp({ ...env, API_IP_LIMIT: broken } as Env, req())).resolves.toBeUndefined();
  });

  it("limits each partner on the partner API", async () => {
    const { db, env } = await setup({ PARTNER_LIMIT: binding(1) });
    expect(await partnerAllowed(env, req(), "p1")).toBe(true);
    expect(await partnerAllowed(env, req(), "p1")).toBe(false);
    expect(await partnerAllowed(env, req(), "p2")).toBe(true);
    expect(db.prepare("select detail from security_events where kind = 'partner_limited'").all()).toEqual([{ detail: "p1" }]);
  });
});
