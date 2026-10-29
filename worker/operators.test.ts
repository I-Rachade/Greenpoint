import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { AdminOperator, MyStaffInvite, OwnerView } from "../shared/operators";
import type { StationInput, StationView } from "../shared/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";

// Operator accounts: an admin links an account to an operator; that account runs all the operator's stations.
// Runs the API on a minimal D1 on top of SQLite, with the real migrations (as in stations.test.ts).

type Value = string | number | null;

class Statement {
  constructor(
    private db: DatabaseSync,
    private sql: string,
    private params: Value[] = [],
  ) {}
  bind(...params: unknown[]) {
    return new Statement(this.db, this.sql, params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : (p as Value))));
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...this.params) as T | undefined) ?? null;
  }
  async all<T>() {
    return { results: this.db.prepare(this.sql).all(...this.params) as T[] };
  }
  async run() {
    const res = this.db.prepare(this.sql).run(...this.params);
    return { meta: { changes: Number(res.changes) } };
  }
}

const USERS = [
  { id: "admin", phone: "+22890000001", role: "admin" as const },
  { id: "yao", phone: "+22890000002", role: "customer" as const }, // will run Togo Moto
  { id: "afi", phone: "+22890000003", role: "customer" as const }, // will work at a station
  { id: "kossi", phone: "+22890000004", role: "customer" as const }, // runs nothing
];

async function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on");
  const dir = new URL("./migrations/", import.meta.url);
  for (const file of readdirSync(dir).sort()) db.exec(readFileSync(new URL(file, dir), "utf8"));
  const d1 = {
    prepare: (sql: string) => new Statement(db, sql),
    async batch(statements: Statement[]) {
      db.exec("begin");
      try {
        const out = [];
        for (const s of statements) out.push(await s.run());
        db.exec("commit");
        return out;
      } catch (err) {
        db.exec("rollback");
        throw err;
      }
    },
  };
  const now = new Date().toISOString();
  const expires = new Date(Date.now() + 3_600_000).toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, role, created_at) values (?, ?, ?, ?)").run(u.id, u.phone, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`session-token-of-${u.id}-0123456789`), u.id, now, expires);
  }
  return { db, env: { DB: d1 } as unknown as Env };
}

async function call(env: Env, as: string, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { Authorization: `Bearer session-token-of-${as}-0123456789`, "Content-Type": "application/json" };
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as unknown };
}

/** The person's open staff invites, and accepting the first one (migration 0050). */
const myInvites = async (env: Env, as: string) => (await call(env, as, "GET", "/api/staff-invites")).body as MyStaffInvite[];
async function acceptFirst(env: Env, as: string) {
  const [invite] = await myInvites(env, as);
  return call(env, as, "POST", `/api/staff-invites/${invite.id}/accept`);
}

function station(operatorId: string, name: string): StationInput {
  return {
    operatorId,
    name,
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
}

/** An operator "Togo Moto" with stations in Lomé and Kara, run by Yao; Bè belongs to another operator. */
async function withOperator() {
  const { db, env } = await setup();
  const created = await call(env, "admin", "POST", "/api/admin/operators", { id: null, input: { name: "Togo Moto", contactPhone: "90 11 22 33" } });
  expect(created.status).toBe(200);
  const operatorId = (created.body as { id: string }).id;
  await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: station(operatorId, "Lomé Centre") });
  await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: station(operatorId, "Kara Gare") });
  await call(env, "admin", "POST", "/api/admin/stations", { id: null, input: station("00000000-0000-4000-8000-000000000001", "Bè") });
  const all = (await call(env, "admin", "GET", "/api/stations")).body as StationView[];
  const id = (name: string) => all.find((s) => s.name === name)!.id;
  expect(await call(env, "admin", "POST", `/api/admin/operators/${operatorId}/owners`, { contact: "90 00 00 02" })).toEqual({ status: 200, body: null });
  return { db, env, operatorId, lome: id("Lomé Centre"), kara: id("Kara Gare"), be: id("Bè") };
}

