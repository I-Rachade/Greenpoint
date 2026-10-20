import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { sha256 } from "./http";
import { connectPacket, MQTT, MqttReader, pubackPacket, readPublish, subscribePacket } from "./mqtt";
import { ingestTutrack, runShareTimers, setTrackerForTests } from "./share";
import { fakeD1 } from "./test-d1";
import { md5, simulatedTracker, statusFromDetail, tutrackTime, type Tracker, type TrackerAction } from "./tutrack";
import type { ShareMe, ShareRide } from "../src/lib/share";

// Share (worker/share.ts): reserve, ride, hand back within a station's radius, pay.

const OWN = "00000000-0000-4000-8000-000000000001";
let db: DatabaseSync;
let env: Env;
let commands: TrackerAction[];
let media: Map<string, ArrayBuffer>;

/** Bè and Lomé are about 1.5 km apart. */
const BE = { lat: 6.13, lng: 1.22 };
const LOME = { lat: 6.14, lng: 1.23 };

beforeEach(async () => {
  const fake = fakeD1();
  db = fake.db;
  const now = new Date().toISOString();
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const pin = await hashPin("2580");
  for (const [id, phone, role] of [
    ["admin", "+22890000001", "admin"],
    ["afi", "+22890000004", "operator"],
    ["ama", "+22890000006", "rider"],
    ["kodjo", "+22890000007", "rider"],
    ["yawa", "+22890000009", "driver"],
  ]) {
    db.prepare("insert into users (id, phone, full_name, role, created_at, pin_hash) values (?, ?, ?, ?, ?, ?)").run(id, phone, id, role, now, pin);
    db.prepare("insert into sessions (token_hash, user_id, created_at, expires_at) values (?, ?, ?, ?)").run(await sha256(`token-of-${id}-0123456789`), id, now, later);
  }
  db.exec(`
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('be', '${OWN}', 'Bè', ${BE.lat}, ${BE.lng}, 'both', '${now}'),
      ('lome', '${OWN}', 'Lomé', ${LOME.lat}, ${LOME.lng}, 'both', '${now}'),
      ('far', '${OWN}', 'Kara', 9.55, 1.19, 'both', '${now}');
    insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values ('be', 1, 2, 3, '${now}'), ('lome', 1, 2, 3, '${now}');
    insert into station_staff (station_id, user_id) values ('be', 'afi');
    update app_settings set value = '1' where key = 'share_enabled';
  `);
  media = new Map();
  env = {
    DB: fake.d1,
    MEDIA: {
      get: async () => null,
      put: async (key: string, body: ArrayBuffer) => void media.set(key, body),
      delete: async (key: string) => void media.delete(key),
    },
  } as unknown as Env;
  commands = [];
  const recording: Tracker = { name: "simulated", command: async (_v, action) => void commands.push(action), status: async () => null };
  setTrackerForTests(recording);
});

afterEach(() => setTrackerForTests(null));

async function call<T = unknown>(method: string, path: string, who: string | null, body?: unknown, headers: Record<string, string> = {}) {
  const h: Record<string, string> = { "Content-Type": "application/json", "X-Active-Station": "be", ...headers };
  if (who) h.Authorization = `Bearer token-of-${who}-0123456789`;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, {
      method,
      headers: h,
      body: method === "GET" ? undefined : body instanceof Uint8Array ? body : JSON.stringify(body ?? {}),
    }),
    env,
  );
  return { status: res.status, body: (await res.json()) as T & { error?: string } };
}

const admin = <T = unknown>(method: string, path: string, body?: unknown) => call<T>(method, path, "admin", body);

