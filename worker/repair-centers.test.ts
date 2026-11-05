import { describe, expect, it } from "vitest";
import type { RepairCenter } from "../shared/repair-centers";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";

// Repair workshops away from stations (migration 0046): the admin manages them, the app lists
// the active ones without signing in. Runs the API on worker/test-d1.ts.

const OWN = "00000000-0000-4000-8000-000000000001"; // poinderecharge, from 0001_init.sql

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  db.prepare("insert into users (id, phone, full_name, role, created_at) values ('admin', '+22890000001', 'Admin', 'admin', ?)").run(now);
  db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, 'admin', ?, ?)").run(
    await sha256("admin-session-token-0123456789"),
    now,
    new Date(Date.now() + 3_600_000).toISOString(),
  );
  return { db, env };
}

async function call<T = unknown>(env: Env, method: string, path: string, body?: unknown, signedIn = true) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(signedIn ? { Authorization: "Bearer admin-session-token-0123456789" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T };
}

const input = (patch: Record<string, unknown> = {}) => ({
  operatorId: OWN,
  name: "Ets Olaiya Motors",
  address: "Dapaong",
  lat: 10.8623,
  lng: 0.2076,
  phone: "",
  openingHours: "",
  isActive: true,
  ...patch,
});

describe("repair workshops", () => {
  it("are added, listed in the app while active, changed and removed", async () => {
    const { env, db } = await setup();
    const { body } = await call<{ id: string }>(env, "POST", "/api/admin/repair-centers", { id: null, input: input() });
    const pub = await call<RepairCenter[]>(env, "GET", "/api/repair-centers", undefined, false);
    expect(pub.body).toEqual([
      expect.objectContaining({ id: body.id, name: "Ets Olaiya Motors", operatorName: "poinderecharge", phone: null, openingHours: "", isActive: true }),
    ]);

    await call(env, "POST", "/api/admin/repair-centers", { id: body.id, input: input({ isActive: false, openingHours: "Mo-Sa 08:00-18:00" }) });
    expect((await call<RepairCenter[]>(env, "GET", "/api/repair-centers", undefined, false)).body).toEqual([]);
    expect((await call<RepairCenter[]>(env, "GET", "/api/admin/repair-centers")).body[0]).toMatchObject({ isActive: false, openingHours: "Mo-Sa 08:00-18:00" });

    await call(env, "DELETE", `/api/admin/repair-centers/${body.id}`);
    expect((await call<RepairCenter[]>(env, "GET", "/api/admin/repair-centers")).body).toEqual([]);
    expect((db.prepare("select count(*) as n from audit_log where table_name = 'repair_centers'").get() as { n: number }).n).toBe(3);
  });

  it("refuses hours that are not days and times, and positions off the globe", async () => {
    const { env } = await setup();
    expect((await call(env, "POST", "/api/admin/repair-centers", { id: null, input: input({ openingHours: "le matin" }) })).body).toEqual({ error: "bad_request" });
    expect((await call(env, "POST", "/api/admin/repair-centers", { id: null, input: input({ lat: 120 }) })).body).toEqual({ error: "bad_request" });
  });
});
