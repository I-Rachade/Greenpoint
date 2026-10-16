import { beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";
import type { DeliveryJob, DriverHome } from "../src/lib/drivers";
import type { FleetView } from "../src/lib/fleet";

// Driver phase 2 (planung/fahrer.md): live position of drivers on duty.

const OWN = "00000000-0000-4000-8000-000000000001";
const T = new Date().toISOString();
const LATER = "2099-01-01T00:00:00.000Z";
const BE = { lat: 6.1319, lng: 1.2228 };
const USERS = [
  ["admin", "+22890000001", "admin"],
  ["ama", "+22890000003", "rider"],
  ["kofi", "+22890000004", "driver"],
  ["kodjo", "+22890000005", "driver"],
  ["edem", "+22890000007", "fleet_manager"],
  ["yao", "+22891000002", "rider"],
] as const;

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin("2580");
});

export async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1, MEDIA: { put: async () => {}, delete: async () => {} } } as unknown as Env;
  for (const [id, phone, role] of USERS) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(id, phone, id, role, T, pinHash);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`token-of-${id}-0123456789`), id, T, LATER);
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, battery_capacity, opening_hours, created_at, price_battery_xof) values
      ('st', '${OWN}', 'Bè', 6.1319, 1.2228, 'both', 10, '00:00-24:00', '${T}', 1000), ('st2', '${OWN}', 'Lomé', 6.17, 1.21, 'both', 10, '00:00-24:00', '${T}', 1000);
    insert into parcel_depots (station_id, is_active, note, lockers, updated_at) values ('st', 1, '', 0, '${T}'), ('st2', 1, '', 0, '${T}');
    insert into app_settings (key, value, updated_at) values ('drivers_enabled', '1', '${T}');
    insert into fleet_vehicles (id, type, plate, created_at) values ('v1', 'moto', 'TG 1', '${T}'), ('v2', 'moto', 'TG 2', '${T}');
    insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, vehicle_id, code, created_at) values
      ('kofi', 'active', 'Kofi', 'ID001', 'LIC001', 'moto', 'v1', 'ABCDEFGH', '${T}'),
      ('kodjo', 'active', 'Kodjo', 'ID002', 'LIC002', 'moto', 'v2', 'HGFEDCBA', '${T}');
    insert into fleets (manager_id, name, status, tier, created_at) values ('edem', 'Flotte Edem', 'approved', 'standard', '${T}');
    insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}');
  `);
  return { db, env };
}

export async function call<B = unknown>(env: Env, as: string | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as) headers.Authorization = `Bearer token-of-${as}-0123456789`;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as B };
}

export const COURIER = {
  pickup: { ...BE, note: "Maison", phone: "90 11 22 33" },
  dropoff: { lat: 6.14, lng: 1.23, note: "Maison bleue" },
  recipientPhone: "93 00 00 01",
  recipientName: "Client",
  content: "Robe",
  size: "S",
};

const positions = (db: DatabaseSync) => db.prepare("select driver_id from driver_positions order by driver_id").all() as { driver_id: string }[];

describe("live position of drivers (driver phase 2)", () => {
  it("keeps the position only while on duty, and shows it to the customer during the trip", async () => {
    const { env, db } = await setup();
    // Off duty: nothing kept.
    expect((await call(env, "kofi", "POST", "/api/driver/position", { lat: 6.13, lng: 1.22 })).body).toEqual({ kept: false });
    expect(positions(db)).toEqual([]);
    expect((await call(env, "kofi", "POST", "/api/driver/position", { lat: "x", lng: 1 })).status).toBe(400);
    expect((await call(env, "ama", "POST", "/api/driver/position", { lat: 6.13, lng: 1.22 })).status).toBe(403);

    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: BE });
    expect((await call(env, "kofi", "POST", "/api/driver/position", { lat: 6.132, lng: 1.223, accuracyM: 12 })).body).toEqual({ kept: true });
    // The fleet manager sees where their driver is.
    const fleet = await call<FleetView>(env, "edem", "GET", "/api/fleet");
    expect(fleet.body.drivers.find((d) => d.userId === "kofi")?.position).toMatchObject({ lat: 6.132, lng: 1.223 });

    const job = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    // Offered, not accepted yet: the customer does not see the driver yet.
    let mine = await call<DeliveryJob[]>(env, "yao", "GET", "/api/jobs/mine");
    expect(mine.body[0].driver?.position).toBeNull();
    await call(env, "kofi", "POST", `/api/driver/jobs/${job.body.id}/accept`);
    mine = await call<DeliveryJob[]>(env, "yao", "GET", "/api/jobs/mine");
    expect(mine.body[0].driver?.position).toMatchObject({ lat: 6.132, lng: 1.223 });
    // An old position is not shown.
    db.prepare("update driver_positions set at = '2020-01-01T00:00:00.000Z'").run();
    mine = await call<DeliveryJob[]>(env, "yao", "GET", "/api/jobs/mine");
    expect(mine.body[0].driver?.position).toBeNull();

    // The driver's own view does not break, and a trip that ended no longer tracks.
    expect((await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.job?.id).toBe(job.body.id);
    await call(env, "kofi", "POST", `/api/driver/position`, { lat: 6.135, lng: 1.225 });
    await call(env, "kofi", "POST", `/api/driver/jobs/${job.body.id}/board`);
    const code = (db.prepare("select handover_code from delivery_jobs").get() as { handover_code: string }).handover_code;
    await call(env, "kofi", "POST", `/api/driver/jobs/${job.body.id}/finish`, { code });
    mine = await call<DeliveryJob[]>(env, "yao", "GET", "/api/jobs/mine");
    expect(mine.body[0].driver?.position).toBeNull();
    // Done and not back in a queue: off duty, the position is dropped.
    expect((await call(env, "kofi", "POST", "/api/driver/position", { lat: 6.13, lng: 1.22 })).body).toEqual({ kept: false });
    expect(positions(db)).toEqual([]);
  });
});
