import { beforeAll, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { handleApi } from "./api";
import { hashPin } from "./auth";
import type { Env } from "./env";
import { runDispatch } from "./drivers";
import { sha256 } from "./http";
import { fakeD1 } from "./test-d1";
import type { DeliveryJob } from "../src/lib/drivers";
import type { DriverShops, MerchantAddress, MerchantDriver, MerchantInvite, MerchantStats, MerchantView } from "../src/lib/merchants";
import type { Profile } from "../src/lib/types";

// Merchants (planung/marchand.md): registration and approval, the team with its limit, shop
// bookings seen by every member, favorite and assigned drivers with approval, check-in and
// check-out, the hourly pay (decision A), suspension and the automatic check-out.

const OWN = "00000000-0000-4000-8000-000000000001";
const PIN = "2580";
const T = new Date().toISOString();
const LATER = "2099-01-01T00:00:00.000Z";
const SHOP = { lat: 6.1319, lng: 1.2228 };
const USERS = [
  ["admin", "+22890000001", "admin"],
  ["ama", "+22890000003", "rider"], // money in the wallet
  ["kofi", "+22890000004", "driver"],
  ["kodjo", "+22890000005", "driver"],
  ["edem", "+22890000007", "fleet_manager"], // kofi's fleet
  ["kwame", "+22890000009", "fleet_manager"],
  ["esi", "+22891000001", "rider"], // empty customer accounts, invitable
  ["yao", "+22891000002", "rider"],
  ["akos", "+22891000003", "rider"],
  ["selom", "+22891000004", "rider"],
] as const;

let pinHash = "";
beforeAll(async () => {
  pinHash = await hashPin(PIN);
});

async function setup() {
  const { db, d1 } = fakeD1();
  const env = { DB: d1, MEDIA: { put: async () => {}, delete: async () => {} }, TEST_OTP: "+22897000001=123456" } as unknown as Env;
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
    insert into fleets (manager_id, name, status, tier, created_at) values ('edem', 'Flotte Edem', 'approved', 'standard', '${T}'), ('kwame', 'Flotte Kwame', 'approved', 'standard', '${T}');
    insert into fleet_manager_drivers (driver_id, manager_id, created_at) values ('kofi', 'edem', '${T}');
    insert into wallets (user_id, balance_xof, created_at, updated_at) values ('ama', 5000, '${T}', '${T}');
  `);
  return { db, env };
}

async function call<B = unknown>(env: Env, as: string | null, method: string, path: string, body?: unknown, token?: string) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (as || token) headers.Authorization = `Bearer ${token ?? `token-of-${as}-0123456789`}`;
  const res = await handleApi(
    new Request(`https://app.poinderecharge.com${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
    env,
  );
  return { status: res.status, body: (await res.json()) as B };
}

const role = (db: DatabaseSync, id: string) => (db.prepare("select role from users where id = ?").get(id) as { role: string }).role;

/** Registers "Boutique Afi" (pending) and returns the merchant's token and the shop id. */
async function register(env: Env, db: DatabaseSync) {
  expect((await call(env, null, "POST", "/api/auth/send", { contact: "97000001" })).status).toBe(200);
  const res = await call<{ token: string; profile: Profile }>(env, null, "POST", "/api/auth/register-merchant", {
    contact: "97 00 00 01",
    code: "123456",
    pin: PIN,
    shop: { name: "  Boutique   Afi ", phone: "90 11 22 33", address: "Rue du marché, Bè", ...SHOP },
  });
  expect(res.body).toHaveProperty("token");
  const shop = db.prepare("select id from merchants").get() as { id: string };
  return { token: res.body.token, profile: res.body.profile, shopId: shop.id };
}

/** A registered and approved shop. */
async function approvedShop(env: Env, db: DatabaseSync) {
  const r = await register(env, db);
  expect((await call(env, "admin", "POST", `/api/admin/merchants/${r.shopId}/review`, { action: "approve" })).status).toBe(200);
  return r;
}

const COURIER = {
  pickup: { ...SHOP, note: "Boutique", phone: "90 11 22 33" },
  dropoff: { lat: 6.14, lng: 1.23, note: "Maison bleue" },
  recipientPhone: "93 00 00 01",
  recipientName: "Client",
  content: "Robe",
  size: "S",
};