describe("operator accounts", () => {
  it("lets an admin create an operator and link an account", async () => {
    const { env, operatorId } = await withOperator();
    const ops = (await call(env, "admin", "GET", "/api/admin/operators")).body as AdminOperator[];
    const op = ops.find((o) => o.id === operatorId)!;
    expect(op).toMatchObject({ name: "Togo Moto", isOwn: false, contactPhone: "+22890112233", stationCount: 2 });
    expect(op.owners.map((o) => o.userId)).toEqual(["yao"]);
    const me = (await call(env, "yao", "GET", "/api/me")).body as { ownerOf?: string[] } | null;
    expect(me?.ownerOf).toEqual([operatorId]);
  });

  it("refuses an unknown account and non-admins", async () => {
    const { env, operatorId } = await withOperator();
    expect(await call(env, "admin", "POST", `/api/admin/operators/${operatorId}/owners`, { contact: "90 99 99 99" })).toEqual({
      status: 404,
      body: { error: "account_not_found" },
    });
    expect((await call(env, "yao", "GET", "/api/admin/operators")).status).toBe(403);
    expect((await call(env, "yao", "POST", "/api/admin/operators", { id: null, input: { name: "X", contactPhone: null } })).status).toBe(403);
  });

  it("shows the owner all the operator's stations and no others", async () => {
    const { env, lome, kara } = await withOperator();
    const view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.operators.map((o) => o.name)).toEqual(["Togo Moto"]);
    expect(view.stations.map((s) => s.id).sort()).toEqual([lome, kara].sort());
    const staffStations = (await call(env, "yao", "GET", "/api/staff/stations")).body as StationView[];
    expect(staffStations.map((s) => s.id).sort()).toEqual([lome, kara].sort());
    expect((await call(env, "kossi", "GET", "/api/owner")).status).toBe(403);
  });

  it("lets the owner run station status, choose staff and edit details only at their stations", async () => {
    const { env, lome, be } = await withOperator();
    // An owner acts at the station chosen as active station (R7).
    expect((await call(env, "yao", "PATCH", `/api/stations/${lome}/status`, { isOpen: false })).status).toBe(409);
    expect((await call(env, "yao", "PATCH", `/api/stations/${lome}/status`, { isOpen: false }, lome)).status).toBe(200);
    expect((await call(env, "yao", "PATCH", `/api/stations/${be}/status`, { isOpen: false }, be)).status).toBe(403);

    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" })).status).toBe(200);
    // Only an invite so far: Afi is staff once she accepts.
    expect((await call(env, "afi", "GET", "/api/staff/stations")).status).toBe(403);
    expect((await acceptFirst(env, "afi")).status).toBe(200);
    expect((await call(env, "afi", "GET", "/api/staff/stations")).body).toMatchObject([{ id: lome }]);
    let view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.staff).toEqual([{ stationId: lome, userId: "afi", label: "+228 90 •• •• 03" }]);
    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: be, contact: "90000003" })).status).toBe(403);

    expect((await call(env, "yao", "POST", `/api/owner/stations/${lome}`, { openingHours: "06:00-22:00", phone: "90 11 22 33" })).status).toBe(200);
    expect((await call(env, "yao", "POST", `/api/owner/stations/${be}`, { openingHours: "06:00-22:00", phone: null })).status).toBe(403);
    view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    // Kept as a real number, so "has a phone" means one can call the station.
    expect(view.stations.find((s) => s.id === lome)).toMatchObject({ openingHours: "06:00-22:00", phone: "+22890112233" });
    expect((await call(env, "yao", "POST", `/api/owner/stations/${lome}`, { openingHours: "06:00-22:00", phone: "." })).body).toEqual({ error: "phone_not_allowed" });

    expect((await call(env, "yao", "DELETE", "/api/owner/staff", { stationId: lome, userId: "afi" })).status).toBe(200);
    // Back to a customer: no station work at all (R2).
    expect((await call(env, "afi", "GET", "/api/staff/stations")).status).toBe(403);
  });

  it("makes a linked account an operator and a customer again once it has nothing left", async () => {
    const { db, env, operatorId, lome } = await withOperator();
    const role = (id: string) => (db.prepare("select role from users where id = ?").get(id) as { role: string }).role;
    expect(role("yao")).toBe("operator");
    await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" });
    expect(role("afi")).toBe("rider");
    await acceptFirst(env, "afi");
    expect(role("afi")).toBe("operator");
    await call(env, "yao", "DELETE", "/api/owner/staff", { stationId: lome, userId: "afi" });
    expect(role("afi")).toBe("rider");
    await call(env, "admin", "DELETE", `/api/admin/operators/${operatorId}/owners/yao`);
    expect(role("yao")).toBe("rider");
  });

  it("gives exactly the rights and menu of the role an admin sets", async () => {
    const { db, env, lome } = await withOperator();
    await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" });
    await acceptFirst(env, "afi");

    // Back to customer: no station pages, no rights, no assignments or operator account left.
    expect((await call(env, "admin", "POST", "/api/admin/users/yao/role", { role: "customer" })).status).toBe(200);
    // R15: staff become a customer only once removed from their station.
    expect((await call(env, "admin", "POST", "/api/admin/users/afi/role", { role: "customer" })).body).toEqual({ error: "role_change_blocked" });
    expect((await call(env, "yao", "DELETE", "/api/owner/staff", { stationId: lome, userId: "afi" })).status).toBe(403); // yao is a customer now
    expect((await call(env, "admin", "DELETE", "/api/admin/staff", { stationId: lome, userId: "afi" })).status).toBe(200);
    expect((await call(env, "admin", "POST", "/api/admin/users/afi/role", { role: "customer" })).status).toBe(200);
    expect(((await call(env, "yao", "GET", "/api/me")).body as { role: string; ownerOf: string[] })).toMatchObject({ role: "customer", ownerOf: [] });
    expect((await call(env, "yao", "GET", "/api/owner")).status).toBe(403);
    // Back to a customer: no station work at all (R2).
    expect((await call(env, "afi", "GET", "/api/staff/stations")).status).toBe(403);
    expect((await call(env, "afi", "PATCH", `/api/stations/${lome}/status`, { isOpen: false })).status).toBe(403);
    expect(db.prepare("select count(*) as n from station_staff where user_id = 'afi'").get()).toEqual({ n: 0 });

    // An assignment that slipped through (e.g. older data) grants nothing without the role.
    db.prepare("insert into station_staff (station_id, user_id) values (?, 'kossi')").run(lome);
    expect((await call(env, "kossi", "PATCH", `/api/stations/${lome}/status`, { isOpen: false })).status).toBe(403);

    // Operator by hand: the station pages, but only the stations it is assigned to.
    expect((await call(env, "admin", "POST", "/api/admin/users/kossi/role", { role: "operator" })).status).toBe(200);
    expect((await call(env, "kossi", "PATCH", `/api/stations/${lome}/status`, { isOpen: false })).status).toBe(200);
  });

  it("ends a fleet manager's drivers when the admin changes the role", async () => {
    const { db, env } = await setup();
    db.prepare(
      "insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values ('afi', 'active', 'Afi', 'ID001', 'LIC001', 'moto', 'CODE0001', ?)",
    ).run(new Date().toISOString());
    expect((await call(env, "admin", "POST", "/api/admin/drivers/afi/manager", { contact: "90000004" })).status).toBe(200);
    expect(role("kossi")).toBe("fleet_manager");
    expect((await call(env, "kossi", "GET", "/api/fleet")).body).toMatchObject({ drivers: [{ userId: "afi" }] });
    // One role per person: a fleet manager cannot get station work.
    const op = (await call(env, "admin", "POST", "/api/admin/operators", { id: null, input: { name: "Togo Moto", contactPhone: null } })).body as { id: string };
    expect((await call(env, "admin", "POST", `/api/admin/operators/${op.id}/owners`, { contact: "90000004" })).body).toMatchObject({ error: "has_other_role" });
    expect(role("kossi")).toBe("fleet_manager");
    expect((await call(env, "admin", "POST", "/api/admin/users/kossi/role", { role: "customer" })).status).toBe(200);
    expect((await call(env, "kossi", "GET", "/api/fleet")).status).toBe(403);
    expect(db.prepare("select count(*) as n from fleet_manager_drivers").get()).toEqual({ n: 0 });

    function role(id: string) {
      return (db.prepare("select role from users where id = ?").get(id) as { role: string }).role;
    }
  });

  it("answers the owner the same whether or not an account has the contact (no probing)", async () => {
    const { db, env, lome } = await withOperator();
    const known = await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" });
    const unknown = await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90999999" });
    const unknownMail = await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "Nobody@Example.com" });
    expect(known).toEqual({ status: 200, body: null });
    expect(unknown).toEqual(known);
    expect(unknownMail).toEqual(known);
    // The owner's list shows what was typed, masked, never an account's name; nobody is staff yet.
    const view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.invites.map((i) => i.label)).toEqual(["+228 90 •• •• 03", "+228 90 •• •• 99", "no••@example.com"]);
    expect(view.staff).toEqual([]);
    // Inviting again keeps one open invite.
    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90 00 00 03" })).status).toBe(200);
    expect(db.prepare("select count(*) as n from staff_invites where contact = '+22890000003'").get()).toEqual({ n: 1 });
    // The account made later with that number sees its invite.
    db.prepare("insert into users (id, phone, role, created_at) values ('new', '+22890999999', 'rider', ?)").run(new Date().toISOString());
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, 'new', ?, ?)").run(
      await sha256("session-token-of-new-0123456789"),
      new Date().toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    expect((await myInvites(env, "new")).map((i) => [i.stationName, i.operatorName])).toEqual([["Lomé Centre", "Togo Moto"]]);
    // Signed out: an empty list, like fleet and shop invites.
    const res = await handleApi(new Request("https://app.poinderecharge.com/api/staff-invites"), env);
    expect(await res.json()).toEqual([]);
  });

  it("makes staff only when the invited person accepts, with every check of an assignment", async () => {
    const { db, env, lome, kara } = await withOperator();
    await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" });
    await call(env, "yao", "POST", "/api/owner/staff", { stationId: kara, contact: "90000003" });
    const [toLome, toKara] = await myInvites(env, "afi");
    // Someone else cannot see, accept or decline Afi's invite.
    expect(await myInvites(env, "kossi")).toEqual([]);
    expect(await call(env, "kossi", "POST", `/api/staff-invites/${toLome.id}/accept`)).toEqual({ status: 404, body: { error: "invite_not_found" } });
    expect((await call(env, "kossi", "POST", `/api/staff-invites/${toLome.id}/decline`)).status).toBe(404);
    expect(db.prepare("select count(*) as n from station_staff where user_id = 'kossi'").get()).toEqual({ n: 0 });
    // R15 at accepting: money in the wallet keeps Afi a customer, and the invite stays open.
    db.prepare("insert into wallets (user_id, balance_xof, created_at, updated_at) values ('afi', 500, 'x', 'x')").run();
    expect((await call(env, "afi", "POST", `/api/staff-invites/${toLome.id}/accept`)).body).toEqual({ error: "role_change_blocked" });
    db.prepare("update wallets set balance_xof = 0 where user_id = 'afi'").run();
    expect((await call(env, "afi", "POST", `/api/staff-invites/${toLome.id}/accept`)).status).toBe(200);
    expect(db.prepare("select station_id from station_staff where user_id = 'afi'").all()).toEqual([{ station_id: lome }]);
    expect(db.prepare("select role from users where id = 'afi'").get()).toEqual({ role: "operator" });
    // One station only: the other invite ended with the accept, and a used invite cannot be used again.
    expect(await myInvites(env, "afi")).toEqual([]);
    expect((await call(env, "afi", "POST", `/api/staff-invites/${toKara.id}/accept`)).status).toBe(404);
    expect((await call(env, "afi", "POST", `/api/staff-invites/${toLome.id}/accept`)).status).toBe(404);
    // An owner is never staff: the invite is answered at accepting, not at inviting.
    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: kara, contact: "90000002" })).status).toBe(200);
    expect((await acceptFirst(env, "yao")).body).toEqual({ error: "has_other_role" });
  });

  it("lets the person decline, the owner cancel, and ends invites after 7 days", async () => {
    const { db, env, lome, kara, be } = await withOperator();
    await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000003" });
    const [declined] = await myInvites(env, "afi");
    expect((await call(env, "afi", "POST", `/api/staff-invites/${declined.id}/decline`)).status).toBe(200);
    expect(await myInvites(env, "afi")).toEqual([]);
    expect((await call(env, "afi", "POST", `/api/staff-invites/${declined.id}/accept`)).status).toBe(404);

    await call(env, "yao", "POST", "/api/owner/staff", { stationId: lome, contact: "90000004" });
    let view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    const [open] = view.invites;
    // Only an owner of the station (or an admin) cancels; not the invited person, not a stranger.
    expect((await call(env, "kossi", "POST", `/api/owner/staff-invites/${open.id}/revoke`)).status).toBe(403);
    expect((await call(env, "yao", "POST", `/api/owner/staff-invites/${open.id}/revoke`)).status).toBe(200);
    expect((await call(env, "yao", "POST", `/api/owner/staff-invites/${open.id}/revoke`)).status).toBe(404);
    expect(await myInvites(env, "kossi")).toEqual([]);
    expect((await call(env, "kossi", "POST", `/api/staff-invites/${open.id}/accept`)).status).toBe(404);
    // Nobody may invite to a station of another operator.
    expect((await call(env, "yao", "POST", "/api/owner/staff", { stationId: be, contact: "90000004" })).status).toBe(403);

    await call(env, "yao", "POST", "/api/owner/staff", { stationId: kara, contact: "90000004" });
    const expires = db.prepare("select expires_at from staff_invites where status = 'pending'").get() as { expires_at: string };
    expect(Date.parse(expires.expires_at) - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    db.prepare("update staff_invites set expires_at = ? where status = 'pending'").run(new Date(Date.now() - 1000).toISOString());
    expect(await myInvites(env, "kossi")).toEqual([]);
    view = (await call(env, "yao", "GET", "/api/owner")).body as OwnerView;
    expect(view.invites).toEqual([]);
    expect(db.prepare("select status from staff_invites where station_id = ?").get(kara)).toEqual({ status: "expired" });
  });

  it("takes the rights away when the admin removes the owner", async () => {
    const { env, operatorId, lome } = await withOperator();
    await call(env, "admin", "DELETE", `/api/admin/operators/${operatorId}/owners/yao`);
    expect((await call(env, "yao", "GET", "/api/owner")).status).toBe(403);
    expect((await call(env, "yao", "PATCH", `/api/stations/${lome}/status`, { isOpen: false }, lome)).status).toBe(403);
  });
});
