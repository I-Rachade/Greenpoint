import { describe, expect, it } from "vitest";
import type { StationView } from "../shared/types";
import { handleApi } from "./api";
import { register } from "./auth";
import type { Env } from "./env";
import { nowIso, sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// "Add user" in the backoffice (POST /api/admin/users): an admin makes an account without a PIN,
// with its role and (station staff) its station; the person sets the PIN with a code later.

const USERS = [
  { id: "admin", phone: "+22890000001", role: "admin" as const },
  { id: "ama", phone: "+22890000002", role: "customer" as const },
];

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = nowIso();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, role, created_at) values (?, ?, ?, ?)").run(u.id, u.phone, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`session-token-of-${u.id}-0123456789`), u.id, now, expires);
  }
  return { db, env };
}

async function call(env: Env, as: string, method: string, path: string, body?: unknown) {
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: { Authorization: `Bearer session-token-of-${as}-0123456789`, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

async function withStation() {
  const ctx = await setup();
  const op = await call(ctx.env, "admin", "POST", "/api/admin/operators", { id: null, input: { name: "Togo Moto", contactPhone: "90 11 22 33" } });
  const operatorId = (op.body as { id: string }).id;
  const input = {
    operatorId,
    name: "Lomé Centre",
    address: "",
    lat: 6.13,
    lng: 1.22,
    kind: "swap",
    vehicleTypes: ["scooter"],
    chargingSlots: 0,
    batteryCapacity: 10,
    openingHours: "07:00-19:00",
    phone: null,
  };
  await call(ctx.env, "admin", "POST", "/api/admin/stations", { id: null, input });
  const stations = (await call(ctx.env, "admin", "GET", "/api/stations")).body as StationView[];
  return { ...ctx, stationId: stations[0].id };
}

const user = (db: ReturnType<typeof fakeD1>["db"], column: string, value: string) =>
  db.prepare(`select id, phone, email, full_name, role, pin_hash from users where ${column} = ?`).get(value) as
    | { id: string; phone: string | null; email: string | null; full_name: string | null; role: string; pin_hash: string | null }
    | undefined;

describe("admin creates a user", () => {
  it("makes a customer without a PIN, written to the audit log", async () => {
    const { db, env } = await setup();
    const res = await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 09", fullName: " Kofi ", role: "customer", stationId: null });
    expect(res.status).toBe(200);
    const row = user(db, "phone", "+22890000009");
    expect(row).toMatchObject({ id: (res.body as { id: string }).id, full_name: "Kofi", role: roleToDb("customer"), pin_hash: null });
    expect(db.prepare("select actor, action from audit_log where table_name = 'profiles' and row_id = ?").get(row!.id)).toEqual({ actor: "admin", action: "insert" });
    // It shows in the backoffice list.
    const snap = (await call(env, "admin", "GET", "/api/admin/snapshot")).body as { users: { id: string }[] };
    expect(snap.users.some((u) => u.id === row!.id)).toBe(true);
  });

  it("makes station staff at the chosen station", async () => {
    const { db, env, stationId } = await withStation();
    const res = await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 10", fullName: "Afi", role: "operator", stationId });
    expect(res.status).toBe(200);
    const row = user(db, "phone", "+22890000010")!;
    expect(row.role).toBe("operator");
    expect(db.prepare("select station_id from station_staff where user_id = ?").get(row.id)).toEqual({ station_id: stationId });
  });

  it("gives other roles through the same rules as the role menu", async () => {
    const { db, env } = await setup();
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "flotte@example.com", fullName: "Flotte", role: "fleet_manager", stationId: null })).status).toBe(200);
    const row = user(db, "email", "flotte@example.com")!;
    expect(row.role).toBe("fleet_manager");
    expect(db.prepare("select status from fleets where manager_id = ?").get(row.id)).toEqual({ status: "approved" });
  });

  it("refuses an existing account, a bad contact, a bad role and a station for a non-staff role", async () => {
    const { env, stationId } = await withStation();
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 02", fullName: null, role: "customer", stationId: null })).body).toEqual({ error: "user_exists" });
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "not-an-email@", fullName: null, role: "customer", stationId: null })).body).toEqual({ error: "invalid_contact" });
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "123", fullName: null, role: "customer", stationId: null })).body).toEqual({ error: "phone_not_allowed" });
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 11", fullName: null, role: "driver", stationId: null })).status).toBe(400);
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 11", fullName: null, role: "customer", stationId })).status).toBe(400);
    expect((await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 11", fullName: null, role: "operator", stationId: "nope" })).status).toBe(404);
  });

  it("is for admins only", async () => {
    const { env } = await setup();
    expect((await call(env, "ama", "POST", "/api/admin/users", { contact: "90 00 00 12", fullName: null, role: "admin", stationId: null })).status).toBe(403);
  });

  it("lets the person set their own PIN with a code, keeping the role", async () => {
    const { db, env, stationId } = await withStation();
    await call(env, "admin", "POST", "/api/admin/users", { contact: "90 00 00 13", fullName: "Yao", role: "operator", stationId });
    const phone = "+22890000013";
    db.prepare("insert into otp_codes (phone, code_hash, created_at, expires_at) values (?, ?, ?, ?)").run(
      phone,
      await sha256(`${phone}:123456`),
      nowIso(),
      new Date(Date.now() + 600_000).toISOString(),
    );
    await register(env, new Request("https://app.poinderecharge.com/api/auth/register", { method: "POST" }), phone, "123456", "4826");
    const row = user(db, "phone", phone)!;
    expect(row.pin_hash).toMatch(/^pbkdf2\$/);
    expect(row.role).toBe("operator");
  });
});
