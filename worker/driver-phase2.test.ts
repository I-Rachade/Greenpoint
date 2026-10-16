import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
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

async function serviceAccount() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
  return JSON.stringify({ project_id: "gp-test", client_email: "push@gp-test.iam.gserviceaccount.com", private_key: `-----BEGIN PRIVATE KEY-----\n${der}\n-----END PRIVATE KEY-----\n` });
}

const tokens = (db: DatabaseSync) => db.prepare("select token, user_id from push_tokens order by token").all();

describe("push notifications (driver phase 2)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("registers the phone of the signed-in account and drops it on sign-out", async () => {
    const { env, db } = await setup();
    expect((await call(env, null, "POST", "/api/push/token", { token: "tok-1", platform: "android" })).status).toBe(401);
    expect((await call(env, "kofi", "POST", "/api/push/token", { token: "tok-1", platform: "windows" })).status).toBe(400);
    expect((await call(env, "kofi", "POST", "/api/push/token", { token: "tok-1", platform: "android" })).status).toBe(200);
    // The same phone signs in as someone else: the token moves.
    await call(env, "ama", "POST", "/api/push/token", { token: "tok-1", platform: "android" });
    expect(tokens(db)).toEqual([{ token: "tok-1", user_id: "ama" }]);
    // Only one's own token can be removed.
    await call(env, "kofi", "POST", "/api/push/token/remove", { token: "tok-1" });
    expect(tokens(db)).toHaveLength(1);
    await call(env, "ama", "POST", "/api/push/token/remove", { token: "tok-1" });
    expect(tokens(db)).toEqual([]);
  });

  it("sends the offer to the driver's phones through Firebase, and forgets removed installs", async () => {
    const { env, db } = await setup();
    env.FCM_SERVICE_ACCOUNT = await serviceAccount();
    const sent: { url: string; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push({ url, body: String(init.body) });
        if (url.startsWith("https://oauth2.googleapis.com/")) return Response.json({ access_token: "at", expires_in: 3600 });
        const token = JSON.parse(String(init.body)).message.token as string;
        return token === "gone" ? new Response("{}", { status: 404 }) : Response.json({ name: "m1" });
      }),
    );
    await call(env, "kofi", "POST", "/api/push/token", { token: "phone", platform: "android" });
    await call(env, "kofi", "POST", "/api/push/token", { token: "gone", platform: "android" });
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: BE });
    await call(env, "yao", "POST", "/api/jobs/courier", COURIER);

    const pushes = sent.filter((x) => x.url.includes("fcm.googleapis.com/v1/projects/gp-test/messages:send")).map((x) => JSON.parse(x.body).message);
    const toPhone = pushes.find((m) => m.token === "phone");
    expect(toPhone.notification.title).toBe("Nouvelle course pour vous");
    expect(toPhone.notification.body).not.toContain("https://");
    expect(toPhone.data).toEqual({ path: "/chauffeur" });
    expect(tokens(db)).toEqual([{ token: "phone", user_id: "kofi" }]);
  });

  it("sends nothing without the Firebase secret", async () => {
    const { env } = await setup();
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await call(env, "kofi", "POST", "/api/push/token", { token: "phone", platform: "android" });
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: BE });
    await call(env, "yao", "POST", "/api/jobs/courier", COURIER);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("paying trips online and payouts to the phone (driver phase 2)", () => {
  const walletOf = (db: DatabaseSync, id: string) => (db.prepare("select balance_xof from wallets where user_id = ?").get(id) as { balance_xof: number } | undefined)?.balance_xof;
  const ledgerOf = (db: DatabaseSync, id: string) => db.prepare("select kind, amount_fcfa from driver_ledger where driver_id = ? order by at").all(id);

  async function withWallet() {
    const { env, db } = await setup();
    db.exec(`
      insert or replace into app_settings (key, value, updated_at) values ('wallet_enabled', '1', '${T}');
      insert into wallets (user_id, balance_xof, created_at, updated_at) values ('yao', 5000, '${T}', '${T}');
    `);
    return { env, db };
  }

  it("takes the fare from the wallet, so the driver takes no cash and is paid out on the phone", async () => {
    const { env, db } = await withWallet();
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: BE });
    const job = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", { ...COURIER, payWith: "wallet" });
    expect(job.status).toBe(200);
    const fare = job.body.fareFcfa;
    expect(job.body).toMatchObject({ prepaidFcfa: fare, collectFcfa: 0 });
    expect(walletOf(db, "yao")).toBe(5000 - fare);
    expect(db.prepare("select type, attribute, amount_xof from wallet_transactions where user_id = 'yao'").all()).toEqual([
      { type: "trip", attribute: "send", amount_xof: fare },
    ]);

    await call(env, "kofi", "POST", `/api/driver/jobs/${job.body.id}/accept`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${job.body.id}/board`);
    const code = (db.prepare("select handover_code from delivery_jobs").get() as { handover_code: string }).handover_code;
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${job.body.id}/finish`, { code })).status).toBe(200);
    // No cash taken: only the driver's share, which we now owe them.
    const home = await call<DriverHome>(env, "kofi", "GET", "/api/driver");
    expect(home.body.ledger.map((e) => e.kind)).toEqual(["earning"]);
    const owed = home.body.ledger[0].amountFcfa;

    // Payout to the phone: one open request at a time; the station cannot pay it twice.
    expect((await call(env, "kofi", "POST", "/api/driver/payouts", { network: "orange", phone: "90 11 22 33" })).status).toBe(400);
    const asked = await call<{ id: string; amountFcfa: number }>(env, "kofi", "POST", "/api/driver/payouts", { network: "tmoney", phone: "90 11 22 33" });
    expect(asked.body.amountFcfa).toBe(owed);
    expect((await call(env, "kofi", "POST", "/api/driver/payouts", { network: "tmoney", phone: "90 11 22 33" })).body).toMatchObject({ error: "payout_pending" });
    expect((await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.payout).toMatchObject({ status: "requested", amountFcfa: owed });
    const list = await call<{ id: string; driverName: string; balanceFcfa: number }[]>(env, "admin", "GET", "/api/admin/driver-payouts");
    expect(list.body).toEqual([expect.objectContaining({ id: asked.body.id, driverName: "Kofi", balanceFcfa: -owed })]);

    expect((await call(env, "admin", "POST", `/api/admin/driver-payouts/${asked.body.id}`, { status: "paid", reference: "TM-123" })).status).toBe(200);
    expect((await call(env, "admin", "POST", `/api/admin/driver-payouts/${asked.body.id}`, { status: "paid" })).status).toBe(409);
    expect(ledgerOf(db, "kofi")).toEqual([
      { kind: "earning", amount_fcfa: owed },
      { kind: "settlement", amount_fcfa: -owed },
    ]);
    expect((await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.payout).toMatchObject({ status: "paid", reference: "TM-123" });
    expect((await call(env, "kofi", "POST", "/api/driver/payouts", { network: "tmoney", phone: "90 11 22 33" })).body).toMatchObject({ error: "nothing_owed" });
  });

  it("gives the money back when the trip is called off, and refuses without enough balance", async () => {
    const { env, db } = await withWallet();
    const job = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", { ...COURIER, payWith: "wallet" });
    await call(env, "yao", "POST", `/api/jobs/${job.body.id}/cancel`);
    expect(walletOf(db, "yao")).toBe(5000);
    const mine = await call<DeliveryJob[]>(env, "yao", "GET", "/api/jobs/mine");
    expect(mine.body[0]).toMatchObject({ status: "cancelled", prepaidFcfa: job.body.fareFcfa, refunded: true });
    expect(db.prepare("select attribute from wallet_transactions where user_id = 'yao' order by created_at, attribute desc").all()).toHaveLength(2);

    db.prepare("update wallets set balance_xof = 100 where user_id = 'yao'").run();
    const poor = await call(env, "yao", "POST", "/api/jobs/courier", { ...COURIER, payWith: "wallet" });
    expect(poor.body).toMatchObject({ error: "insufficient_balance" });
    expect(db.prepare("select count(*) as n from delivery_jobs").get()).toEqual({ n: 1 });
    // Cash stays the default.
    const cash = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    expect(cash.body.prepaidFcfa).toBeUndefined();
    expect(cash.body.collectFcfa).toBe(cash.body.fareFcfa);
  });
});

