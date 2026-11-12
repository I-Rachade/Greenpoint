import { describe, expect, it } from "vitest";
import type { BatteryDetail, BatteryList } from "../shared/batteries";
import type { ActivityPage, UsedSerial } from "../shared/owner-activity";
import type { AdminOperator, OwnerView } from "../shared/operators";
import type { StationCounter, SwapEntry } from "../shared/station-work";
import type { Profile } from "../shared/types";
import { handleApi } from "./api";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Read-only operator accounts (migration 0070): My stations of their operator, every battery and
// activity there, nothing of other operators, and no change anywhere. Runs the API on the SQLite D1.

const OV = "op-omnivoltaic";
const SPIRO = "op-spiro";
const USERS = [
  { id: "admin", phone: "+22890000001", name: "Admin", role: "admin" as const },
  { id: "kodjo", phone: "+22890000002", name: "Kodjo", role: "operator" as const }, // reads Omnivoltaic
  { id: "yao", phone: "+22890000003", name: "Yao", role: "operator" as const }, // runs Omnivoltaic
  { id: "kossi", phone: "+22890000004", name: "Kossi", role: "operator" as const }, // runs Spiro
  { id: "afi", phone: "+22890000005", name: "Afi", role: "operator" as const }, // staff at Dagué
  { id: "ama", phone: "+22890000006", name: "Ama", role: "customer" as const },
  { id: "esi", phone: "+22890000007", name: "Esi", role: "customer" as const },
];

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at) values (?, ?, ?, ?, ?)").run(u.id, u.phone, u.name, roleToDb(u.role), now);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into operators (id, name, is_own, created_at) values ('${OV}', 'Omnivoltaic', 0, '${now}'), ('${SPIRO}', 'Spiro', 0, '${now}');
    insert into operator_owners (operator_id, user_id, created_at, access) values
      ('${OV}', 'kodjo', '${now}', 'read'), ('${OV}', 'yao', '${now}', 'manage'), ('${SPIRO}', 'kossi', '${now}', 'manage');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('dague', '${OV}', 'Oxygène Dagué', 6.14, 1.23, 'swap', 20, '00:00-24:00', 500, '${now}'),
      ('agoe', '${OV}', 'Oxygène Agoè', 6.15, 1.24, 'swap', 20, '00:00-24:00', 500, '${now}'),
      ('adewui', '${SPIRO}', 'Spiro Adewui', 6.13, 1.22, 'swap', 20, '00:00-24:00', 400, '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values
      ('dague', 1, 0, 8, '${now}'), ('agoe', 1, 0, 8, '${now}'), ('adewui', 1, 0, 8, '${now}');
    insert into station_staff (station_id, user_id) values ('dague', 'afi');
    insert into battery_types (id, brand, name, created_at) values ('ov60', 'Omnivoltaic', '60 V', '${now}');
    insert into station_battery_types (station_id, battery_type_id, full_batteries) values ('dague', 'ov60', 4), ('agoe', 'ov60', 4), ('adewui', 'ov60', 4);
  `);
  return { db, env };
}

let seq = 0;
const rid = () => `req-${String(++seq).padStart(8, "0")}`;

async function call<T = unknown>(env: Env, as: string, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer token-of-${as}-0123456789` };
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T };
}

const swap = (env: Env, as: string, station: string, batteryIn: string, batteryOut: string, contact = "90000006") =>
  call<SwapEntry>(
    env,
    as,
    "POST",
    `/api/stations/${station}/swaps`,
    { requestId: rid(), customerType: "app", contact, payment: "cash", batteryTypeId: "ov60", batteryIn, batteryOut },
    station,
  );