/** Share at Bè and Lomé, a price for e-motorbikes, one available vehicle at Bè, Ama approved. */
async function ready(price = { unlockXof: 200, minuteXof: 25, pauseMinuteXof: 5, depositXof: 0, wrongDropXof: 1000, isActive: true }) {
  expect((await admin("POST", "/api/admin/share/stations/be", { enabled: true, radiusM: 50, helmets: 2 })).status).toBe(200);
  expect((await admin("POST", "/api/admin/share/stations/lome", { enabled: true, radiusM: 50, helmets: 0 })).status).toBe(200);
  expect((await admin("POST", "/api/admin/share/tariffs/emoto", price)).status).toBe(200);
  const saved = await admin<{ id: string }>("POST", "/api/admin/share/vehicles", {
    id: null,
    input: { kind: "emoto", name: "Moto 1", plate: "tg 1234", homeStationId: "be", trackerId: "1107746", imei: "", sim: "", unlockCommand: "", lockCommand: "", note: "" },
  });
  const vehicleId = saved.body.id;
  expect((await admin("POST", `/api/admin/share/vehicles/${vehicleId}/state`, { status: "available", stationId: "be" })).status).toBe(200);
  for (const kind of ["id", "selfie"]) {
    const up = await call("POST", `/api/share/documents/${kind}`, "ama", new Uint8Array([1, 2, 3]), { "Content-Type": "image/jpeg" });
    expect(up.status).toBe(200);
  }
  expect((await admin("POST", "/api/admin/share/verifications/ama", { approve: true })).status).toBe(200);
  return vehicleId;
}

/** Moves the ride's clock back, as if it had started a little under that many minutes ago (each begun minute counts). */
function startedMinutesAgo(rideId: string, minutes: number) {
  db.prepare("update share_rides set started_at = ? where id = ?").run(new Date(Date.now() - minutes * 60_000 + 2000).toISOString(), rideId);
}