describe("tours: several parcel trips at once (driver phase 2)", () => {
  const RIDE = { pickup: { ...BE, note: "Maison", phone: "90 11 22 33" }, dropoff: { lat: 6.14, lng: 1.23, note: "Marché" }, passengers: 1 };

  it("adds a parcel trip near a busy driver to their tour, never a ride, up to tourMax", async () => {
    const { env, db } = await setup();
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: BE });
    const first = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    await call(env, "kofi", "POST", `/api/driver/jobs/${first.body.id}/accept`);
    await call(env, "kofi", "POST", "/api/driver/position", { lat: 6.1325, lng: 1.2232 });

    // Nobody in line: the next courier starting nearby is offered to kofi on his tour.
    const second = await call<DeliveryJob>(env, "ama", "POST", "/api/jobs/courier", COURIER);
    let home = (await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body;
    expect(home.jobs?.map((j) => [j.id, j.status])).toEqual([
      [second.body.id, "assigned"],
      [first.body.id, "accepted"],
    ]);
    expect(home.job?.id).toBe(second.body.id);
    // One offer at a time; a ride never joins a tour.
    const ride = await call<DeliveryJob>(env, "ama", "POST", "/api/jobs/ride", RIDE);
    expect((await call<DeliveryJob[]>(env, "ama", "GET", "/api/jobs/mine")).body.find((j) => j.id === ride.body.id)?.status).toBe("open");

    // Declining a tour trip keeps the driver out of the line while they still carry the first one.
    await call(env, "kofi", "POST", `/api/driver/jobs/${second.body.id}/decline`);
    expect(db.prepare("select count(*) as n from driver_queue").get()).toEqual({ n: 0 });
    const third = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    await call(env, "kofi", "POST", `/api/driver/jobs/${third.body.id}/accept`);
    home = (await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body;
    expect(home.jobs?.map((j) => j.id)).toEqual([first.body.id, third.body.id]);
    expect(db.prepare("select tour_slot from delivery_jobs where id = ?").get(third.body.id)).toEqual({ tour_slot: 2 });

    // Both run side by side: the first is done while the second is still on board.
    await call(env, "kofi", "POST", `/api/driver/jobs/${first.body.id}/board`);
    const code = (db.prepare("select handover_code from delivery_jobs where id = ?").get(first.body.id) as { handover_code: string }).handover_code;
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${first.body.id}/finish`, { code })).status).toBe(200);
    expect((await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.jobs?.map((j) => j.id)).toEqual([third.body.id]);
  });

  it("stays with one trip at a time when tourMax is 1, or the driver is far away", async () => {
    const { env } = await setup();
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: BE });
    const first = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    await call(env, "kofi", "POST", `/api/driver/jobs/${first.body.id}/accept`);
    // Far from the next start: no tour.
    await call(env, "kofi", "POST", "/api/driver/position", { lat: 6.2, lng: 1.3 });
    await call(env, "ama", "POST", "/api/jobs/courier", COURIER);
    expect((await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.jobs).toHaveLength(1);
    // Near again, but tours switched off.
    const settings = (await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.settings;
    expect((await call(env, "admin", "POST", "/api/admin/driver-settings", { settings: { ...settings, tourMax: 1 } })).status).toBeLessThan(300);
    await call(env, "kofi", "POST", "/api/driver/position", { lat: 6.1325, lng: 1.2232 });
    expect((await call<DriverHome>(env, "kofi", "GET", "/api/driver")).body.jobs).toHaveLength(1);
  });
});