describe("read-only operator accounts", () => {
  it("are marked on the profile and only read My stations", async () => {
    const { env } = await setup();
    expect(((await call<Profile>(env, "kodjo", "GET", "/api/me")).body).ownerReadOnly).toBe(true);
    expect(((await call<Profile>(env, "yao", "GET", "/api/me")).body).ownerReadOnly).toBeUndefined();
    const view = (await call<OwnerView>(env, "kodjo", "GET", "/api/owner")).body;
    expect(view.readOnly).toBe(true);
    expect(view.stations.map((s) => s.id).sort()).toEqual(["agoe", "dague"]);
    expect((await call<OwnerView>(env, "yao", "GET", "/api/owner")).body.readOnly).toBe(false);
    // No station work: not in the list of stations to work at, no action there.
    expect((await call(env, "kodjo", "GET", "/api/staff/stations")).status).toBe(403);
  });

  it("refuses every change, at the stations and in My stations", async () => {
    const { env, db } = await setup();
    const s = (await swap(env, "afi", "dague", "OV-1", "OV-2")).body;
    const refused = [
      await swap(env, "kodjo", "dague", "OV-2", "OV-3"),
      await call(env, "kodjo", "PATCH", "/api/stations/dague/status", { isOpen: false }, "dague"),
      await call(env, "kodjo", "PATCH", `/api/stations/dague/swaps/${s.id}`, { customerName: "X" }),
      await call(env, "kodjo", "DELETE", `/api/stations/dague/swaps/${s.id}`, {}),
      await call(env, "kodjo", "POST", "/api/stations/dague/battery-events", { requestId: rid(), type: "correction", delta: 1, reason: "x" }, "dague"),
      await call(env, "kodjo", "POST", "/api/owner/stations/dague", { openingHours: "00:00-24:00", phone: null }),
      await call(env, "kodjo", "POST", "/api/owner/staff", { stationId: "dague", contact: "90000007" }),
    ];
    for (const r of refused) expect(r).toMatchObject({ status: 403 });
    expect(refused[1].body).toEqual({ error: "read_only" });
    expect(db.prepare("select is_open from station_status where station_id = 'dague'").get()).toEqual({ is_open: 1 });
    expect(db.prepare("select count(*) as n from swap_log").get()).toEqual({ n: 1 });
    // Reading the counter and the swaps works, without the right to correct.
    const counter = await call<StationCounter>(env, "kodjo", "GET", "/api/stations/dague/counter");
    expect(counter.status).toBe(200);
    expect(counter.body.canCorrect).toBe(false);
    expect((await call<StationCounter>(env, "yao", "GET", "/api/stations/dague/counter")).body.canCorrect).toBe(true);
    expect((await call<SwapEntry[]>(env, "kodjo", "GET", "/api/stations/dague/swaps?days=7")).body.map((x) => x.id)).toEqual([s.id]);
    // Signing out still works.
    expect((await call(env, "kodjo", "POST", "/api/auth/logout")).status).toBe(200);
  });

  it("see the batteries and activity of their own stations only", async () => {
    const { env } = await setup();
    await swap(env, "afi", "dague", "OV-1", "OV-2");
    await swap(env, "kossi", "adewui", "OV-2", "OV-9", "90000007");
    await call(env, "yao", "PATCH", "/api/stations/agoe/status", { isOpen: false }, "agoe");
    await call(env, "kossi", "PATCH", "/api/stations/adewui/status", { isOpen: false }, "adewui");

    const list = (await call<BatteryList>(env, "kodjo", "GET", "/api/batteries")).body;
    expect(list.canEdit).toBe(false);
    expect(list.batteries.map((b) => b.serial).sort()).toEqual(["OV-1", "OV-2"]);
    expect((await call(env, "kodjo", "GET", "/api/batteries?stationId=adewui")).status).toBe(403);
    const ov2 = list.batteries.find((b) => b.serial === "OV-2")!;
    expect(ov2).toMatchObject({ location: "station", stationName: null, elsewhere: true });
    const detail = (await call<BatteryDetail>(env, "kodjo", "GET", `/api/batteries/${ov2.id}`)).body;
    expect(detail.history.map((h) => [h.type, h.stationName])).toEqual([
      ["elsewhere", null],
      ["out", "Oxygène Dagué"],
      ["added_at_swap", "Oxygène Dagué"],
    ]);
    expect(JSON.stringify(detail)).not.toContain("Adewui");
    expect(JSON.stringify(detail)).not.toContain("Kossi");

    const activity = (await call<ActivityPage>(env, "kodjo", "GET", "/api/owner/activity")).body;
    expect(new Set(activity.entries.map((e) => e.stationId))).toEqual(new Set(["dague", "agoe"]));
    expect(activity.entries.find((e) => e.kind === "swaps" && e.action === "swaps")).toMatchObject({ stationName: "Oxygène Dagué", person: "Afi", role: "staff" });
    expect(activity.entries.find((e) => e.table === "station_status")).toMatchObject({ stationId: "agoe", change: "update", changes: { is_open: [1, 0] } });
    const dague = (await call<ActivityPage>(env, "kodjo", "GET", "/api/owner/activity?stationId=dague&kind=status")).body;
    expect(dague.entries).toEqual([]);
    expect((await call(env, "kodjo", "GET", "/api/owner/activity?stationId=adewui")).status).toBe(403);

    const serials = (await call<UsedSerial[]>(env, "kodjo", "GET", "/api/owner/serials?stationId=dague&days=7")).body;
    expect(serials.map((x) => [x.serial, x.out, x.in]).sort()).toEqual([
      ["OV-1", 0, 1],
      ["OV-2", 1, 0],
    ]);
    expect((await call(env, "kodjo", "GET", "/api/owner/serials?stationId=adewui&days=7")).status).toBe(403);
  });

  it("are added read-only and switched by an admin, with an audit entry", async () => {
    const { env, db } = await setup();
    expect((await call(env, "admin", "POST", `/api/admin/operators/${OV}/owners`, { contact: "90000007" })).status).toBe(200);
    const owners = () => (call<AdminOperator[]>(env, "admin", "GET", "/api/admin/operators").then((r) => r.body.find((o) => o.id === OV)!.owners));
    expect((await owners()).map((o) => [o.userId, o.access])).toEqual([
      ["kodjo", "read"],
      ["yao", "manage"],
      ["esi", "read"],
    ]);
    expect((await call(env, "admin", "POST", `/api/admin/operators/${OV}/owners/kodjo/access`, { access: "manage" })).status).toBe(200);
    expect((await call<Profile>(env, "kodjo", "GET", "/api/me")).body.ownerReadOnly).toBeUndefined();
    expect((await call(env, "kodjo", "PATCH", "/api/stations/dague/status", { isOpen: false }, "dague")).status).toBe(200);
    expect(db.prepare("select changes from audit_log where table_name = 'operator_owners' and action = 'update'").get()).toEqual({
      changes: JSON.stringify({ access: ["read", "manage"] }),
    });
    expect((await call(env, "admin", "POST", `/api/admin/operators/${OV}/owners/kodjo/access`, { access: "all" })).status).toBe(400);
    expect((await call(env, "yao", "POST", `/api/admin/operators/${OV}/owners/kodjo/access`, { access: "read" })).status).toBe(403);
  });
});
