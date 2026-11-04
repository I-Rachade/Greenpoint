import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ACCESS_HEADER, accessConfig, adminAllowed, resetAccessKeyCache, verifyAccessJwt, type AccessConfig } from "./access";
import gateway, { type AdminEnv } from "./admin-gateway";
import { currentUser, hashPin, signIn } from "./auth";
import type { Env } from "./env";
import { ApiError, sha256 } from "./http";
import { fakeD1 } from "./test-d1";

// The back office behind Cloudflare Access (docs/BACKOFFICE.md): tokens are checked by us, not trusted.

const TEAM = "https://greenpoint-test.cloudflareaccess.com";
const AUD = "aud-backoffice-test";
const CFG: AccessConfig = { teamDomain: TEAM, aud: AUD };
const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

let key: CryptoKeyPair;
let otherKey: CryptoKeyPair;
let jwk: JsonWebKey;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const part = (value: unknown) => b64url(new TextEncoder().encode(JSON.stringify(value)));

async function token(
  claims: Record<string, unknown> = {},
  header: Record<string, unknown> = {},
  signer: CryptoKey = key.privateKey,
): Promise<string> {
  const seconds = Math.floor(NOW / 1000);
  const head = part({ alg: "RS256", kid: "k1", typ: "JWT", ...header });
  const body = part({ aud: [AUD], iss: TEAM, sub: "user-1", email: "chef@example.com", iat: seconds, nbf: seconds, exp: seconds + 3600, ...claims });
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", signer, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(new Uint8Array(signature))}`;
}

function certs() {
  const fetcher = vi.fn(async (url: string | URL | Request) => {
    expect(String(url)).toBe(`${TEAM}/cdn-cgi/access/certs`);
    return Response.json({ keys: [{ ...jwk, kid: "k1", alg: "RS256" }] });
  });
  return fetcher as unknown as typeof fetch & typeof fetcher;
}

beforeAll(async () => {
  const params = { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" };
  key = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  otherKey = (await crypto.subtle.generateKey(params, true, ["sign", "verify"])) as CryptoKeyPair;
  jwk = await crypto.subtle.exportKey("jwk", key.publicKey);
});

beforeEach(() => resetAccessKeyCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Access settings", () => {
  it("needs both values and accepts the team domain with or without https://", () => {
    expect(accessConfig({})).toBeNull();
    expect(accessConfig({ ACCESS_TEAM_DOMAIN: TEAM })).toBeNull();
    expect(accessConfig({ ACCESS_AUD: AUD })).toBeNull();
    expect(accessConfig({ ACCESS_TEAM_DOMAIN: "greenpoint-test.cloudflareaccess.com/", ACCESS_AUD: ` ${AUD} ` })).toEqual(CFG);
    expect(accessConfig({ ACCESS_TEAM_DOMAIN: `${TEAM}/`, ACCESS_AUD: AUD })).toEqual(CFG);
  });
});

