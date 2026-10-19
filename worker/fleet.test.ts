import { describe, expect, it } from "vitest";
import type { Profile } from "../src/lib/types";
import { acceptJob } from "./drivers";
import type { Env } from "./env";
import { fleetAssign, fleetStats, fleetView, setDriverManager } from "./fleet";
import type { ParcelCtx } from "./parcels";
import { fakeD1 } from "./test-d1";

const OWN_OPERATOR = "00000000-0000-4000-8000-000000000001";
const ADMIN: Profile = { id: "admin", phone: "+22890000001", email: null, fullName: "Admin", role: "admin" };
const manager = (id: string): Profile => ({ id, phone: null, email: null, fullName: null, role: "fleet_manager" });
const driver = (id: string): Profile => ({ id, phone: null, email: null, fullName: null, role: "driver" });

function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  db.exec(`
    insert into users (id, phone, email, full_name, role, created_at) values
      ('admin', '+22890000001', null, 'Admin', 'admin', '${now}'),
      ('mgr', '+22891000001', null, 'Flotte Est', 'rider', '${now}'),
      ('mgr2', null, 'flotte@example.tg', 'Flotte Ouest', 'rider', '${now}'),
      ('staffer', '+22891000003', null, 'Comptoir', 'operator', '${now}'),
      ('d1', '+22893000001', null, null, 'driver', '${now}'),
      ('d2', '+22893000002', null, null, 'driver', '${now}'),
      ('d3', '+22893000003', null, null, 'driver', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('st-a', '${OWN_OPERATOR}', 'Station A', 6.1319, 1.2228, 'both', '${now}'),
      ('st-b', '${OWN_OPERATOR}', 'Station B', 6.17, 1.21, 'both', '${now}');
    insert into fleet_vehicles (id, type, plate, is_active, created_at) values
      ('v1', 'moto', 'TG 1', 1, '${now}'), ('v2', 'cargo_tricycle', 'TG 2', 1, '${now}'), ('v3', 'moto', 'TG 3', 1, '${now}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at) values
      ('d1', 'active', 'Kodjo', 'ID001', 'LIC001', 'moto', 'v1', 'CODE0001', '${now}'),
      ('d2', 'active', 'Afi', 'ID002', 'LIC002', 'cargo_tricycle', 'v2', 'CODE0002', '${now}'),
      ('d3', 'active', 'Yao', 'ID003', 'LIC003', 'moto', 'v3', 'CODE0003', '${now}');
  `);
  const env = { DB: d1 } as unknown as Env;
  const ctx = (user: Profile): ParcelCtx => ({
    env,
    db: env.DB,
    user: async () => user,
    requireUser: async () => user,
    requireAdmin: async () => {
      if (user.role !== "admin") throw new Error("forbidden");
      return user;
    },
    isStaffOf: async (u) => u.role === "admin",
    audit: (actor, table, action, rowId, changes, ids = {}) =>
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(new Date().toISOString(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes)),
  });
  const role = (id: string) => (db.prepare("select role from users where id = ?").get(id) as { role: string }).role;
  const openJob = (id: string, size = "S", status = "open") =>
    db.exec(`insert into delivery_jobs (id, kind, status, from_station_id, to_station_id, size, weight_kg, distance_m, fare_fcfa, created_at, recipient_phone, customer_name, home_phone)
      values ('${id}', 'express', '${status}', 'st-a', 'st-b', '${size}', 2, 4500, 1500, '${now}', '+22892000000', 'Ama', '+22892000001')`);
  return { db, admin: ctx(ADMIN), ctx, role, openJob };
}

