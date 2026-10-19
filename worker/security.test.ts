import { describe, expect, it } from "vitest";
import { handleApi } from "./api";
import { checkCode, hashPin, signIn, verifyPin } from "./auth";
import { COUNTER_CODE_MAX_TRIES, withCounterCodeTry } from "./code-tries";
import type { Env } from "./env";
import { ApiError, sha256 } from "./http";
import { IP_LIMITS } from "./ip-limits";
import { checkPickupCode } from "./reservations";
import { refuseWhileCreditCharging, spendCreditCode } from "./wallet";
import { fakeD1 } from "./test-d1";

// Security review 2026-10-19: limits that must hold with parallel requests too.

const PHONE = "+22890000001";

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  db.prepare("insert into users (id, phone, role, created_at, pin_hash) values ('ama', ?, 'rider', '2026-01-01T00:00:00.000Z', ?)").run(PHONE, await hashPin("4826"));
  return { db, d1: d1 as unknown as D1Database, env };
}

const code = (p: Promise<unknown>) => p.then(() => "ok", (err: unknown) => (err instanceof ApiError ? err.code : String(err)));

describe("PIN lock", () => {
  it("counts parallel wrong PINs one by one, so a burst cannot try more than the limit", async () => {
    const { env } = await setup();
    const guesses = Array.from({ length: 40 }, (_, i) => String(1000 + i));
    const answers = await Promise.all(guesses.map((pin) => code(signIn(env, PHONE, pin))));
    expect(answers.filter((a) => a === "invalid_pin").length).toBe(4);
    expect(answers.filter((a) => a === "pin_locked").length).toBe(36);
    // Locked: even the right PIN is refused now.
    expect(await code(signIn(env, PHONE, "4826"))).toBe("pin_locked");
  });

  it("locks longer each time and forgets the locks after the right PIN", async () => {
    const { db, env } = await setup();
    for (let i = 0; i < 5; i++) await code(signIn(env, PHONE, "1111"));
    const first = db.prepare("select pin_locked_until, pin_lock_count from users where id = 'ama'").get() as { pin_locked_until: string; pin_lock_count: number };
    expect(first.pin_lock_count).toBe(1);
    // The lock ran out: five more wrong PINs lock for twice as long.
    db.prepare("update users set pin_locked_until = '2000-01-01T00:00:00.000Z' where id = 'ama'").run();
    for (let i = 0; i < 5; i++) await code(signIn(env, PHONE, "1111"));
    const second = db.prepare("select pin_locked_until, pin_lock_count from users where id = 'ama'").get() as { pin_locked_until: string; pin_lock_count: number };
    expect(second.pin_lock_count).toBe(2);
    const minutes = (Date.parse(second.pin_locked_until) - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30);
    db.prepare("update users set pin_locked_until = null where id = 'ama'").run();
    expect(await code(signIn(env, PHONE, "4826"))).toBe("ok");
    expect(db.prepare("select pin_failures, pin_lock_count from users where id = 'ama'").get()).toMatchObject({ pin_failures: 0, pin_lock_count: 0 });
  });

  it("counts wrong payment PINs towards the same lock", async () => {
    const { env } = await setup();
    const answers = await Promise.all(Array.from({ length: 10 }, () => code(verifyPin(env, "ama", "1111"))));
    expect(answers.filter((a) => a === "invalid_pin").length).toBe(4);
    expect(await code(verifyPin(env, "ama", "4826"))).toBe("pin_locked");
  });
});

describe("one-time codes", () => {
  it("allows only five tries per login code, also in parallel", async () => {
    const { db, env } = await setup();
    const now = Date.now();
    db.prepare("insert into otp_codes (phone, code_hash, created_at, expires_at) values (?, ?, ?, ?)").run(
      PHONE,
      await sha256(`${PHONE}:654321`),
      new Date(now).toISOString(),
      new Date(now + 600_000).toISOString(),
    );
    await Promise.all(Array.from({ length: 30 }, (_, i) => code(checkCode(env, PHONE, String(100000 + i)))));
    expect(db.prepare("select attempts from otp_codes").get()).toMatchObject({ attempts: 5 });
    // The right code no longer works: its tries are used up.
    expect(await code(checkCode(env, PHONE, "654321"))).toBe("invalid_code");
  });

  it("lets only the request that used a counter code book with it, even at the same moment", async () => {
    const { db, d1 } = await setup();
    const at = new Date().toISOString();
    db.prepare("insert into credit_codes (code_hash, user_id, created_at, expires_at) values ('h1', 'ama', ?, ?)").run(at, new Date(Date.now() + 300_000).toISOString());
    const one = spendCreditCode(d1, "h1", "st", "topup", at);
    const two = spendCreditCode(d1, "h1", "st", "topup", at);
    await one.statement.run();
    await two.statement.run();
    const holds = (sql: string) => (db.prepare(`select ${sql} as ok`).get() as { ok: number }).ok;
    expect(holds(one.usedSql)).toBe(1);
    expect(holds(two.usedSql)).toBe(0);
  });

  it("stops a staff member after too many wrong counter codes, also in parallel", async () => {
    const { d1 } = await setup();
    const wrong = () => Promise.reject(new ApiError("invalid_code"));
    const answers = await Promise.all(Array.from({ length: 25 }, () => code(withCounterCodeTry(d1, "afi", "greenpoint", wrong))));
    expect(answers.filter((a) => a === "invalid_code").length).toBe(COUNTER_CODE_MAX_TRIES);
    expect(answers.filter((a) => a === "code_locked").length).toBe(25 - COUNTER_CODE_MAX_TRIES);
    // Another staff member is not stopped; right codes do not count.
    for (let i = 0; i < 20; i++) expect(await code(withCounterCodeTry(d1, "kofi", "credit", async () => "fine"))).toBe("ok");
  });

  it("locks a reservation's pickup code after five wrong tries, also in parallel", async () => {
    const { d1 } = await setup();
    const r = { id: "r1", station_id: "st", pickup_code: "1234" };
    const answers = await Promise.all(Array.from({ length: 20 }, (_, i) => code(checkPickupCode(d1, r, String(5000 + i)))));
    expect(answers.filter((a) => a === "wrong_pickup_code").length).toBe(5);
    expect(await code(checkPickupCode(d1, r, "1234"))).toBe("code_locked");
  });
});

