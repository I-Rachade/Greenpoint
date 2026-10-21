import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { signWebhook } from "../src/lib/partners";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { markLabelPrinted, type ParcelCtx } from "./parcels";
import { departRun, receiveParcel, scanRunParcel, startRun } from "./parcel-runs";
import {
  acceptBooking,
  adminPartners,
  createPartnerKey,
  handlePartnerApi,
  revokePartnerKey,
  runPartnerDeadlines,
  runPartnerEvents,
  savePartner,
  stationBookings,
} from "./partners";

// --- A minimal D1 on top of SQLite, with the real migrations -------------------

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
    try {
      const res = this.db.prepare(this.sql).run(...this.params);
      return { success: true, meta: { changes: Number(res.changes) } };
    } catch (err) {
      throw new Error(`D1_ERROR: ${(err as Error).message}`);
    }
  }
}

function fakeD1() {
  const db = new DatabaseSync(":memory:");
  db.exec("pragma foreign_keys = on"); // as in D1
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
  return { db, d1 };
}

const OWN_OPERATOR = "00000000-0000-4000-8000-000000000001";
const ADMIN: Profile = { id: "admin-1", phone: "+22890000001", fullName: null, role: "admin" };

function ctxFor(env: Env, user: Profile): ParcelCtx {
  return {
    env,
    db: env.DB,
    user: async () => user,
    requireUser: async () => user,
    requireAdmin: async () => user,
    isStaffOf: async () => true,
    // The admin works at station A (R7); carry() sets B where it receives.
    request: new Request("https://app.poinderecharge.com/api", { headers: { "X-Active-Station": "st-a" } }),
    audit: (actor, table, action, rowId, changes, ids = {}) =>
      env.DB.prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      ).bind(new Date().toISOString(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes)),
  };
}

