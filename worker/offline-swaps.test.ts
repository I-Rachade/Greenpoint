import { beforeAll, describe, expect, it } from "vitest";
import type { OfflineSwapReject, SwapEntry } from "../shared/station-work";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { roleToDb } from "./roles";
import { fakeD1 } from "./test-d1";

// Swaps made without network and sent later (migration 0071): kept at their real time, never
// twice, recorded "to check" when they contradict the back-office, refused ones kept for the admin.

const OWN = "00000000-0000-4000-8000-000000000001";
const USERS = [
  { id: "admin", phone: "+22890000001", role: "admin" as const },
  { id: "yao", phone: "+22890000002", role: "operator" as const }, // owner of OWN
  { id: "afi", phone: "+22890000004", role: "operator" as const }, // staff at be
  { id: "ama", phone: "+22890000005", role: "customer" as const },
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
const rid = () => `offline-${String(++seq).padStart(8, "0")}`;
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

describe("offline swaps", () => {
  it("keeps the real time, and the same swap sent twice is recorded once", async () => {
    const { db, env } = await setup();
    const at = ago(120);
    const input = { requestId: rid(), customerType: "cash", offlineAt: at };
    const first = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", input);
    expect(first.status).toBe(200);
    expect(first.body.createdAt).toBe(at);
    expect(first.body.offline).toBe(true);
    expect(first.body.syncedAt).toBeTruthy();
    expect(first.body.review).toBeNull();
    expect(first.body.amountXof).toBe(500);
    const again = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", input);
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(first.body.id);
    expect((db.prepare("select count(*) as n from swap_log").get() as { n: number }).n).toBe(1);
    expect(counterFull(db)).toBe(2);
    const event = db.prepare("select created_at from battery_events where type = 'issue'").get() as { created_at: string };
    expect(event.created_at).toBe(at);
  });

  it("records a swap without a full battery in the counter, to check, where an online one is refused", async () => {
    const { db, env } = await setup(0);
    const online = await call<{ error: string }>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash" });
    expect(online.status).toBe(409);
    expect(online.body.error).toBe("no_full_battery");
    const offline = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash", offlineAt: ago(30) });
    expect(offline.status).toBe(200);
    expect(offline.body.review).toBe("stock");
    expect(counterFull(db)).toBe(0);

    // The owner sees it among the swaps to check, whatever its day, and marks it checked.
    const list = await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps?toCheck=1");
    expect(list.body.map((s) => s.id)).toEqual([offline.body.id]);
    const checked = await call<SwapEntry>(env, "yao", "POST", `/api/stations/be/swaps/${offline.body.id}/checked`, undefined, "be");
    expect(checked.status).toBe(200);
    expect(checked.body.reviewedAt).toBeTruthy();
    expect((await call<SwapEntry[]>(env, "yao", "GET", "/api/stations/be/swaps?toCheck=1")).body).toEqual([]);
    // Staff cannot mark swaps checked.
    expect((await call(env, "afi", "POST", `/api/stations/be/swaps/${offline.body.id}/checked`)).status).toBe(403);
  });

  it("records a cash customer whose contact is unknown, to check", async () => {
    const { env } = await setup();
    const res = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", {
      requestId: rid(),
      customerType: "app",
      payment: "cash",
      contact: "+22899999999",
      offlineAt: ago(10),
    });
    expect(res.status).toBe(200);
    expect(res.body.review).toBe("customer");
    expect(res.body.reviewNote).toBe("recipient_not_found");
  });

  it("records a fleet swap whose pass no longer holds as unpaid, to check", async () => {
    const { env } = await setup();
    const res = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", {
      requestId: rid(),
      customerType: "fleet",
      driverCode: "not-a-pass",
      offlineAt: ago(10),
    });
    expect(res.status).toBe(200);
    expect(res.body.customerType).toBe("cash");
    expect(res.body.payment).toBe("none");
    expect(res.body.review).toBe("payment");
    expect(res.body.reviewNote).toBe("driver_pass_invalid");
  });

  it("never takes Green Credit or a reservation offline", async () => {
    const { db, env } = await setup();
    const res = await call<{ error: string }>(env, "afi", "POST", "/api/stations/be/swaps", {
      requestId: rid(),
      customerType: "app",
      creditCode: "123456",
      offlineAt: ago(10),
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("offline_not_allowed");
    expect((db.prepare("select count(*) as n from offline_swap_rejects").get() as { n: number }).n).toBe(1);
  });

  it("refuses a swap older than 14 days or in the future, and keeps it for the admin", async () => {
    const { env } = await setup();
    const old = await call<{ error: string }>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash", offlineAt: ago(15 * 24 * 60) });
    expect(old.body.error).toBe("offline_too_old");
    const future = await call<{ error: string }>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash", offlineAt: ago(-60) });
    expect(future.body.error).toBe("offline_in_future");

    expect((await call(env, "yao", "GET", "/api/admin/offline-swap-rejects")).status).toBe(403);
    const rejects = await call<OfflineSwapReject[]>(env, "admin", "GET", "/api/admin/offline-swap-rejects");
    expect(rejects.body.map((r) => r.error).sort()).toEqual(["offline_in_future", "offline_too_old"]);
    expect(rejects.body[0].stationName).toBe("Bè");
    expect(rejects.body[0].input.customerType).toBe("cash");
    const done = await call(env, "admin", "POST", `/api/admin/offline-swap-rejects/${rejects.body[0].id}/resolve`);
    expect(done.status).toBe(200);
    expect((await call<OfflineSwapReject[]>(env, "admin", "GET", "/api/admin/offline-swap-rejects")).body).toHaveLength(1);
  });

  it("keeps a swap refused because the staff no longer works at the station", async () => {
    const { db, env } = await setup();
    db.exec("delete from station_staff where user_id = 'afi'");
    const res = await call<{ error: string }>(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash", offlineAt: ago(5) });
    expect(res.status).toBe(403);
    const rejects = await call<OfflineSwapReject[]>(env, "admin", "GET", "/api/admin/offline-swap-rejects");
    expect(rejects.body.map((r) => r.error)).toEqual(["forbidden"]);
  });

  it("never moves a battery a later swap already moved", async () => {
    const { db, env } = await setup();
    // Online now: battery B-1 handed out.
    await call(env, "afi", "POST", "/api/stations/be/swaps", { requestId: rid(), customerType: "cash", batteryIn: "B-9", batteryOut: "B-1" });
    // Sent late: an hour ago, B-1 came back to the station.
    const late = await call<SwapEntry>(env, "afi", "POST", "/api/stations/be/swaps", {
      requestId: rid(),
      customerType: "cash",
      batteryIn: "B-1",
      batteryOut: "B-2",
      offlineAt: ago(60),
    });
    expect(late.status).toBe(200);
    expect(late.body.review).toBe("battery");
    const b1 = db.prepare("select location from batteries where serial = 'B-1'").get() as { location: string };
    expect(b1.location).toBe("customer");
  });
});