describe("Share rides", () => {
  it("answers as if it did not exist while switched off, and the overview is empty", async () => {
    db.exec("update app_settings set value = '0' where key = 'share_enabled'");
    expect((await call("GET", "/api/share/me", "ama")).status).toBe(404);
    expect((await call("GET", "/api/share", null)).body).toEqual({ stations: [], tariffs: [] });
    expect((await call<{ share: boolean }>("GET", "/api/features", null)).body.share).toBe(false);
  });

  it("refuses accounts that are not customers", async () => {
    expect((await call("GET", "/api/share/me", "yawa")).status).toBe(403);
    expect((await call("POST", "/api/share/rides", "afi", {})).status).toBe(403);
  });

  it("needs approved photos and a price before a ride", async () => {
    const vehicleId = await ready({ unlockXof: 0, minuteXof: 0, pauseMinuteXof: 0, depositXof: 0, wrongDropXof: 0, isActive: false });
    expect((await call("POST", "/api/share/rides", "kodjo", { vehicleId })).body.error).toBe("share_not_verified");
    expect((await call("POST", "/api/share/rides", "ama", { vehicleId })).body.error).toBe("share_price_missing");
  });

  it("reserves, starts, ends within the radius of another station, and charges the minutes", async () => {
    const vehicleId = await ready();
    const overview = await call<{ stations: { stationId: string; vehicles: unknown[] }[] }>("GET", "/api/share", null);
    expect(overview.body.stations.map((s) => [s.stationId, s.vehicles.length])).toEqual([
      ["be", 1],
      ["lome", 0],
    ]);

    const reserved = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId, toStationId: "lome", helmet: true });
    expect(reserved.status).toBe(200);
    expect(reserved.body.status).toBe("reserved");
    // The vehicle is taken: nobody else gets it.
    db.exec("insert into share_verifications (user_id, status, id_key, selfie_key) values ('kodjo', 'approved', 'a', 'b')");
    expect((await call("POST", "/api/share/rides", "kodjo", { vehicleId })).body.error).toBe("vehicle_unavailable");

    const started = await call<ShareRide>("POST", `/api/share/rides/${reserved.body.id}/start`, "ama");
    expect(started.body.status).toBe("riding");
    expect(commands).toEqual(["unlock"]);

    // Outside every zone: refused, the ride goes on.
    const outside = await call("POST", `/api/share/rides/${reserved.body.id}/end`, "ama", { lat: 6.135, lng: 1.225 });
    expect(outside.body.error).toBe("outside_share_zone");

    startedMinutesAgo(reserved.body.id, 10);
    const ended = await call<ShareRide>("POST", `/api/share/rides/${reserved.body.id}/end`, "ama", { lat: LOME.lat + 0.0002, lng: LOME.lng });
    expect(ended.body).toMatchObject({ status: "ended", endStationId: "lome", paymentStatus: "unpaid", amountXof: 200 + 10 * 25 });
    expect(commands).toEqual(["unlock", "lock"]);
    expect(db.prepare("select status, station_id from share_vehicles where id = ?").get(vehicleId)).toEqual({ status: "available", station_id: "lome" });

    // Unpaid: no new ride until it is paid.
    expect((await call("POST", "/api/share/rides", "ama", { vehicleId })).body.error).toBe("share_unpaid");
  });

  it("puts a reservation back when its time runs out", async () => {
    const vehicleId = await ready();
    const r = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId });
    db.prepare("update share_rides set reserve_expires_at = ? where id = ?").run(new Date(Date.now() - 1000).toISOString(), r.body.id);
    await runShareTimers(env);
    expect(db.prepare("select status from share_rides where id = ?").get(r.body.id)).toEqual({ status: "cancelled" });
    expect(db.prepare("select status from share_vehicles where id = ?").get(vehicleId)).toEqual({ status: "available" });
  });

  it("takes cash at the station where the ride ended", async () => {
    const vehicleId = await ready();
    const r = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId, start: true });
    startedMinutesAgo(r.body.id, 4);
    await call("POST", `/api/share/rides/${r.body.id}/end`, "ama", BE);
    const tile = await call<{ unpaid: { id: string; amountXof: number }[] }>("GET", "/api/stations/be/share", "afi");
    expect(tile.body.unpaid.map((u) => [u.id, u.amountXof])).toEqual([[r.body.id, 300]]);
    const paid = await call<ShareRide>("POST", `/api/stations/be/share/rides/${r.body.id}/cash`, "afi");
    expect(paid.body).toMatchObject({ paymentStatus: "paid", paidWith: "cash" });
    // Staff of another station see nothing.
    expect((await call("GET", "/api/stations/lome/share", "afi")).status).toBe(403);
  });

  it("pays from Green Credit with the PIN, once", async () => {
    const vehicleId = await ready();
    db.exec(`insert into app_settings (key, value, updated_at) values ('wallet_enabled', '1', '${new Date().toISOString()}')
               on conflict (key) do update set value = '1'`);
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 1000, '2026-01-01', '2026-01-01')`);
    const r = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId, start: true });
    startedMinutesAgo(r.body.id, 8);
    await call("POST", `/api/share/rides/${r.body.id}/end`, "ama", BE);
    const me = await call<ShareMe>("GET", "/api/share/me", "ama");
    expect(me.body.payOptions.wallet).toBe(true);
    expect(me.body.walletBalanceXof).toBe(1000);

    expect((await call("POST", `/api/share/rides/${r.body.id}/pay/wallet`, "ama", { pin: "1111", idempotencyKey: "key-12345" })).status).not.toBe(200);
    const paid = await call<ShareRide>("POST", `/api/share/rides/${r.body.id}/pay/wallet`, "ama", { pin: "2580", idempotencyKey: "key-12345" });
    expect(paid.body).toMatchObject({ paymentStatus: "paid", paidWith: "wallet", amountXof: 400 });
    const again = await call<ShareRide>("POST", `/api/share/rides/${r.body.id}/pay/wallet`, "ama", { pin: "2580", idempotencyKey: "key-67890" });
    expect(again.body.paymentStatus).toBe("paid");
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 600 });
    expect(db.prepare("select type, amount_xof from wallet_transactions where user_id = 'ama'").all()).toEqual([{ type: "trip", amount_xof: 400 }]);
  });

  it("refuses Green Credit that does not cover the ride, and takes nothing", async () => {
    const vehicleId = await ready();
    db.exec(`insert into app_settings (key, value, updated_at) values ('wallet_enabled', '1', '2026-01-01') on conflict (key) do update set value = '1'`);
    db.exec(`insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 100, '2026-01-01', '2026-01-01')`);
    const r = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId, start: true });
    await call("POST", `/api/share/rides/${r.body.id}/end`, "ama", BE);
    const res = await call("POST", `/api/share/rides/${r.body.id}/pay/wallet`, "ama", { pin: "2580", idempotencyKey: "key-12345" });
    expect(res.body.error).toBe("insufficient_balance");
    expect(db.prepare("select balance_xof from wallets where user_id = 'ama'").get()).toEqual({ balance_xof: 100 });
    expect(db.prepare("select payment_status from share_rides where id = ?").get(r.body.id)).toEqual({ payment_status: "unpaid" });
  });

  it("lets an admin end a ride outside any station with the wrong-drop fee", async () => {
    const vehicleId = await ready();
    const r = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId, start: true });
    startedMinutesAgo(r.body.id, 2);
    const ended = await admin<ShareRide>("POST", `/api/admin/share/rides/${r.body.id}/end`, { stationId: null, wrongDrop: true });
    expect(ended.body).toMatchObject({ status: "ended", endStationId: null, amountXof: 200 + 2 * 25 + 1000 });
    expect(db.prepare("select status from share_vehicles where id = ?").get(vehicleId)).toEqual({ status: "lost" });
  });

  it("records tracker pushes: positions on the ride's track, alarms of a parked vehicle once", async () => {
    const vehicleId = await ready();
    const r = await call<ShareRide>("POST", "/api/share/rides", "ama", { vehicleId, start: true });
    await ingestTutrack(env.DB, { deviceId: "1107746", type: "ENT_LOCATOR_POS", payload: { lat: 6.131, lng: 1.221, speed: 22, deviceTime: "2026-10-20 20:00:00" } });
    expect(db.prepare("select lat, at from share_ride_points where ride_id = ?").all(r.body.id)).toEqual([{ lat: 6.131, at: "2026-10-20T12:00:00.000Z" }]);
    await call("POST", `/api/share/rides/${r.body.id}/end`, "ama", BE);
    for (let i = 0; i < 2; i++) await ingestTutrack(env.DB, { deviceId: "1107746", type: "ENT_ALARM", payload: { alarmCode: "SHAKE", alarmDesc: "Vibration" } });
    expect(db.prepare("select kind, ride_id from share_incidents").all()).toEqual([{ kind: "alarm", ride_id: null }]);
    // Unknown trackers are ignored.
    await ingestTutrack(env.DB, { deviceId: "nope", type: "ENT_ALARM", payload: { alarmCode: "SHAKE" } });
  });

  it("keeps the photos private: only admins read them", async () => {
    await ready();
    const key = [...media.keys()][0];
    expect(key).toMatch(/^share\/ama\/id-[\w-]+\.jpg$/);
    expect((await handleApi(new Request(`https://app.poinderecharge.com/api/admin/share-files/${key}`, { headers: { Authorization: "Bearer token-of-ama-0123456789" } }), env)).status).toBe(403);
  });
});