describe("Access token check", () => {
  it("accepts a token signed by the team for our application", async () => {
    expect(await verifyAccessJwt(await token(), CFG, certs(), NOW)).toEqual({ email: "chef@example.com", sub: "user-1" });
    expect(await verifyAccessJwt(await token({ aud: AUD }), CFG, certs(), NOW)).not.toBeNull();
  });

  it("refuses another application, another team, and tokens out of their time", async () => {
    const seconds = NOW / 1000;
    expect(await verifyAccessJwt(await token({ aud: ["other-app"] }), CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(await token({ iss: "https://evil.cloudflareaccess.com" }), CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(await token({ exp: seconds - 120 }), CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(await token({ exp: undefined }), CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(await token({ nbf: seconds + 600 }), CFG, certs(), NOW)).toBeNull();
  });

  it("refuses a wrong signature, alg none, an unknown key and garbage", async () => {
    expect(await verifyAccessJwt(await token({}, {}, otherKey.privateKey), CFG, certs(), NOW)).toBeNull();
    const [head, body] = (await token()).split(".");
    expect(await verifyAccessJwt(`${part({ alg: "none", kid: "k1" })}.${body}.`, CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(`${part({ alg: "HS256", kid: "k1" })}.${body}.${head}`, CFG, certs(), NOW)).toBeNull();
    expect(await verifyAccessJwt(await token({}, { kid: "k2" }), CFG, certs(), NOW)).toBeNull();
    // A changed claim breaks the signature.
    const forged = (await token()).split(".");
    forged[1] = part({ aud: [AUD], iss: TEAM, sub: "user-2", exp: NOW / 1000 + 3600 });
    expect(await verifyAccessJwt(forged.join("."), CFG, certs(), NOW)).toBeNull();
    for (const junk of ["", "a.b", "a.b.c", "!!.??.**", `${head}.${body}`]) expect(await verifyAccessJwt(junk, CFG, certs(), NOW)).toBeNull();
  });

  it("keeps the team's keys a while and looks again for a key it does not know", async () => {
    const fetcher = certs();
    await verifyAccessJwt(await token(), CFG, fetcher, NOW);
    await verifyAccessJwt(await token(), CFG, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await verifyAccessJwt(await token({}, { kid: "k9" }), CFG, fetcher, NOW);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("refuses when the keys cannot be fetched", async () => {
    const down = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    expect(await verifyAccessJwt(await token(), CFG, down, NOW)).toBeNull();
  });
});

describe("admin accounts and ADMIN_ACCESS_REQUIRED", () => {
  const ADMIN_PHONE = "+22890000009";
  const CUSTOMER_PHONE = "+22890000001";
  const REQUIRED = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD, ADMIN_ACCESS_REQUIRED: "1" };

  async function setup(settings: Partial<Env> = {}) {
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.stubGlobal("fetch", certs());
    const { db, d1 } = fakeD1();
    const env = { DB: d1, ...settings } as unknown as Env;
    const pin = await hashPin("4826");
    db.prepare("insert into users (id, phone, role, created_at, pin_hash) values ('boss', ?, 'admin', '2026-01-01T00:00:00.000Z', ?)").run(ADMIN_PHONE, pin);
    db.prepare("insert into users (id, phone, role, created_at, pin_hash) values ('ama', ?, 'rider', '2026-01-01T00:00:00.000Z', ?)").run(CUSTOMER_PHONE, pin);
    return { db, env };
  }
  const request = async (withToken: boolean | string, bearer?: string) => {
    const headers = new Headers();
    if (withToken) headers.set(ACCESS_HEADER, typeof withToken === "string" ? withToken : await token());
    if (bearer) headers.set("Authorization", `Bearer ${bearer}`);
    return new Request("https://admin.poinderecharge.com/api/auth/login", { method: "POST", headers });
  };
  const code = (p: Promise<unknown>) => p.then(() => "ok", (err: unknown) => (err instanceof ApiError ? err.code : String(err)));

  it("changes nothing while the switch is off", async () => {
    const { env } = await setup({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
    expect(await adminAllowed(env, await request(false))).toBe(true);
    const { token: session } = await signIn(env, await request(false), ADMIN_PHONE, "4826");
    expect(await currentUser(env, await request(false, session))).toMatchObject({ id: "boss", role: "admin" });
  });

  it("with the switch on, an admin only signs in and acts with a valid Access token", async () => {
    const { env } = await setup(REQUIRED);
    expect(await code(signIn(env, await request(false), ADMIN_PHONE, "4826"))).toBe("invalid_pin");
    expect(await code(signIn(env, await request(await token({ aud: ["other-app"] })), ADMIN_PHONE, "4826"))).toBe("invalid_pin");
    expect(await code(signIn(env, await request(false), ADMIN_PHONE, "1111"))).toBe("invalid_pin");

    const { token: session } = await signIn(env, await request(true), ADMIN_PHONE, "4826");
    expect(await currentUser(env, await request(true, session))).toMatchObject({ id: "boss" });
    // The same session token from the public app address, without Access, is worth nothing.
    expect(await currentUser(env, await request(false, session))).toBeNull();
  });

  it("answers a blocked admin exactly like an unknown address, so the app never reveals an admin account", async () => {
    const { env } = await setup(REQUIRED);
    const answer = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (err: unknown) => (err instanceof ApiError ? `${err.code} ${err.status}` : String(err)),
      );
    const unknown = await answer(signIn(env, await request(false), "+22890000077", "4826"));
    expect(unknown).toBe("invalid_pin 400");
    expect(await answer(signIn(env, await request(false), ADMIN_PHONE, "4826"))).toBe(unknown);
  });

  it("leaves customers alone", async () => {
    const { env } = await setup(REQUIRED);
    const { token: session } = await signIn(env, await request(false), CUSTOMER_PHONE, "4826");
    expect(await currentUser(env, await request(false, session))).toMatchObject({ id: "ama" });
  });

  it("stays shut when the switch is on but the Access settings are missing", async () => {
    const { db, env } = await setup({ ADMIN_ACCESS_REQUIRED: "1" });
    expect(await code(signIn(env, await request(true), ADMIN_PHONE, "4826"))).toBe("invalid_pin");
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, 'boss', ?, ?)").run(
      await sha256("token-of-boss-0123456789"),
      new Date(NOW).toISOString(),
      new Date(NOW + 86_400_000).toISOString(),
    );
    expect(await currentUser(env, await request(true, "token-of-boss-0123456789"))).toBeNull();
  });
});

describe("back office gateway", () => {
  const served: string[] = [];
  const fetcher = (name: string) =>
    ({
      fetch: async (req: Request) => {
        served.push(`${name} ${new URL(req.url).pathname} ${req.headers.has(ACCESS_HEADER) ? "with-token" : "no-token"}`);
        return new Response(name, { headers: { "Cache-Control": "public, max-age=3600" } });
      },
    }) as unknown as Fetcher;
  const env = (settings: Partial<AdminEnv> = { ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD }) =>
    ({ ASSETS: fetcher("assets"), API: fetcher("api"), ...settings }) as AdminEnv;
  const get = async (path: string, withToken: boolean | string = true) => {
    const headers = new Headers();
    if (withToken) headers.set(ACCESS_HEADER, typeof withToken === "string" ? withToken : await token());
    return new Request(`https://admin.poinderecharge.com${path}`, { headers });
  };

  beforeEach(() => {
    served.length = 0;
    vi.useFakeTimers({ toFake: ["Date"], now: NOW });
    vi.stubGlobal("fetch", certs());
  });

  it("serves nothing while Access is not set up", async () => {
    const res = await gateway.fetch(await get("/admin"), env({}));
    expect(res.status).toBe(503);
    expect(served).toEqual([]);
  });

  it("refuses requests without a valid Access token, pages and API alike", async () => {
    for (const path of ["/admin", "/api/me", "/_next/static/app.js"]) {
      expect((await gateway.fetch(await get(path, false), env())).status).toBe(403);
      expect((await gateway.fetch(await get(path, await token({}, {}, otherKey.privateKey)), env())).status).toBe(403);
    }
    expect(served).toEqual([]);
  });

  it("sends pages to the assets and /api/* to the app Worker, token included, and is never cached", async () => {
    const home = await gateway.fetch(await get("/"), env());
    expect(home.status).toBe(302);
    expect(home.headers.get("Location")).toBe("https://admin.poinderecharge.com/admin");
    const page = await gateway.fetch(await get("/admin"), env());
    expect(await page.text()).toBe("assets");
    expect(page.headers.get("Cache-Control")).toBe("no-store");
    expect(page.headers.get("X-Frame-Options")).toBe("DENY");
    expect(await (await gateway.fetch(await get("/api/admin/users"), env())).text()).toBe("api");
    expect(served).toEqual(["assets /admin with-token", "api /api/admin/users with-token"]);
  });
});