describe("Green Credit charge in progress", () => {
  it("keeps the credit for the running charge: no other payment may spend it", async () => {
    const { db, d1 } = await setup();
    db.exec("pragma foreign_keys = off");
    const insert = (status: string, limit: number | null) =>
      db
        .prepare(
          `insert into charging_sessions (id, station_id, device_id, outlet, point_label, user_id, status, kwh_xof, min_xof, started_by, started_at, credit_limit_xof)
           values (?, 'st', 'dev', 1, 'P1', 'ama', ?, 150, 100, 'ama', '2026-10-19T00:00:00.000Z', ?)`,
        )
        .run(`${status}-${limit}`, status, limit);
    insert("paid", 5000);
    insert("stopped", null); // a charge staff started, paid at the counter or in the app
    expect(await code(refuseWhileCreditCharging(d1, "ama"))).toBe("ok");
    insert("charging", 5000);
    expect(await code(refuseWhileCreditCharging(d1, "ama"))).toBe("charge_unpaid");
  });
});

describe("login limits per IP address (point 9)", () => {
  const post = (env: Env, path: string, body: unknown, ip = "203.0.113.7") =>
    handleApi(new Request(`https://app.poinderecharge.com${path}`, { method: "POST", headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip }, body: JSON.stringify(body) }), env).then(
      async (res) => ({ status: res.status, body: (await res.json()) as { error?: string } }),
    );

  it("stops one address after too many PIN logins, also in parallel, and not the others", async () => {
    const { env } = await setup();
    const answers = await Promise.all(Array.from({ length: IP_LIMITS.login.max + 15 }, () => post(env, "/api/auth/login", { contact: "+22890000099", pin: "1111" })));
    expect(answers.filter((a) => a.body.error === "rate_limited").length).toBe(15);
    expect((await post(env, "/api/auth/login", { contact: PHONE, pin: "4826" }, "198.51.100.1")).status).toBe(200);
  });

  it("stops one address after too many code requests", async () => {
    const { env } = await setup();
    const testOtp = Array.from({ length: 12 }, (_, i) => `+228910000${String(i).padStart(2, "0")}=123456`).join(",");
    const withCodes = { ...env, TEST_OTP: testOtp } as Env;
    const answers = [];
    for (let i = 0; i < 12; i++) answers.push(await post(withCodes, "/api/auth/send", { contact: `+228910000${String(i).padStart(2, "0")}` }));
    expect(answers.slice(0, IP_LIMITS.send.max).every((a) => a.status === 200)).toBe(true);
    expect(answers.slice(IP_LIMITS.send.max).map((a) => a.body.error)).toEqual(["rate_limited", "rate_limited"]);
  });

  it("asks for a Turnstile token only once Turnstile is set up", async () => {
    const { env } = await setup();
    const on = { ...env, TURNSTILE_SECRET: "s", TURNSTILE_SITE_KEY: "k", TEST_OTP: "+22891000001=123456" } as Env;
    const get = (e: Env) => handleApi(new Request("https://app.poinderecharge.com/api/auth/captcha"), e).then((r) => r.json());
    expect(await get(env)).toEqual({ siteKey: null });
    expect(await get(on)).toEqual({ siteKey: "k" });
    expect((await post(on, "/api/auth/send", { contact: "+22891000001" })).body.error).toBe("captcha_failed");
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ success: false }))) as typeof fetch;
    try {
      expect((await post(on, "/api/auth/send", { contact: "+22891000001", captcha: "bad" })).body.error).toBe("captcha_failed");
      globalThis.fetch = (async () => new Response(JSON.stringify({ success: true }))) as typeof fetch;
      expect((await post(on, "/api/auth/send", { contact: "+22891000001", captcha: "good" })).status).toBe(200);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