describe("Tutrack", () => {
  it("signs the token request with MD5", () => {
    expect(md5("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5("The quick brown fox jumps over the lazy dog")).toBe("9e107d9d372bb6826bd81d3542a419d6");
  });

  it("reads Beijing time and the device detail", () => {
    expect(tutrackTime("2025-11-24 11:57:59")).toBe("2025-11-24T03:57:59.000Z");
    expect(tutrackTime("2025-11-24T11:57:59Z")).toBe("2025-11-24T11:57:59.000Z");
    expect(statusFromDetail({ deviceStatus: { onlineStatus: 1, powerPercent: 87.4, acc: 0, posInfo: { lat: 6.13, lng: 1.22 } } })).toMatchObject({
      online: true,
      ignition: false,
      batteryPercent: 87,
      lat: 6.13,
    });
    expect(simulatedTracker().name).toBe("simulated");
  });

  it("builds and reads MQTT packets", () => {
    const connect = connectPacket({ clientId: "c", username: "u", password: "p", keepAliveSeconds: 60 });
    expect(connect[0]).toBe(MQTT.CONNECT << 4);
    expect([...subscribePacket(1, "server/ent/1")].slice(0, 2)).toEqual([(MQTT.SUBSCRIBE << 4) | 2, 17]);
    expect([...pubackPacket(258)]).toEqual([MQTT.PUBACK << 4, 2, 1, 2]);
    // A QoS 1 publish split over two chunks.
    const topic = new TextEncoder().encode("t");
    const payload = new TextEncoder().encode('{"a":1}');
    const bytes = new Uint8Array([(MQTT.PUBLISH << 4) | 2, 2 + topic.length + 2 + payload.length, 0, 1, ...topic, 0, 7, ...payload]);
    const reader = new MqttReader();
    expect(reader.push(bytes.slice(0, 4))).toEqual([]);
    const [p] = reader.push(bytes.slice(4));
    expect(readPublish(p)).toEqual({ topic: "t", qos: 1, packetId: 7, payload: '{"a":1}' });
  });
});