async function setup() {
  const { db, d1 } = fakeD1();
  const now = new Date().toISOString();
  db.exec(`
    insert into users (id, phone, role, created_at) values ('admin-1', '+22890000001', 'admin', '${now}');
    insert into stations (id, operator_id, name, lat, lng, kind, created_at) values
      ('st-a', '${OWN_OPERATOR}', 'Station A', 6.1, 1.2, 'both', '${now}'),
      ('st-b', '${OWN_OPERATOR}', 'Station B', 6.2, 1.3, 'both', '${now}'),
      ('st-c', '${OWN_OPERATOR}', 'Sans dépôt', 6.3, 1.3, 'both', '${now}');
    insert into parcel_depots (station_id, is_active, updated_at) values ('st-a', 1, '${now}'), ('st-b', 1, '${now}');
  `);
  const env = { DB: d1 } as unknown as Env;
  const c = ctxFor(env, ADMIN);
  const { id: partnerId } = await savePartner(c, null, {
    name: "Boutique",
    contactEmail: "dev@boutique.tg",
    contactPhone: "90 11 22 33",
    isActive: true,
    webhookUrl: "",
    sharePickupCode: false,
  });
  const { key, id: keyId } = await createPartnerKey(c, partnerId, "serveur");
  const api = (method: string, path: string, body?: unknown, apiKey = key) =>
    handlePartnerApi(
      new Request(`https://app.poinderecharge.com/api/partner/v1${path}`, {
        method,
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      env,
    );
  return { db, env, c, partnerId, key, keyId, api };
}

/** Carries a parcel from st-a to st-b as staff do it (plan phase 7): driver recorded, scanned out and in. */
async function carry(env: Env, db: DatabaseSync, parcel: { id: string; trackingNo: string }) {
  const now = new Date().toISOString();
  if (!db.prepare("select 1 from users where id = 'drv'").get()) {
    db.exec(`
      insert into users (id, phone, role, created_at) values ('drv', '+22893000009', 'driver', '${now}');
      insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at)
        values ('drv', 'active', 'Kodjo', 'ID123', 'LIC123', 'moto', 'ABCDEFGH', '${now}');
    `);
  }
  const at = (station: string): ParcelCtx => ({
    ...ctxFor(env, ADMIN),
    request: new Request("https://app.poinderecharge.com/api", { headers: { "X-Active-Station": station } }),
  });
  await markLabelPrinted(at("st-a"), "st-a", parcel.id);
  const run = await startRun(at("st-a"), "st-a", "ABCDEFGH", [parcel.id]);
  await scanRunParcel(at("st-a"), "st-a", run.id, parcel.trackingNo);
  await departRun(at("st-a"), "st-a", run.id);
  await receiveParcel(at("st-b"), "st-b", parcel.trackingNo);
}

const BOOKING = {
  reference: "CMD-1",
  fromStationId: "st-a",
  toStationId: "st-b",
  recipient: { name: "Afi", phone: "91 23 45 67" },
  parcel: { content: "Chaussures", declaredValue: 15000, lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1 },
};

/** Captures webhook posts; answers with `status`. */
function stubFetch(status = 200) {
  const calls: { url: string; headers: Headers; body: string }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return new Response("ok", { status });
    }),
  );
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe("partner API", () => {
  it("refuses calls without a valid key", async () => {
    const { api } = await setup();
    expect((await api("GET", "/stations", undefined, "")).status).toBe(401);
    const res = await api("GET", "/stations", undefined, "pdr_live_wrong");
    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "invalid_api_key" });
  });

  it("lists depot stations and quotes a price", async () => {
    const { api } = await setup();
    const stations = (await (await api("GET", "/stations")).json()) as { stations: { id: string }[] };
    expect(stations.stations.map((s) => s.id)).toEqual(["st-a", "st-b"]);
    const quote = await (await api("POST", "/quote", { fromStationId: "st-a", toStationId: "st-b", parcel: BOOKING.parcel })).json();
    expect(quote).toEqual({ size: "S", priceFcfa: 200, currency: "XOF" });
  });

  it("checks the booking and names the bad field", async () => {
    const { api } = await setup();
    const phone = await api("POST", "/bookings", { ...BOOKING, recipient: { phone: "+33 6 12 34 56 78" } });
    expect(phone.status).toBe(422);
    expect(await phone.json()).toMatchObject({ error: "phone_not_allowed", field: "recipient.phone" });
    const station = await api("POST", "/bookings", { ...BOOKING, toStationId: "st-c" });
    expect(await station.json()).toMatchObject({ error: "station_not_found", field: "toStationId" });
    // R14: a staff, driver or fleet account cannot receive parcels.
    const staff = await api("POST", "/bookings", { ...BOOKING, recipient: { phone: "90 00 00 01" } });
    expect(staff.status).toBe(422);
    expect(await staff.json()).toMatchObject({ error: "recipient_not_customer", field: "recipient.phone" });
    const heavy = await api("POST", "/bookings", { ...BOOKING, parcel: { ...BOOKING.parcel, weightKg: 80 } });
    expect(await heavy.json()).toMatchObject({ error: "parcel_too_large" });
    expect((await api("POST", "/bookings", { ...BOOKING, reference: "" })).status).toBe(422);
  });

  it("books once per reference", async () => {
    const { api } = await setup();
    const first = await api("POST", "/bookings", BOOKING);
    expect(first.status).toBe(201);
    const booking = (await first.json()) as { id: string; trackingNo: string; status: string; priceFcfa: number; sender: { phone: string } };
    expect(booking).toMatchObject({ status: "booked", priceFcfa: 200, sender: { phone: "+22890112233", name: "Boutique" } });
    const again = await api("POST", "/bookings", BOOKING);
    expect(again.status).toBe(200);
    expect(again.headers.get("Idempotent-Replay")).toBe("true");
    expect(((await again.json()) as { id: string }).id).toBe(booking.id);
    const byTracking = await api("GET", `/bookings/${booking.trackingNo.toLowerCase()}`);
    expect(((await byTracking.json()) as { id: string }).id).toBe(booking.id);
  });

  it("follows the parcel from drop-off to arrival and signs every webhook", async () => {
    const { api, env, c, db } = await setup();
    const calls = stubFetch();
    await api("PUT", "/webhook", { url: "https://boutique.tg/hooks" });
    const { secret } = (await (await api("GET", "/webhook")).json()) as { secret: string };
    const booking = (await (await api("POST", "/bookings", BOOKING)).json()) as { id: string; trackingNo: string };

    expect(await stationBookings(c, "st-a")).toHaveLength(1);
    // Bigger than booked: the measured size and price apply.
    const parcel = await acceptBooking(c, "st-a", booking.id, { lengthCm: 50, widthCm: 30, heightCm: 30, weightKg: 8 });
    expect(parcel).toMatchObject({ trackingNo: booking.trackingNo, size: "L", priceFcfa: 1000, paymentMethod: "partner", paidAt: null });
    expect(await stationBookings(c, "st-a")).toHaveLength(0);
    await expect(acceptBooking(c, "st-a", booking.id, { lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 })).rejects.toThrow("parcel_wrong_status");

    await carry(env, db, parcel);
    await runPartnerEvents(env);

    expect(calls.map((call) => call.headers.get("Poinderecharge-Event"))).toEqual([
      "booking.created",
      "parcel.deposited",
      "parcel.in_transit",
      "parcel.arrived",
    ]);
    for (const call of calls) {
      expect(call.url).toBe("https://boutique.tg/hooks");
      const t = Number(/t=(\d+)/.exec(call.headers.get("Poinderecharge-Signature")!)![1]);
      expect(call.headers.get("Poinderecharge-Signature")).toBe(await signWebhook(secret, t, call.body));
    }
    const arrived = JSON.parse(calls[3].body);
    expect(arrived.data.booking).toMatchObject({ id: booking.id, status: "arrived", priceFcfa: 1000 });
    // The pickup code goes to the partner only when the backoffice allows it.
    expect(arrived.data.booking.pickupCode).toBeUndefined();

    // Nothing is sent twice.
    await runPartnerEvents(env);
    expect(calls).toHaveLength(4);
    expect(db.prepare("select count(*) as n from partner_events where delivered_at is not null").get()).toEqual({ n: 4 });

    const detail = (await (await api("GET", `/bookings/${booking.id}`)).json()) as { history: { status: string }[] };
    expect(detail.history.map((h) => h.status)).toEqual(["booked", "deposited", "in_transit", "arrived"]);
    const events = (await (await api("GET", "/events?limit=2")).json()) as { events: { id: string; type: string }[] };
    expect(events.events.map((e) => e.type)).toEqual(["booking.created", "parcel.deposited"]);
    const rest = (await (await api("GET", `/events?after=${events.events[1].id}`)).json()) as { events: { type: string }[] };
    expect(rest.events.map((e) => e.type)).toEqual(["parcel.in_transit", "parcel.arrived"]);
  });

  it("shares the pickup code when allowed", async () => {
    const { api, env, c, db, partnerId } = await setup();
    await savePartner(c, partnerId, {
      name: "Boutique",
      contactEmail: "",
      contactPhone: "90112233",
      isActive: true,
      webhookUrl: "",
      sharePickupCode: true,
    });
    const booking = (await (await api("POST", "/bookings", BOOKING)).json()) as { id: string };
    const parcel = await acceptBooking(c, "st-a", booking.id, BOOKING.parcel);
    await carry(env, db, parcel);
    await runPartnerEvents(env);
    const detail = (await (await api("GET", `/bookings/${booking.id}`)).json()) as { pickupCode?: string };
    expect(detail.pickupCode).toMatch(/^\d{6}$/);
  });

  it("retries a failed webhook later", async () => {
    const { api, env, db } = await setup();
    stubFetch(500);
    await api("PUT", "/webhook", { url: "https://boutique.tg/hooks" });
    await api("POST", "/bookings", BOOKING);
    await runPartnerEvents(env);
    const row = db.prepare("select attempts, next_attempt_at, last_error from partner_events").get() as {
      attempts: number;
      next_attempt_at: string;
      last_error: string;
    };
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("http_500");
    expect(row.next_attempt_at > new Date().toISOString()).toBe(true);
  });

  it("refuses non-https webhooks", async () => {
    const { api } = await setup();
    const res = await api("PUT", "/webhook", { url: "http://boutique.tg/hooks" });
    expect(await res.json()).toMatchObject({ error: "invalid_request", field: "url" });
  });

  it("cancels only before drop-off, and expires old bookings", async () => {
    const { api, env, db } = await setup();
    const booking = (await (await api("POST", "/bookings", BOOKING)).json()) as { id: string };
    const cancelled = await api("POST", `/bookings/${booking.id}/cancel`);
    expect(await cancelled.json()).toMatchObject({ status: "cancelled" });
    expect((await api("POST", `/bookings/${booking.id}/cancel`)).status).toBe(409);

    const old = (await (await api("POST", "/bookings", { ...BOOKING, reference: "CMD-2" })).json()) as { id: string };
    db.prepare("update partner_bookings set expires_at = ? where id = ?").run(new Date(Date.now() - 1000).toISOString(), old.id);
    await runPartnerDeadlines(env);
    expect(await (await api("GET", `/bookings/${old.id}`)).json()).toMatchObject({ status: "expired" });
    const types = (db.prepare("select type from partner_events order by rowid").all() as { type: string }[]).map((r) => r.type);
    expect(types).toEqual(["booking.created", "booking.cancelled", "booking.created", "booking.expired"]);
  });

  it("stops a revoked key and shows partners in the backoffice", async () => {
    const { api, c, partnerId, keyId } = await setup();
    await api("POST", "/bookings", BOOKING);
    const { partners } = await adminPartners(c);
    expect(partners[0]).toMatchObject({ name: "Boutique", openBookings: 1, keys: [{ id: keyId, label: "serveur" }] });
    expect(partners[0].keys[0].lastUsedAt).not.toBeNull();
    await revokePartnerKey(c, partnerId, keyId);
    expect((await api("GET", "/stations")).status).toBe(401);
  });

  it("only keeps a hash of the key", async () => {
    const { db, key } = await setup();
    const row = db.prepare("select prefix, key_hash from partner_api_keys").get() as { prefix: string; key_hash: string };
    expect(key.startsWith(row.prefix)).toBe(true);
    expect(row.key_hash).not.toContain(key);
  });
});
