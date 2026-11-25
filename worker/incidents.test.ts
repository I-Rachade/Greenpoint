import { beforeAll, describe, expect, it } from "vitest";
import type { Incident } from "../shared/incidents";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Problems reported at a station (0066): anyone working there reports one, the station's owners
// and the admins get an e-mail, only an owner or an admin marks it handled.

const OWN = "00000000-0000-4000-8000-000000000001";
const PARTNER = "op-partner";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const, email: "admin@example.com" },
  { id: "yao", phone: "+22890000002", name: "Yao", role: "operator" as const, email: "yao@example.com" }, // owner of OWN (be)
  { id: "kossi", phone: "+22890000003", name: "Kossi", role: "operator" as const, email: "kossi@example.com" }, // owner of PARTNER
  { id: "afi", phone: "+22890000004", name: "Afi", role: "operator" as const, email: null }, // staff at be
  { id: "ama", phone: "+22890000005", name: "Ama", role: "customer" as const, email: "ama@example.com" },
];

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin("2580");
});

async function setup() {
  const { db, d1 } = fakeD1();
  const sent: { to: string; subject: string; text: string }[] = [];
  const env = { DB: d1, EMAIL: { send: async (m: { to: string; subject: string; text: string }) => void sent.push(m) } } as unknown as Env;
  const now = new Date().toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, email, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?, ?)").run(u.id, u.phone, u.email, u.name, roleToDb(u.role), now, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('${PARTNER}', 'Kara Énergie', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}'), ('${PARTNER}', 'kossi', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', 500, '${now}'),
      ('kara', '${PARTNER}', 'Kara', 9.55, 1.19, 'swap', 10, '00:00-24:00', 400, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
  `);
  return { db, env, sent };
}

let seq = 0;
const rid = () => `inc-${String(++seq).padStart(8, "0")}`;

async function call<T = unknown>(env: Env, as: string, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer token-of-${as}-0123456789` };
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
}

const report = (env: Env, as: string, body: Record<string, unknown>, active?: string) =>
  call<Incident>(env, as, "POST", "/api/stations/be/incidents", { requestId: rid(), ...body }, active);

describe("problems reported at a station (0066)", () => {
  it("records a report once and tells the station's owners and the admins", async () => {
    const { env, db, sent } = await setup();
    const requestId = rid();
    const a = await call<Incident>(env, "afi", "POST", "/api/stations/be/incidents", { requestId, kind: "battery", batteryLabel: " ov30-0193 ", comment: "  Batterie   chaude " });
    expect(a.status).toBe(200);
    expect(a.body).toMatchObject({ kind: "battery", batteryLabel: "OV30-0193", comment: "Batterie chaude", person: "Afi", role: "staff", status: "open" });
    // Sent again (no network answer the first time): one report, one alert.
    const again = await call<Incident>(env, "afi", "POST", "/api/stations/be/incidents", { requestId, kind: "battery" });
    expect(again.body.id).toBe(a.body.id);
    expect((db.prepare("select count(*) as n from station_incidents").get() as { n: number }).n).toBe(1);
    expect(sent.map((m) => m.to).sort()).toEqual(["admin@example.com", "yao@example.com"]);
    expect(sent[0].subject).toBe("Anomalie batterie : Bè");
    expect(sent[0].text).toContain("signalé par Afi");
  });

  it("needs a kind, and a comment for other problems", async () => {
    const { env } = await setup();
    expect((await report(env, "afi", { kind: "flood" })).body).toEqual({ error: "incident_kind_required" });
    expect((await report(env, "afi", { kind: "other", comment: "  " })).body).toEqual({ error: "incident_comment_required" });
    expect((await report(env, "afi", { kind: "power", comment: "x".repeat(501) })).body).toEqual({ error: "incident_too_long" });
    expect((await report(env, "afi", { kind: "other", comment: "Porte du local cassée" })).status).toBe(200);
  });

  it("only lets people working at the station report and read, and only owners and admins mark handled", async () => {
    const { env } = await setup();
    expect((await report(env, "ama", { kind: "power" })).status).toBe(403);
    expect((await report(env, "kossi", { kind: "power" }, "be")).status).toBe(403);
    const open = (await report(env, "afi", { kind: "charger" })).body;
    expect((await call(env, "ama", "GET", "/api/stations/be/incidents")).status).toBe(403);
    expect((await call<Incident[]>(env, "afi", "GET", "/api/stations/be/incidents")).body.map((i) => i.id)).toEqual([open.id]);
    const resolve = (as: string, active?: string) => call<Incident>(env, as, "POST", `/api/stations/be/incidents/${open.id}/resolve`, { resolution: "Chargeur remplacé" }, active);
    expect((await resolve("afi")).status).toBe(403);
    expect((await resolve("kossi")).status).toBe(403);
    // From the back office: no active station needed to mark it handled.
    const done = await resolve("yao");
    expect(done.body).toMatchObject({ status: "resolved", resolvedBy: "Yao", resolution: "Chargeur remplacé" });
    expect(done.body.resolvedAt).toBeTruthy();
    // Handled once: a second tap changes nothing.
    expect((await resolve("admin", "be")).body).toMatchObject({ resolvedBy: "Yao" });
    expect((await call(env, "yao", "POST", "/api/stations/be/incidents/nope/resolve", {}, "be")).status).toBe(404);
  });

  it("lists the open reports first, then the handled ones", async () => {
    const { env } = await setup();
    const first = (await report(env, "afi", { kind: "power" })).body;
    const second = (await report(env, "afi", { kind: "payment", comment: "Flooz reçu deux fois" })).body;
    await call(env, "admin", "POST", `/api/stations/be/incidents/${first.id}/resolve`, {}, "be");
    const list = (await call<Incident[]>(env, "yao", "GET", "/api/stations/be/incidents")).body;
    expect(list.map((i) => [i.id, i.status])).toEqual([
      [second.id, "open"],
      [first.id, "resolved"],
    ]);
  });
});
