import { beforeAll, describe, expect, it } from "vitest";
import type { SwapEntry } from "../shared/station-work";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Past swaps added by an admin (POST /api/stations/:id/swaps/past): a swap made while no phone
// could record it, entered afterwards at its real time, attributed to who served the customer,
// listed and exported with the day's other swaps.

const OWN = "00000000-0000-4000-8000-000000000001";
const USERS = [
  { id: "admin", phone: "+22890000001", role: "admin" as const },
  { id: "yao", phone: "+22890000002", role: "operator" as const }, // owner of OWN
  { id: "afi", phone: "+22890000004", role: "operator" as const }, // staff at be
  { id: "ama", phone: "+22890000005", role: "customer" as const },
  { id: "kofi", phone: "+22890000006", role: "operator" as const }, // works elsewhere
];

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin("2580");
});

async function setup(full = 3) {
  const { db, d1 } = fakeD1();
  const env = { DB: d1 } as unknown as Env;
  const now = new Date().toISOString();
  for (const u of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(u.id, u.phone, u.id, roleToDb(u.role), now, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(
      await sha256(`token-of-${u.id}-0123456789`),
      u.id,
      now,
      new Date(Date.now() + 3_600_000).toISOString(),
    );
  }
  db.exec(`
    insert into operator_owners (operator_id, user_id, created_at) values ('${OWN}', 'yao', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, price_battery_xof, created_at) values
      ('be', '${OWN}', 'Bè', 6.13, 1.22, 'swap', 10, '00:00-24:00', 500, '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('be', 1, 0, ${full}, '${now}');
    update stations set green_credit = 1 where id = 'be';
    insert into station_staff (station_id, user_id) values ('be', 'afi');
  `);
  return { db, env };
}

let seq = 0;
const rid = () => `past-${String(++seq).padStart(8, "0")}`;
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

async function call<T = unknown>(env: Env, as: string, method: string, path: string, body?: unknown, activeStation?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Authorization: `Bearer token-of-${as}-0123456789` };
  if (activeStation) headers["X-Active-Station"] = activeStation;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T };
}

const counterFull = (db: ReturnType<typeof fakeD1>["db"]) =>
  (db.prepare("select full from battery_counter where station_id = 'be' and battery_type_id = ''").get() as { full: number } | undefined)?.full;

const past = (over: Record<string, unknown> = {}) => ({
  requestId: rid(),
  at: ago(26 * 60),
  customerType: "cash",
  payment: "cash",
  amountXof: 500,
  ...over,
});

describe("past swaps added by an admin", () => {
  it("records the swap at its time, for the staff member, once, and lists and exports it with that day", async () => {
    const { db, env } = await setup();
    const input = past({ staffId: "afi", customerName: "Sanda", batteryOut: "B-1", batteryIn: "B-9", amountXof: 740 });
    const res = await call<SwapEntry>(env, "admin", "POST", "/api/stations/be/swaps/past", input);
    expect(res.status).toBe(200);
    expect(res.body.createdAt).toBe(input.at);
    expect(res.body.addedLater).toBe(true);
    expect(res.body.offline).toBe(true);
    expect(res.body.review).toBeNull();
    expect(res.body.amountXof).toBe(740);
    expect(res.body.customerName).toBe("Sanda");
    expect(res.body.person).toBe("afi");
    expect(res.body.role).toBe("staff");

    // The same request again: still one swap.
    const again = await call<SwapEntry>(env, "admin", "POST", "/api/stations/be/swaps/past", input);
    expect(again.body.id).toBe(res.body.id);
    expect((db.prepare("select count(*) as n from swap_log").get() as { n: number }).n).toBe(1);

    // Counter, battery register and activity log follow.
    expect(counterFull(db)).toBe(2);
    expect((db.prepare("select created_at from battery_events where type = 'issue'").get() as { created_at: string }).created_at).toBe(input.at);
    expect((db.prepare("select location from batteries where serial = 'B-1'").get() as { location: string }).location).toBe("customer");
    expect((db.prepare("select location from batteries where serial = 'B-9'").get() as { location: string }).location).toBe("station");
    const audit = db.prepare("select actor, action from audit_log where table_name = 'swap_log'").get() as { actor: string; action: string };
    expect(audit).toEqual({ actor: "admin", action: "insert" });

    // In the history of the last 7 days and in the export of its day.
    const week = await call<SwapEntry[]>(env, "admin", "GET", "/api/stations/be/swaps?days=7");
    expect(week.body.map((s) => s.id)).toEqual([res.body.id]);
    const day = String(input.at).slice(0, 10);
    const sheet = await call<SwapEntry[]>(env, "admin", "GET", `/api/stations/be/swaps?from=${day}&to=${day}`);
    expect(sheet.body.map((s) => s.id)).toEqual([res.body.id]);
  });

  it("can leave the counter as it is, and is the admin's own swap without a staff member", async () => {
    const { db, env } = await setup();
    const res = await call<SwapEntry>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ updateCounter: false }));
    expect(res.status).toBe(200);
    expect(res.body.role).toBe("admin");
    expect(counterFull(db)).toBeUndefined();
    expect((db.prepare("select count(*) as n from battery_events").get() as { n: number }).n).toBe(0);
  });

  it("takes Mobile Money with its transaction id, once, and a customer account by phone", async () => {
    const { env } = await setup();
    const mm = past({ customerType: "app", contact: "+22890000005", payment: "mobile_money", mmNetwork: "tmoney", mmRef: "TM12345", amountXof: 875 });
    const res = await call<SwapEntry>(env, "admin", "POST", "/api/stations/be/swaps/past", mm);
    expect(res.status).toBe(200);
    expect(res.body.payment).toBe("mobile_money");
    expect(res.body.customer).toBeTruthy();
    const twice = await call<{ error: string }>(env, "admin", "POST", "/api/stations/be/swaps/past", { ...mm, requestId: rid() });
    expect(twice.status).toBe(409);
    expect(twice.body.error).toBe("mm_ref_used");
    const noRef = await call<{ error: string }>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ payment: "mobile_money", mmNetwork: "flooz" }));
    expect(noRef.body.error).toBe("mm_ref_required");
  });

  it("is for admins only, within 92 days, never in the future, and only for people of the station", async () => {
    const { env } = await setup();
    expect((await call(env, "yao", "POST", "/api/stations/be/swaps/past", past())).status).toBe(403);
    expect((await call(env, "afi", "POST", "/api/stations/be/swaps/past", past())).status).toBe(403);
    const old = await call<{ error: string }>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ at: ago(93 * 24 * 60) }));
    expect(old.body.error).toBe("past_swap_too_old");
    const future = await call<{ error: string }>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ at: ago(-60) }));
    expect(future.body.error).toBe("past_swap_in_future");
    const stranger = await call<{ error: string }>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ staffId: "kofi" }));
    expect(stranger.body.error).toBe("staff_not_at_station");
    // The owner of the station may be the one who served.
    const owner = await call<SwapEntry>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ staffId: "yao" }));
    expect(owner.body.role).toBe("owner");
  });

  it("never moves a battery a later swap already moved", async () => {
    const { db, env } = await setup();
    await call(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash", batteryIn: "B-9", batteryOut: "B-1" });
    const res = await call<SwapEntry>(env, "admin", "POST", "/api/stations/be/swaps/past", past({ batteryIn: "B-1", batteryOut: "B-2" }));
    expect(res.status).toBe(200);
    expect((db.prepare("select location from batteries where serial = 'B-1'").get() as { location: string }).location).toBe("customer");
  });
});