describe("merchant registration and approval", () => {
  it("registers a merchant account with a pending shop; nothing but the map until approved", async () => {
    const { env, db } = await setup();
    const { token, profile, shopId } = await register(env, db);
    expect(profile).toMatchObject({ role: "merchant", merchant: { id: shopId, name: "Boutique Afi", status: "pending", isOwner: true } });
    expect(db.prepare("select name, phone, status, tier from merchants").get()).toEqual({ name: "Boutique Afi", phone: "+22890112233", status: "pending", tier: "standard" });
    const view = await call<MerchantView>(env, null, "GET", "/api/merchant", undefined, token);
    expect(view.body).toMatchObject({ isOwner: true, merchant: { status: "pending" }, live: [], members: [] });
    expect((await call(env, null, "POST", "/api/jobs/courier", COURIER, token)).body).toEqual({ error: "merchant_not_approved" });
    expect((await call(env, null, "POST", "/api/merchant/invites", { phone: "91000001" }, token)).body).toEqual({ error: "merchant_not_approved" });
    // Merchants are not customers (R11).
    expect((await call(env, null, "GET", "/api/wallet", undefined, token)).status).toBe(403);
    expect((await call(env, null, "POST", "/api/reservations", { stationId: "st", type: "battery" }, token)).status).toBe(403);
    expect((await call(env, null, "GET", "/api/greenpoint", undefined, token)).status).toBe(403);
    // A number that has an account already is refused (W5); an address outside the area too.
    await call(env, null, "POST", "/api/auth/send", { contact: "97000001" });
    const again = await call(env, null, "POST", "/api/auth/register-merchant", {
      contact: "97000001",
      code: "123456",
      pin: PIN,
      shop: { name: "Autre", phone: "90112233", address: "Bè", ...SHOP },
    });
    expect(again.body).toEqual({ error: "account_exists" });
    // Only an admin approves.
    expect((await call(env, "ama", "POST", `/api/admin/merchants/${shopId}/review`, { action: "approve" })).status).toBe(403);
    await call(env, "admin", "POST", `/api/admin/merchants/${shopId}/review`, { action: "approve" });
    const me = await call<Profile>(env, null, "GET", "/api/me", undefined, token);
    expect(me.body.merchant?.status).toBe("approved");
  });

  it("books a courier for the shop, with who booked it, cash at the start", async () => {
    const { env, db } = await setup();
    const { token, shopId, profile } = await approvedShop(env, db);
    const job = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    expect(job.status).toBe(200);
    expect(job.body.customerName).toBe("Boutique Afi");
    expect(db.prepare("select merchant_id, booked_by from delivery_jobs where id = ?").get(job.body.id)).toEqual({ merchant_id: shopId, booked_by: profile.id });
    // A ride for someone else: the passenger's name is what the driver sees, several at once.
    const ride = { pickup: COURIER.pickup, dropoff: COURIER.dropoff, passengers: 1, passengerName: "Mme Akpe" };
    expect((await call<DeliveryJob>(env, null, "POST", "/api/jobs/ride", ride, token)).body.customerName).toBe("Mme Akpe");
    expect((await call(env, null, "POST", "/api/jobs/ride", ride, token)).status).toBe(200);
    // A merchant number cannot receive a parcel (R14).
    expect((await call(env, "ama", "POST", "/api/jobs/courier", { ...COURIER, recipientPhone: "97000001" })).body).toEqual({ error: "recipient_not_customer" });
  });
});