describe("fleet managers", () => {
  it("linking makes a customer a fleet manager with an approved fleet, which stays after the last driver", async () => {
    const t = setup();
    await setDriverManager(t.admin, "d1", "91 00 00 01");
    await setDriverManager(t.admin, "d2", "+22891000001");
    expect(t.role("mgr")).toBe("fleet_manager");
    // A driver has one manager: linking to someone else moves them.
    await setDriverManager(t.admin, "d2", "flotte@example.tg");
    expect(t.role("mgr2")).toBe("fleet_manager");
    expect(t.role("mgr")).toBe("fleet_manager");
    expect(t.db.prepare("select status, tier, name from fleets where manager_id = 'mgr'").get()).toEqual({ status: "approved", tier: "standard", name: "Flotte Est" });
    await setDriverManager(t.admin, "d1", null);
    // A fleet manager is an account of its own since phase 6: no drivers, still a fleet manager.
    expect(t.role("mgr")).toBe("fleet_manager");
    const log = t.db.prepare("select action from audit_log where table_name = 'fleet_manager_drivers' order by id").all() as { action: string }[];
    expect(log.map((l) => l.action)).toEqual(["insert", "insert", "delete", "insert", "delete"]);
  });

  it("refuses station staff, unknown accounts and the driver themself", async () => {
    const t = setup();
    await expect(setDriverManager(t.admin, "d1", "91 00 00 03")).rejects.toMatchObject({ code: "has_other_role" });
    await expect(setDriverManager(t.admin, "d1", "99 99 99 99")).rejects.toMatchObject({ code: "account_not_found" });
    await expect(setDriverManager(t.admin, "d1", "93 00 00 01")).rejects.toMatchObject({ code: "forbidden" });
    await expect(setDriverManager(t.ctx(manager("mgr")), "d1", "91 00 00 01")).rejects.toThrow("forbidden");
  });

  it("a manager sees only their drivers and hides the customers' contacts", async () => {
    const t = setup();
    await setDriverManager(t.admin, "d1", "91 00 00 01");
    await setDriverManager(t.admin, "d2", "flotte@example.tg");
    t.openJob("j1");
    const view = await fleetView(t.ctx(manager("mgr")));
    expect(view.drivers.map((d) => d.userId)).toEqual(["d1"]);
    expect(view.openJobs).toHaveLength(1);
    expect(view.openJobs[0]).toMatchObject({ customerName: null, recipient: null });
    await expect(fleetView(t.ctx(driver("d3")))).rejects.toMatchObject({ code: "forbidden" });
    // An admin sees every approved driver.
    expect((await fleetView(t.admin)).drivers).toHaveLength(3);
  });

  it("shows a manager only open trips their drivers fit, without the door until one has it", async () => {
    const t = setup();
    await setDriverManager(t.admin, "d1", "91 00 00 01"); // moto only
    t.openJob("big", "XL");
    t.openJob("small");
    const now = new Date().toISOString();
    t.db.exec(`insert into delivery_jobs (id, kind, status, home_lat, home_lng, home_note, home_phone, dropoff_lat, dropoff_lng, dropoff_note, size, distance_m, fare_fcfa, created_at)
      values ('door', 'courier', 'open', 6.175432, 1.215678, 'Portail bleu, 2e maison', '+22892000001', 6.2004, 1.1906, 'Chez Afi', 'S', 3000, 1000, '${now}')`);
    const mgr = t.ctx(manager("mgr"));
    const view = await fleetView(mgr);
    expect(view.openJobs.map((j) => j.id).sort()).toEqual(["door", "small"]);
    const door = view.openJobs.find((j) => j.id === "door")!;
    expect(door.home).toEqual({ lat: 6.175, lng: 1.216, note: "", phone: "" });
    expect(door.dropoff).toEqual({ lat: 6.2, lng: 1.191, note: "" });
    // No active vehicle, no open trips.
    t.db.exec("update fleet_vehicles set is_active = 0 where id = 'v1'");
    expect((await fleetView(mgr)).openJobs).toEqual([]);
    t.db.exec("update fleet_vehicles set is_active = 1 where id = 'v1'");
    // Once their driver has it, the manager sees where to go (still not the customer's phone).
    await fleetAssign(mgr, "door", "d1");
    const job = (await fleetView(mgr)).drivers.find((d) => d.userId === "d1")?.job;
    expect(job?.home).toMatchObject({ lat: 6.175432, note: "Portail bleu, 2e maison", phone: "" });
    // An admin still sees every open trip.
    expect((await fleetView(t.admin)).openJobs.map((j) => j.id).sort()).toEqual(["big", "small"]);
  });

  it("hands an open trip to one of the manager's drivers, who confirms as usual", async () => {
    const t = setup();
    await setDriverManager(t.admin, "d1", "91 00 00 01");
    await setDriverManager(t.admin, "d2", "91 00 00 01");
    t.openJob("j1", "XL");
    t.openJob("j2");
    const mgr = t.ctx(manager("mgr"));
    await expect(fleetAssign(mgr, "j1", "d3")).rejects.toMatchObject({ code: "driver_not_found" });
    await expect(fleetAssign(mgr, "j1", "d1")).rejects.toMatchObject({ code: "vehicle_too_small" });
    await fleetAssign(mgr, "j1", "d2");
    expect((await fleetView(mgr)).drivers.find((d) => d.userId === "d2")?.job).toMatchObject({ id: "j1", status: "assigned" });
    // Only trips nobody has.
    await expect(fleetAssign(mgr, "j1", "d1")).rejects.toMatchObject({ code: "job_wrong_status" });
    await expect(fleetAssign(mgr, "j2", "d2")).rejects.toMatchObject({ code: "driver_busy" });
    await acceptJob(t.ctx(driver("d2")), "j1");
    const audit = t.db.prepare("select actor, changes from audit_log where table_name = 'delivery_jobs' and row_id = 'j1'").all() as { actor: string; changes: string }[];
    expect(audit.some((a) => a.actor === "mgr" && JSON.parse(a.changes).by === "fleet")).toBe(true);
  });

  it("adds up trips, takings, cash and charging per driver over the period", async () => {
    const t = setup();
    await setDriverManager(t.admin, "d1", "91 00 00 01");
    const day = "2026-10-05";
    const at = `${day}T10:00:00.000Z`;
    t.db.exec(`
      insert into delivery_jobs (id, kind, status, size, distance_m, fare_fcfa, driver_id, created_at, done_at) values
        ('a', 'pickup', 'done', 'S', 3000, 800, 'd1', '${at}', '${at}'),
        ('b', 'delivery', 'done', 'S', 5000, 1000, 'd1', '${at}', '${at}'),
        ('c', 'delivery', 'failed', 'S', 5000, 1000, 'd1', '${at}', '${at}'),
        ('old', 'pickup', 'done', 'S', 3000, 800, 'd1', '2026-09-01T10:00:00.000Z', '2026-09-01T10:00:00.000Z');
      insert into driver_ledger (id, driver_id, at, kind, amount_fcfa, job_id) values
        ('l1', 'd1', '${at}', 'collected', 3300, 'a'), ('l2', 'd1', '${at}', 'earning', 440, 'a'),
        ('l3', 'd1', '${at}', 'collected', 1000, 'b'), ('l4', 'd1', '${at}', 'earning', 550, 'b'),
        ('l5', 'd1', '${at}', 'settlement', 2000, null);
      insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code) values
        ('r1', 'd1', 'st-a', 'battery', 'completed', '${at}', '${at}', '1234'),
        ('r2', 'd1', 'st-a', 'slot', 'completed', '${at}', '${at}', '1235'),
        ('r3', 'd1', 'st-a', 'battery', 'cancelled', '${at}', '${at}', '1236');
      insert into payments (id, identifier, user_id, station_id, reservation_id, amount_xof, network, provider, status, created_at, updated_at, paid_at) values
        ('p1', 'PAY-1', 'd1', 'st-a', 'r1', 1500, 'flooz', 'mock', 'succeeded', '${at}', '${at}', '${at}');
      insert into greenpoint_ledger (id, user_id, kind, co2_grams, points, job_id, distance_m, created_at) values
        ('g1', 'd1', 'delivery', 240, 0, 'a', 3000, '${at}'), ('g2', 'd1', 'delivery', 400, 0, 'b', 5000, '${at}');
      insert into swap_log (id, request_id, station_id, has_battery_in, customer_type, driver_id, fleet_manager_id, payment, amount_xof, staff_id, role, created_at) values
        ('s1', 'rq1', 'st-a', 1, 'fleet', 'd1', 'mgr', 'fleet', 1000, 'admin', 'admin', '${at}');
    `);
    // Standard tier: no statistics (M4) until an admin unlocks the fleet.
    await expect(fleetStats(t.ctx(manager("mgr")), "2026-10-01", "2026-10-31")).rejects.toMatchObject({ code: "fleet_locked" });
    t.db.exec("update fleets set tier = 'unlocked' where manager_id = 'mgr'");
    const stats = await fleetStats(t.ctx(manager("mgr")), "2026-10-01", "2026-10-31");
    expect(stats.drivers).toEqual([
      {
        userId: "d1",
        tripsDone: 2,
        tripsFailed: 1,
        fareFcfa: 1800,
        earningFcfa: 990,
        collectedFcfa: 4300,
        settledFcfa: 2000,
        batterySwaps: 2,
        chargingSlots: 1,
        chargingPaidFcfa: 1500,
        fleetSwaps: 1,
        fleetSwapsXof: 1000,
        distanceKm: 8,
        co2Grams: 640,
      },
    ]);
    // The last day counts in full; a reversed or open-ended period does not.
    expect((await fleetStats(t.ctx(manager("mgr")), "2026-10-05", "2026-10-05")).drivers[0].tripsDone).toBe(2);
    await expect(fleetStats(t.ctx(manager("mgr")), "2026-10-31", "2026-10-01")).rejects.toMatchObject({ code: "bad_request" });
  });
});