describe("the shop's team", () => {
  it("invites employees up to the limit; an employee books and sees all the shop's trips but has no backoffice", async () => {
    const { env, db } = await setup();
    const { token } = await approvedShop(env, db);
    const invite = (phone: string) => call<MerchantInvite>(env, null, "POST", "/api/merchant/invites", { phone }, token);
    expect((await invite("90000003")).body).toEqual({ error: "invite_account_not_empty" }); // ama has money
    expect((await invite("90000004")).body).toEqual({ error: "invite_number_taken" }); // a driver
    const esi = await invite("91000001");
    expect(esi.status).toBe(200);
    await invite("91000002");
    await invite("91000003");
    // B: 3 employees plus the merchant.
    expect((await invite("91000004")).body).toEqual({ error: "merchant_limit" });

    const mine = await call<{ token: string; merchantName: string }[]>(env, "esi", "GET", "/api/merchant-invites");
    expect(mine.body).toMatchObject([{ merchantName: "Boutique Afi" }]);
    expect((await call(env, "esi", "POST", `/api/merchant-invites/${esi.body.token}/accept`)).status).toBe(200);
    expect(role(db, "esi")).toBe("merchant");

    const booked = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    const seen = await call<DeliveryJob[]>(env, "esi", "GET", "/api/jobs/mine");
    expect(seen.body.map((j) => j.id)).toEqual([booked.body.id]);
    const view = await call<MerchantView>(env, "esi", "GET", "/api/merchant");
    expect(view.body).toMatchObject({ isOwner: false, members: [], live: [{ id: booked.body.id, bookedBy: { name: "Boutique Afi" } }] });
    expect((await call(env, "esi", "POST", "/api/merchant/invites", { phone: "91000004" })).status).toBe(403);
    expect((await call(env, "esi", "GET", "/api/merchant/activity")).status).toBe(403);
    // Any member cancels the shop's trips.
    expect((await call(env, "esi", "POST", `/api/jobs/${booked.body.id}/cancel`)).status).toBe(200);

    // The merchant takes the employee out: a customer again. The merchant cannot be removed.
    const owner = (await call<MerchantView>(env, null, "GET", "/api/merchant", undefined, token)).body;
    expect(owner.members.map((m) => m.isOwner)).toEqual([true, false]);
    expect((await call(env, null, "POST", `/api/merchant/members/${owner.merchant.ownerId}/remove`, undefined, token)).status).toBe(403);
    expect((await call(env, null, "POST", "/api/merchant/members/esi/remove", undefined, token)).status).toBe(200);
    expect(role(db, "esi")).toBe("rider");
    const log = await call<{ table: string }[]>(env, null, "GET", "/api/merchant/activity", undefined, token);
    expect(log.body.map((a) => a.table)).toEqual(expect.arrayContaining(["merchant_invites", "merchant_members", "delivery_jobs"]));
  });
});

describe("drivers of the shop", () => {
  it("assigns a driver at an hourly rate: approval, check-in near the shop, only shop trips, no fare share, check-out", async () => {
    const { env, db } = await setup();
    const { token, shopId } = await approvedShop(env, db);
    const added = await call<MerchantDriver>(env, null, "POST", "/api/merchant/drivers", { kind: "assigned", driver: "ABCD-EFGH", payMode: "hourly", ratePerHourFcfa: 1000 }, token);
    expect(added.body).toMatchObject({ status: "pending", payMode: "hourly", ratePerHourFcfa: 1000, driverName: "Kofi" });
    expect((await call(env, null, "POST", "/api/merchant/drivers", { kind: "assigned", driver: "90000004", payMode: "per_trip" }, token)).body).toEqual({
      error: "merchant_driver_exists",
    });
    // Not before it is approved; another fleet's manager cannot approve.
    expect((await call(env, "kofi", "POST", `/api/driver/shops/${shopId}/checkin`, { position: SHOP })).body).toEqual({ error: "not_assigned" });
    expect((await call(env, "kwame", "POST", `/api/merchant-assignments/${added.body.id}/approve`)).status).toBe(404);
    const requests = await call<{ id: string }[]>(env, "edem", "GET", "/api/merchant-assignments");
    expect(requests.body.map((r) => r.id)).toEqual([added.body.id]);
    expect((await call(env, "edem", "POST", `/api/merchant-assignments/${added.body.id}/approve`)).status).toBe(200);
    expect(db.prepare("select status, approved_as from merchant_drivers").get()).toEqual({ status: "active", approved_as: "fleet_manager" });

    expect((await call(env, "kofi", "POST", `/api/driver/shops/${shopId}/checkin`, { position: { lat: 6.17, lng: 1.21 } })).body).toEqual({ error: "too_far" });
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    expect((await call(env, "kofi", "POST", `/api/driver/shops/${shopId}/checkin`, { position: SHOP })).status).toBe(200);
    expect(db.prepare("select count(*) as n from driver_queue where driver_id = 'kofi'").get()).toEqual({ n: 0 });
    expect((await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP })).body).toEqual({ error: "checked_in_at_shop" });
    // Pay changes wait until the driver checked out.
    expect((await call(env, null, "POST", `/api/merchant/drivers/${added.body.id}/pay`, { payMode: "per_trip" }, token)).body).toEqual({ error: "driver_checked_in_here" });

    // A customer's trip does not go to the checked-in driver; the shop's does.
    const other = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    const trip = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    expect(db.prepare("select status, driver_id from delivery_jobs where id = ?").get(other.body.id)).toEqual({ status: "open", driver_id: null });
    expect(db.prepare("select status, driver_id, driver_station_id from delivery_jobs where id = ?").get(trip.body.id)).toEqual({
      status: "assigned",
      driver_id: "kofi",
      driver_station_id: null,
    });
    // Nobody hands them other trips.
    expect((await call(env, "admin", "POST", `/api/admin/jobs/${other.body.id}/assign`, { driverId: "kofi" })).body).toEqual({ error: "driver_busy" });

    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/accept`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/board`);
    expect((await call(env, "kofi", "POST", "/api/driver/shops/checkout")).body).toEqual({ error: "driver_busy" });
    const code = (db.prepare("select handover_code from delivery_jobs where id = ?").get(trip.body.id) as { handover_code: string }).handover_code;
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/finish`, { code })).status).toBe(200);
    // Decision A: the fare was collected at the start and is ours; no 55 % share.
    const ledger = db.prepare("select kind, amount_fcfa from driver_ledger where driver_id = 'kofi' order by at").all() as { kind: string }[];
    expect(ledger.map((l) => l.kind)).toEqual(["collected"]);
    // Still checked in after the trip; with no other job, handJob refuses (checked in elsewhere).
    expect((await call(env, "admin", "POST", `/api/admin/jobs/${other.body.id}/assign`, { driverId: "kofi" })).body).toEqual({ error: "driver_checked_in" });

    db.exec("update merchant_checkins set in_at = datetime('now', '-2 hours') || '.000Z'");
    db.exec("update merchant_checkins set in_at = replace(in_at, ' ', 'T')");
    expect((await call(env, "kofi", "POST", "/api/driver/shops/checkout")).status).toBe(200);
    const shops = await call<DriverShops>(env, "kofi", "GET", "/api/driver/shops");
    expect(shops.body.checkin).toBeNull();
    expect(shops.body.unpaid).toHaveLength(1);
    expect(shops.body.unpaid[0].amountFcfa).toBeGreaterThanOrEqual(1995);
    expect(shops.body.unpaid[0].amountFcfa).toBeLessThanOrEqual(2005);
    expect((await call<MerchantView>(env, null, "GET", "/api/merchant", undefined, token)).body.unpaid).toHaveLength(1);
    expect((await call(env, "kofi", "POST", `/api/driver/shops/hours/${shops.body.unpaid[0].id}/received`)).status).toBe(200);
    expect((await call<DriverShops>(env, "kofi", "GET", "/api/driver/shops")).body.unpaid).toEqual([]);
    // After check-out: a normal driver again.
    expect((await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP })).status).toBe(200);
  });

  it("pays per trip as usual, and the shop can check a driver out", async () => {
    const { env, db } = await setup();
    const { token, shopId } = await approvedShop(env, db);
    const added = await call<MerchantDriver>(env, null, "POST", "/api/merchant/drivers", { kind: "assigned", driver: "90000005", payMode: "per_trip" }, token);
    expect((await call(env, "kofi", "POST", `/api/merchant-assignments/${added.body.id}/approve`)).status).toBe(404); // not their assignment
    await call(env, "kodjo", "POST", `/api/merchant-assignments/${added.body.id}/approve`);
    await call(env, "kodjo", "POST", `/api/driver/shops/${shopId}/checkin`, { position: SHOP });
    const trip = await call<DeliveryJob>(env, null, "POST", "/api/jobs/ride", { pickup: COURIER.pickup, dropoff: COURIER.dropoff, passengers: 1 }, token);
    await call(env, "kodjo", "POST", `/api/driver/jobs/${trip.body.id}/accept`);
    await call(env, "kodjo", "POST", `/api/driver/jobs/${trip.body.id}/board`);
    await call(env, "kodjo", "POST", `/api/driver/jobs/${trip.body.id}/finish`);
    const ledger = db.prepare("select kind from driver_ledger where driver_id = 'kodjo' order by at, kind").all() as { kind: string }[];
    // A shop ride is paid at the start, like a courier.
    expect(ledger.map((l) => l.kind).sort()).toEqual(["collected", "earning"]);
    expect((await call(env, null, "POST", "/api/merchant/drivers/kodjo/checkout", undefined, token)).status).toBe(200);
    expect(db.prepare("select out_by, amount_fcfa from merchant_checkins").get()).toEqual({ out_by: "merchant", amount_fcfa: null });
  });

  it("offers a shop's trip to its favorite in the queue first", async () => {
    const { env, db } = await setup();
    const { token } = await approvedShop(env, db);
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    await call(env, "kodjo", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    expect((await call<MerchantDriver>(env, null, "POST", "/api/merchant/drivers", { kind: "favorite", driver: "HGFEDCBA" }, token)).body).toMatchObject({
      status: "active",
      kind: "favorite",
    });
    const trip = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    expect(db.prepare("select driver_id from delivery_jobs where id = ?").get(trip.body.id)).toEqual({ driver_id: "kodjo" });
    // A customer's trip goes to the first in line as always.
    const other = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    expect(db.prepare("select driver_id from delivery_jobs where id = ?").get(other.body.id)).toEqual({ driver_id: "kofi" });
  });

  it("suspending checks the drivers out and calls off trips nobody has started", async () => {
    const { env, db } = await setup();
    const { token, shopId } = await approvedShop(env, db);
    const added = await call<MerchantDriver>(env, null, "POST", "/api/merchant/drivers", { kind: "assigned", driver: "90000005", payMode: "per_trip" }, token);
    await call(env, "admin", "POST", `/api/merchant-assignments/${added.body.id}/approve`);
    await call(env, "kodjo", "POST", `/api/driver/shops/${shopId}/checkin`, { position: SHOP });
    const trip = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    expect((await call(env, "admin", "POST", `/api/admin/merchants/${shopId}/review`, { action: "suspend" })).status).toBe(200);
    expect(db.prepare("select status from delivery_jobs where id = ?").get(trip.body.id)).toEqual({ status: "cancelled" });
    expect(db.prepare("select out_by from merchant_checkins").get()).toEqual({ out_by: "admin" });
    expect((await call(env, null, "POST", "/api/jobs/courier", COURIER, token)).body).toEqual({ error: "merchant_not_approved" });
    expect((await call(env, "admin", "POST", `/api/admin/merchants/${shopId}/review`, { action: "reactivate" })).status).toBe(200);
    expect((await call(env, null, "POST", "/api/jobs/courier", COURIER, token)).status).toBe(200);
  });

  it("checks out at the end of the day a driver who forgot", async () => {
    const { env, db } = await setup();
    const { token, shopId } = await approvedShop(env, db);
    const added = await call<MerchantDriver>(env, null, "POST", "/api/merchant/drivers", { kind: "assigned", driver: "90000005", payMode: "hourly", ratePerHourFcfa: 500 }, token);
    await call(env, "kodjo", "POST", `/api/merchant-assignments/${added.body.id}/approve`);
    await call(env, "kodjo", "POST", `/api/driver/shops/${shopId}/checkin`, { position: SHOP });
    const yesterday = new Date(Date.now() - 86_400_000);
    yesterday.setUTCHours(20, 0, 0, 0);
    db.prepare("update merchant_checkins set in_at = ?").run(yesterday.toISOString());
    await runDispatch(env);
    const row = db.prepare("select out_at, out_by, amount_fcfa from merchant_checkins").get() as { out_at: string; out_by: string; amount_fcfa: number };
    expect(row.out_by).toBe("auto");
    expect(row.out_at.slice(11)).toBe("23:59:59.999Z");
    expect(row.amount_fcfa).toBe(2000); // 4 hours at 500
  });
});

describe("the admin's Merchants page", () => {
  it("lists shops with their team and sets the tier and the owner", async () => {
    const { env, db } = await setup();
    const { token, shopId } = await approvedShop(env, db);
    const esi = await call<MerchantInvite>(env, null, "POST", "/api/merchant/invites", { phone: "91000001" }, token);
    await call(env, "esi", "POST", `/api/merchant-invites/${esi.body.token}/accept`);
    const list = await call<{ id: string; members: { userId: string }[]; used: number }[]>(env, "admin", "GET", "/api/admin/merchants");
    expect(list.body[0]).toMatchObject({ id: shopId, used: 1 });
    expect(list.body[0].members).toHaveLength(2);
    expect((await call(env, "admin", "POST", `/api/admin/merchants/${shopId}/tier`, { tier: "unlocked" })).status).toBe(200);
    expect((await call(env, "admin", "POST", `/api/admin/merchants/${shopId}/owner`, { userId: "esi" })).status).toBe(200);
    expect((await call<MerchantView>(env, "esi", "GET", "/api/merchant")).body.isOwner).toBe(true);
    expect((await call<MerchantView>(env, null, "GET", "/api/merchant", undefined, token)).body.isOwner).toBe(false);
    // An admin cannot turn a merchant account into another role from the users page.
    expect((await call(env, "admin", "POST", "/api/admin/users/esi/role", { role: "customer" })).body).toEqual({ error: "has_other_role" });
  });
});

describe("deleting the merchant's account", () => {
  it("removes the shop and makes its employees customers again", async () => {
    const { env, db } = await setup();
    const { token } = await approvedShop(env, db);
    const esi = await call<MerchantInvite>(env, null, "POST", "/api/merchant/invites", { phone: "91000001" }, token);
    await call(env, "esi", "POST", `/api/merchant-invites/${esi.body.token}/accept`);
    expect((await call(env, null, "POST", "/api/auth/delete-account", { pin: PIN }, token)).status).toBe(200);
    expect(db.prepare("select count(*) as n from merchants").get()).toEqual({ n: 0 });
    expect(role(db, "esi")).toBe("rider");
  });
});

describe("merchants phase 2", () => {
  it("brings a courier back to the shop when the recipient is absent; the shop confirms", async () => {
    const { env, db } = await setup();
    const { token, profile } = await approvedShop(env, db);
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    const trip = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/accept`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/board`);
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/door`)).status).toBe(200);
    // The shop still sees the code to pass on while the driver waits at the door.
    const live = await call<MerchantView>(env, null, "GET", "/api/merchant", undefined, token);
    expect(live.body.live[0]).toMatchObject({ status: "at_door", handoverCode: expect.stringMatching(/^\d{6}$/) });
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/absent`)).body).toEqual({ error: "wait_longer" });
    db.prepare("update delivery_jobs set at_door_at = '2020-01-01T00:00:00.000Z' where id = ?").run(trip.body.id);
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/absent`)).status).toBe(200);
    expect(db.prepare("select status from delivery_jobs where id = ?").get(trip.body.id)).toEqual({ status: "returning" });
    // Nobody else confirms the return: not the driver, not a customer, not another shop.
    expect((await call(env, "kofi", "POST", `/api/merchant/jobs/${trip.body.id}/returned`)).status).toBe(403);
    expect((await call(env, "ama", "POST", `/api/merchant/jobs/${trip.body.id}/returned`)).status).toBe(403);
    expect((await call(env, null, "POST", `/api/merchant/jobs/${trip.body.id}/returned`, undefined, token)).status).toBe(200);
    expect(db.prepare("select status, done_at is not null as done from delivery_jobs where id = ?").get(trip.body.id)).toEqual({ status: "failed", done: 1 });
    // Paid at the start; the driver keeps their share of the fare.
    const ledger = db.prepare("select kind from driver_ledger where driver_id = 'kofi' and job_id = ?").all(trip.body.id) as { kind: string }[];
    expect(ledger.map((l) => l.kind).sort()).toEqual(["collected", "earning"]);
    expect((await call(env, null, "POST", `/api/merchant/jobs/${trip.body.id}/returned`, undefined, token)).body).toEqual({ error: "job_wrong_status" });
    const log = db.prepare("select actor from audit_log where table_name = 'delivery_jobs' and row_id = ? and changes like '%returned_to_shop%'").get(trip.body.id);
    expect(log).toEqual({ actor: profile.id });
  });

  it("delivers a shop courier from the door with the recipient's code", async () => {
    const { env, db } = await setup();
    const { token } = await approvedShop(env, db);
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    const trip = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/accept`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/board`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/door`);
    const { handover_code } = db.prepare("select handover_code from delivery_jobs where id = ?").get(trip.body.id) as { handover_code: string };
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${trip.body.id}/finish`, { code: handover_code })).status).toBe(200);
    expect(db.prepare("select status from delivery_jobs where id = ?").get(trip.body.id)).toEqual({ status: "done" });
    // A customer's courier has no door step (unchanged).
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    const other = await call<DeliveryJob>(env, "yao", "POST", "/api/jobs/courier", COURIER);
    await call(env, "kofi", "POST", `/api/driver/jobs/${other.body.id}/accept`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${other.body.id}/board`);
    expect((await call(env, "kofi", "POST", `/api/driver/jobs/${other.body.id}/door`)).body).toEqual({ error: "job_wrong_status" });
  });

  it("saves pickup addresses for every member, up to the limit; only the merchant changes them", async () => {
    const { env, db } = await setup();
    const { token } = await approvedShop(env, db);
    const place = { label: " Entrepôt ", address: "Zone portuaire", phone: "90 11 22 44", ...SHOP };
    const saved = await call<MerchantAddress>(env, null, "POST", "/api/merchant/addresses", place, token);
    expect(saved.body).toMatchObject({ label: "Entrepôt", phone: "+22890112244" });
    expect((await call(env, null, "POST", "/api/merchant/addresses", { ...place, label: "x" }, token)).body).toEqual({ error: "bad_request" });
    expect((await call(env, null, "POST", "/api/merchant/addresses", { ...place, lat: 48.1, lng: 11.5 }, token)).body).toEqual({ error: "outside_area" });
    for (let i = 1; i < 10; i++) await call(env, null, "POST", "/api/merchant/addresses", { ...place, label: `Dépôt ${i}` }, token);
    expect((await call(env, null, "POST", "/api/merchant/addresses", place, token)).body).toEqual({ error: "address_limit" });
    // An employee sees them, cannot change them.
    const invite = await call<MerchantInvite>(env, null, "POST", "/api/merchant/invites", { phone: "91000001" }, token);
    await call(env, "esi", "POST", `/api/merchant-invites/${invite.body.token}/accept`);
    const view = await call<MerchantView>(env, "esi", "GET", "/api/merchant");
    expect(view.body.addresses).toHaveLength(10);
    expect((await call(env, "esi", "DELETE", `/api/merchant/addresses/${saved.body.id}`)).status).toBe(403);
    expect((await call(env, null, "DELETE", `/api/merchant/addresses/${saved.body.id}`, undefined, token)).status).toBe(200);
    expect((await call<MerchantView>(env, null, "GET", "/api/merchant", undefined, token)).body.addresses).toHaveLength(9);
  });

  it("shows statistics to the merchant of an unlocked shop only", async () => {
    const { env, db } = await setup();
    const { token, shopId, profile } = await approvedShop(env, db);
    const day = new Date().toISOString().slice(0, 10);
    const query = { from: day, to: day, group: "day" };
    expect((await call(env, null, "POST", "/api/merchant/stats", query, token)).body).toEqual({ error: "merchant_locked" });
    await call(env, "admin", "POST", `/api/admin/merchants/${shopId}/tier`, { tier: "unlocked" });
    expect((await call(env, null, "POST", "/api/merchant/stats", { ...query, group: "year" }, token)).body).toEqual({ error: "bad_request" });
    await call(env, "kofi", "POST", "/api/driver/queue", { stationId: "st", position: SHOP });
    const done = await call<DeliveryJob>(env, null, "POST", "/api/jobs/ride", { pickup: COURIER.pickup, dropoff: COURIER.dropoff, passengers: 1 }, token);
    await call(env, "kofi", "POST", `/api/driver/jobs/${done.body.id}/accept`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${done.body.id}/board`);
    await call(env, "kofi", "POST", `/api/driver/jobs/${done.body.id}/finish`);
    const cancelled = await call<DeliveryJob>(env, null, "POST", "/api/jobs/courier", COURIER, token);
    await call(env, null, "POST", `/api/jobs/${cancelled.body.id}/cancel`, undefined, token);
    const stats = await call<MerchantStats>(env, null, "POST", "/api/merchant/stats", query, token);
    expect(stats.status).toBe(200);
    expect(stats.body.totals).toMatchObject({ booked: 2, done: 1, cancelled: 1, failed: 0, spendFcfa: done.body.fareFcfa, successRate: 1 });
    expect(stats.body.periods).toEqual([{ key: day, booked: 2, done: 1, failed: 0, cancelled: 1, spendFcfa: done.body.fareFcfa }]);
    expect(stats.body.employees).toEqual([{ userId: profile.id, name: expect.any(String), booked: 2, done: 1, failed: 0, cancelled: 1, spendFcfa: done.body.fareFcfa }]);
    // Employees have no backoffice.
    const invite = await call<MerchantInvite>(env, null, "POST", "/api/merchant/invites", { phone: "91000001" }, token);
    await call(env, "esi", "POST", `/api/merchant-invites/${invite.body.token}/accept`);
    expect((await call(env, "esi", "POST", "/api/merchant/stats", query)).status).toBe(403);
  });
});
