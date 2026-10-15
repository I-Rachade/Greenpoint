import { parseContact } from "../src/lib/contact";
import {
  dayStart,
  levelFor,
  MAX_EARNINGS_PER_DAY,
  nextLevel,
  parseFactors,
  pointsFor,
  REDEEM_CODE_MINUTES,
  rewardAvailable,
  treesFor,
  tripGrams,
  validFactors,
  validRewardInput,
  type AdminGreenpoint,
  type GreenpointEntry,
  type GreenpointFactors,
  type GreenpointKind,
  type GreenpointReceipt,
  type GreenpointRedemption,
  type GreenpointReward,
  type GreenpointView,
} from "../src/lib/greenpoint";
import { offersCharging, offersSwap } from "../src/lib/availability";
import type { FleetVehicleType } from "../src/lib/drivers";
import { VEHICLE_TYPES, type Profile, type ReservationType, type VehicleType } from "../src/lib/types";
import { personLabel } from "../src/lib/wallet";
import type { Env } from "./env";
import { ApiError, nowIso, randomDigits, readJson, uuid } from "./http";

// greenpoint: CO2 saved and points for rewards. Every movement is a row in
// greenpoint_ledger; the balance and the CO2 total are sums over it. Rules:
// planung/greenpoint-nutzung.md, shared logic: src/lib/greenpoint.ts.

interface LedgerRow {
  id: string;
  kind: GreenpointKind;
  co2_grams: number;
  points: number;
  vehicle: VehicleType | null;
  station_name: string | null;
  reward_title: string | null;
  created_at: string;
}

interface RewardRow {
  id: string;
  title: string;
  description: string;
  cost_points: number;
  provider: "network" | "partner";
  partner_name: string | null;
  stock: number | null;
  valid_until: string | null;
  is_active: number;
}

interface RedemptionRow {
  id: string;
  user_id: string;
  reward_id: string;
  code: string;
  cost_points: number;
  expires_at: string;
  reward_title: string;
}

const HISTORY_LIMIT = 50;
const ADMIN_RECENT_LIMIT = 100;

const LEDGER_SELECT = `
  select l.id, l.kind, l.co2_grams, l.points, l.vehicle, l.created_at, s.name as station_name, r.title as reward_title
  from greenpoint_ledger l
  left join stations s on s.id = l.station_id
  left join greenpoint_redemptions d on d.id = l.redemption_id
  left join greenpoint_rewards r on r.id = d.reward_id`;

function toEntry(r: LedgerRow): GreenpointEntry {
  return {
    id: r.id,
    kind: r.kind,
    co2Grams: r.co2_grams,
    points: r.points,
    vehicle: r.vehicle,
    stationName: r.station_name,
    rewardTitle: r.reward_title,
    createdAt: r.created_at,
  };
}

function toReward(r: RewardRow): GreenpointReward {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    costPoints: r.cost_points,
    provider: r.provider,
    partnerName: r.partner_name,
    stock: r.stock,
    validUntil: r.valid_until,
    isActive: !!r.is_active,
  };
}

export async function getFactors(db: D1Database): Promise<GreenpointFactors> {
  const row = await db.prepare("select value from app_settings where key = 'greenpoint_factors'").first<{ value: string }>();
  return parseFactors(row?.value);
}

async function totals(db: D1Database, userId: string) {
  const row = await db
    .prepare("select coalesce(sum(co2_grams), 0) as grams, coalesce(sum(points), 0) as points from greenpoint_ledger where user_id = ?")
    .bind(userId)
    .first<{ grams: number; points: number }>();
  return { grams: row?.grams ?? 0, points: row?.points ?? 0 };
}

async function vehicleOf(db: D1Database, userId: string): Promise<VehicleType> {
  const row = await db.prepare("select greenpoint_vehicle from users where id = ?").bind(userId).first<{ greenpoint_vehicle: VehicleType | null }>();
  return row?.greenpoint_vehicle ?? "scooter";
}

async function earnedToday(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare("select count(*) as n from greenpoint_ledger where user_id = ? and kind in ('swap', 'charge', 'visit') and created_at >= ?")
    .bind(userId, dayStart())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/**
 * Only stations the admin marked as solar give greenpoints for swaps and charges
 * (decided 2026-10-14). Missing station = not solar.
 */
async function isSolarStation(db: D1Database, stationId: string): Promise<boolean> {
  const row = await db.prepare("select is_solar from stations where id = ?").bind(stationId).first<{ is_solar: number }>();
  return !!row?.is_solar;
}

/** Station staff (role operator) have no greenpoints: they earn nothing and have no balance. */
async function isStationStaff(db: D1Database, userId: string): Promise<boolean> {
  const row = await db.prepare("select 1 from users where id = ? and role = 'operator'").bind(userId).first();
  return !!row;
}

function refuseStationStaff(user: Profile) {
  if (user.role === "operator") throw new ApiError("forbidden", 403);
}

/**
 * Drivers on one of our vehicles earn per km instead (tripStatement); swaps and
 * charges of their account would count the same battery twice.
 */
async function drivesFleetVehicle(db: D1Database, userId: string): Promise<boolean> {
  const row = await db
    .prepare("select 1 from drivers where user_id = ? and status = 'active' and vehicle_id is not null")
    .bind(userId)
    .first();
  return !!row;
}

/**
 * The ledger row for a driver's finished trip: CO2 per km by the vehicle they drive.
 * Callers put it into the batch that closes the trip. Null without a vehicle.
 */
export async function tripStatement(
  db: D1Database,
  input: { driverId: string; jobId: string; distanceMeters: number; stationId: string | null; createdBy: string | null },
): Promise<D1PreparedStatement | null> {
  const vehicle = await db
    .prepare("select v.type from drivers d join fleet_vehicles v on v.id = d.vehicle_id where d.user_id = ?")
    .bind(input.driverId)
    .first<{ type: FleetVehicleType }>();
  if (!vehicle) return null;
  if (await isStationStaff(db, input.driverId)) return null;
  const grams = tripGrams(input.distanceMeters, vehicle.type, await getFactors(db));
  // "or ignore": a trip earns once (unique index on job_id).
  return db
    .prepare(
      `insert or ignore into greenpoint_ledger (id, user_id, kind, co2_grams, points, vehicle, station_id, job_id, distance_m, created_by, created_at)
       values (?, ?, 'delivery', ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(uuid(), input.driverId, grams, pointsFor(grams), vehicle.type, input.stationId, input.jobId, input.distanceMeters, input.createdBy, nowIso());
}

/**
 * The ledger row for a completed swap or charge, or null when the station does not
 * charge with solar power or the person already earned MAX_EARNINGS_PER_DAY times
 * today. Callers put it into the same batch as the completion, so both are written or neither.
 */
export async function earnStatement(
  db: D1Database,
  input: { userId: string; type: ReservationType; stationId: string; reservationId?: string | null; createdBy: string | null; vehicle?: VehicleType },
): Promise<{ statement: D1PreparedStatement; co2Grams: number; points: number } | null> {
  if (!(await isSolarStation(db, input.stationId))) return null;
  if ((await earnedToday(db, input.userId)) >= MAX_EARNINGS_PER_DAY) return null;
  if (await drivesFleetVehicle(db, input.userId)) return null;
  if (await isStationStaff(db, input.userId)) return null;
  const vehicle = input.vehicle ?? (await vehicleOf(db, input.userId));
  const grams = (await getFactors(db)).batteryGrams[vehicle];
  const kind: GreenpointKind = input.reservationId ? (input.type === "battery" ? "swap" : "charge") : "visit";
  // "or ignore": a reservation earns once (unique index), even if completion runs twice.
  const statement = db
    .prepare(
      `insert or ignore into greenpoint_ledger (id, user_id, kind, co2_grams, points, vehicle, station_id, reservation_id, created_by, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(uuid(), input.userId, kind, grams, pointsFor(grams), vehicle, input.stationId, input.reservationId ?? null, input.createdBy, nowIso());
  return { statement, co2Grams: grams, points: pointsFor(grams) };
}

/**
 * The ledger row for a charge paid at the counter or in the app (worker/charging.ts):
 * CO2 from the kWh charged, only for an app customer at a solar station, within
 * MAX_EARNINGS_PER_DAY. The insert only happens while the charge is paid with
 * `paidRef`, so callers put it into the batch that books the payment, after it;
 * a charge earns once (unique index). Null when nothing is earned.
 */
export async function chargeEarnStatement(
  db: D1Database,
  input: { userId: string; stationId: string; sessionId: string; energyWh: number; paidRef: string; createdBy: string | null },
): Promise<{ statement: D1PreparedStatement; co2Grams: number; points: number } | null> {
  if (!(await isSolarStation(db, input.stationId))) return null;
  if ((await earnedToday(db, input.userId)) >= MAX_EARNINGS_PER_DAY) return null;
  if (await drivesFleetVehicle(db, input.userId)) return null;
  if (await isStationStaff(db, input.userId)) return null;
  const grams = Math.round((input.energyWh / 1000) * (await getFactors(db)).kwhGrams);
  const points = pointsFor(grams);
  if (points <= 0) return null;
  const vehicle = await vehicleOf(db, input.userId);
  const statement = db
    .prepare(
      `insert or ignore into greenpoint_ledger (id, user_id, kind, co2_grams, points, vehicle, station_id, charging_session_id, created_by, created_at)
       select ?, ?, 'charge', ?, ?, ?, ?, id, ?, ? from charging_sessions where id = ? and status = 'paid' and payment_ref = ?`,
    )
    .bind(uuid(), input.userId, grams, points, vehicle, input.stationId, input.createdBy, nowIso(), input.sessionId, input.paidRef);
  return { statement, co2Grams: grams, points };
}

async function rewards(db: D1Database, all: boolean): Promise<GreenpointReward[]> {
  const { results } = await db
    .prepare(`select * from greenpoint_rewards ${all ? "" : "where is_active = 1"} order by cost_points, title`)
    .all<RewardRow>();
  const list = results.map(toReward);
  return all ? list : list.filter((r) => rewardAvailable(r));
}

async function openRedemption(db: D1Database, userId: string): Promise<RedemptionRow | null> {
  return db
    .prepare(
      `select d.*, r.title as reward_title from greenpoint_redemptions d join greenpoint_rewards r on r.id = d.reward_id
       where d.user_id = ? and d.status = 'open'`,
    )
    .bind(userId)
    .first<RedemptionRow>();
}

function toRedemption(r: RedemptionRow): GreenpointRedemption {
  return { id: r.id, code: r.code, rewardTitle: r.reward_title, costPoints: r.cost_points, expiresAt: r.expires_at };
}

/** An expired code is closed on the next read, so the person can ask for a new one. */
async function liveRedemption(db: D1Database, userId: string): Promise<RedemptionRow | null> {
  const open = await openRedemption(db, userId);
  if (open && open.expires_at <= nowIso()) {
    await db.prepare("update greenpoint_redemptions set status = 'cancelled' where id = ? and status = 'open'").bind(open.id).run();
    return null;
  }
  return open;
}

// Riders ---------------------------------------------------------------------

export async function myGreenpoint(env: Env, user: Profile): Promise<GreenpointView> {
  refuseStationStaff(user);
  const db = env.DB;
  const [{ grams, points }, vehicle, redemption, list, history] = await Promise.all([
    totals(db, user.id),
    vehicleOf(db, user.id),
    liveRedemption(db, user.id),
    rewards(db, false),
    db.prepare(`${LEDGER_SELECT} where l.user_id = ? order by l.created_at desc limit ${HISTORY_LIMIT}`).bind(user.id).all<LedgerRow>(),
  ]);
  return {
    co2Grams: grams,
    points,
    level: levelFor(grams),
    next: nextLevel(grams),
    trees: treesFor(grams),
    vehicle,
    redemption: redemption ? toRedemption(redemption) : null,
    rewards: list,
    history: history.results.map(toEntry),
  };
}

export async function setVehicle(env: Env, user: Profile, request: Request) {
  refuseStationStaff(user);
  const { vehicle } = await readJson<{ vehicle?: string }>(request);
  if (!VEHICLE_TYPES.includes(vehicle as VehicleType)) throw new ApiError("bad_request");
  await env.DB.prepare("update users set greenpoint_vehicle = ? where id = ?").bind(vehicle, user.id).run();
  return { ok: true };
}

/** A code for a reward; points are only taken once staff enter it. One open code at a time. */
export async function startRedemption(env: Env, user: Profile, request: Request): Promise<GreenpointRedemption> {
  refuseStationStaff(user);
  const { rewardId } = await readJson<{ rewardId?: string }>(request);
  const db = env.DB;
  const row = await db.prepare("select * from greenpoint_rewards where id = ?").bind(String(rewardId ?? "")).first<RewardRow>();
  if (!row || !rewardAvailable(toReward(row))) throw new ApiError("reward_unavailable");
  if (await liveRedemption(db, user.id)) throw new ApiError("redemption_open");
  const { points } = await totals(db, user.id);
  if (points < row.cost_points) throw new ApiError("not_enough_points");
  const id = uuid();
  const expiresAt = new Date(Date.now() + REDEEM_CODE_MINUTES * 60_000).toISOString();
  // A code that is already open somewhere would be ambiguous: draw again.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomDigits(6);
    const taken = await db.prepare("select 1 from greenpoint_redemptions where code = ? and status = 'open'").bind(code).first();
    if (taken) continue;
    try {
      await db
        .prepare(
          "insert into greenpoint_redemptions (id, user_id, reward_id, code, cost_points, expires_at, created_at) values (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(id, user.id, row.id, code, row.cost_points, expiresAt, nowIso())
        .run();
    } catch {
      // Unique index: a second open code from a parallel request.
      throw new ApiError("redemption_open");
    }
    return { id, code, rewardTitle: row.title, costPoints: row.cost_points, expiresAt };
  }
  throw new ApiError("unknown", 500);
}

export async function cancelRedemption(env: Env, user: Profile, id: string) {
  await env.DB.prepare("update greenpoint_redemptions set status = 'cancelled' where id = ? and user_id = ? and status = 'open'")
    .bind(id, user.id)
    .run();
  return { ok: true };
}

// Station staff ----------------------------------------------------------------

type StaffCheck = (user: Profile, stationId: string) => Promise<boolean>;

interface UserRow {
  id: string;
  phone: string | null;
  email: string | null;
  full_name: string | null;
}

const label = (u: UserRow) => personLabel({ fullName: u.full_name, phone: u.phone, email: u.email });

/** Staff enter a swap or charge without reservation (cash or app), by the rider's phone number or e-mail. */
export async function recordVisit(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, request: Request): Promise<GreenpointReceipt> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const body = await readJson<{ contact?: string; service?: string; vehicle?: string }>(request);
  const type: ReservationType = body.service === "charge" ? "slot" : body.service === "swap" ? "battery" : (() => {
    throw new ApiError("bad_request");
  })();
  const vehicle = body.vehicle === undefined ? undefined : (body.vehicle as VehicleType);
  if (vehicle !== undefined && !VEHICLE_TYPES.includes(vehicle)) throw new ApiError("bad_request");
  const db = env.DB;
  const station = await db
    .prepare("select kind, has_battery, is_solar from stations where id = ?")
    .bind(stationId)
    .first<{ kind: "charging" | "swap" | "both"; has_battery: number; is_solar: number }>();
  if (!station) throw new ApiError("station_not_found", 404);
  const offered = station.has_battery !== 0 && (type === "battery" ? offersSwap(station.kind) : offersCharging(station.kind));
  if (!offered) throw new ApiError("service_not_offered");
  if (!station.is_solar) throw new ApiError("greenpoint_not_solar");

  const text = String(body.contact ?? "");
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const rider = await db
    .prepare(`select id, phone, email, full_name from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<UserRow>();
  if (!rider) throw new ApiError("recipient_not_found", 404);
  // Staff never credit themselves.
  if (rider.id === user.id) throw new ApiError("own_reservation");
  if (await drivesFleetVehicle(db, rider.id)) throw new ApiError("greenpoint_fleet_driver");
  if (await isStationStaff(db, rider.id)) throw new ApiError("greenpoint_station_staff");

  const earned = await earnStatement(db, { userId: rider.id, type, stationId, createdBy: user.id, vehicle });
  if (!earned) throw new ApiError("greenpoint_daily_limit");
  await earned.statement.run();
  return { person: label(rider), co2Grams: earned.co2Grams, points: earned.points, rewardTitle: null };
}

/** Staff enter the code the rider shows; the points are taken and the stock goes down. */
export async function confirmRedemption(env: Env, user: Profile, isStaffOf: StaffCheck, stationId: string, request: Request): Promise<GreenpointReceipt> {
  if (!(await isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const { code } = await readJson<{ code?: string }>(request);
  const db = env.DB;
  const r = await db
    .prepare(
      `select d.*, r.title as reward_title from greenpoint_redemptions d join greenpoint_rewards r on r.id = d.reward_id
       where d.code = ? and d.status = 'open'`,
    )
    .bind(String(code ?? "").trim())
    .first<RedemptionRow>();
  if (!r || r.expires_at <= nowIso()) throw new ApiError("invalid_code");
  if (r.user_id === user.id) throw new ApiError("own_reservation");
  const { points } = await totals(db, r.user_id);
  if (points < r.cost_points) throw new ApiError("not_enough_points");
  // One batch, so the code, the points and the stock change together. The ledger row and the
  // stock only follow this staff member's own update (used_by and used_at), so a parallel
  // confirmation of the same code takes nothing twice.
  const now = nowIso();
  const [used] = await db.batch([
    db
      .prepare("update greenpoint_redemptions set status = 'used', used_at = ?, used_by = ?, station_id = ? where id = ? and status = 'open'")
      .bind(now, user.id, stationId, r.id),
    db
      .prepare(
        `insert into greenpoint_ledger (id, user_id, kind, co2_grams, points, station_id, redemption_id, created_by, created_at)
         select ?, user_id, 'redeem', 0, -cost_points, ?, id, ?, ? from greenpoint_redemptions
         where id = ? and status = 'used' and used_by = ? and used_at = ?`,
      )
      .bind(uuid(), stationId, user.id, now, r.id, user.id, now),
    db
      .prepare(
        `update greenpoint_rewards set stock = stock - 1 where stock > 0 and id =
         (select reward_id from greenpoint_redemptions where id = ? and status = 'used' and used_by = ? and used_at = ?)`,
      )
      .bind(r.id, user.id, now),
  ]);
  if (!used.meta.changes) throw new ApiError("invalid_code");
  const rider = await db.prepare("select id, phone, email, full_name from users where id = ?").bind(r.user_id).first<UserRow>();
  return { person: rider ? label(rider) : "?", co2Grams: 0, points: -r.cost_points, rewardTitle: r.reward_title };
}

// Admin -----------------------------------------------------------------------

export async function adminGreenpoint(env: Env): Promise<AdminGreenpoint> {
  const db = env.DB;
  const [factors, list, sums, recent] = await Promise.all([
    getFactors(db),
    rewards(db, true),
    db
      .prepare(
        `select coalesce(sum(co2_grams), 0) as grams,
                coalesce(sum(case when points > 0 then points else 0 end), 0) as earned,
                coalesce(-sum(case when kind = 'redeem' then points else 0 end), 0) as redeemed,
                count(distinct user_id) as members
         from greenpoint_ledger`,
      )
      .first<{ grams: number; earned: number; redeemed: number; members: number }>(),
    db
      .prepare(
        `select l.id, l.kind, l.co2_grams, l.points, l.vehicle, l.created_at, s.name as station_name, r.title as reward_title,
                u.full_name, u.phone, u.email
         from greenpoint_ledger l
         join users u on u.id = l.user_id
         left join stations s on s.id = l.station_id
         left join greenpoint_redemptions d on d.id = l.redemption_id
         left join greenpoint_rewards r on r.id = d.reward_id
         order by l.created_at desc limit ${ADMIN_RECENT_LIMIT}`,
      )
      .all<LedgerRow & { full_name: string | null; phone: string | null; email: string | null }>(),
  ]);
  return {
    factors,
    rewards: list,
    totals: {
      co2Grams: sums?.grams ?? 0,
      pointsEarned: sums?.earned ?? 0,
      pointsRedeemed: sums?.redeemed ?? 0,
      members: sums?.members ?? 0,
    },
    recent: recent.results.map((r) => ({ ...toEntry(r), person: personLabel({ fullName: r.full_name, phone: r.phone, email: r.email }) })),
  };
}

export async function saveFactors(env: Env, admin: Profile, request: Request) {
  const factors = validFactors(await readJson(request));
  if (!factors) throw new ApiError("bad_request");
  await env.DB.prepare(
    `insert into app_settings (key, value, updated_by, updated_at) values ('greenpoint_factors', ?, ?, ?)
     on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  )
    .bind(JSON.stringify(factors), admin.id, nowIso())
    .run();
  return factors;
}

export async function saveReward(env: Env, request: Request) {
  const body = await readJson<{ id?: string | null; input?: unknown }>(request);
  const input = validRewardInput(body.input);
  if (!input) throw new ApiError("bad_request");
  const now = nowIso();
  const values = [
    input.title,
    input.description,
    input.costPoints,
    input.provider,
    input.partnerName,
    input.stock,
    input.validUntil,
    input.isActive ? 1 : 0,
    now,
  ];
  if (body.id) {
    const done = await env.DB.prepare(
      `update greenpoint_rewards set title = ?, description = ?, cost_points = ?, provider = ?, partner_name = ?, stock = ?,
       valid_until = ?, is_active = ?, updated_at = ? where id = ?`,
    )
      .bind(...values, String(body.id))
      .run();
    if (!done.meta.changes) throw new ApiError("not_found", 404);
  } else {
    await env.DB.prepare(
      `insert into greenpoint_rewards (title, description, cost_points, provider, partner_name, stock, valid_until, is_active, updated_at, id, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(...values, uuid(), now)
      .run();
  }
  return { ok: true };
}

/** Public: CO2 saved by everyone, for the landing page and the app. */
export async function networkTotal(env: Env) {
  const row = await env.DB.prepare("select coalesce(sum(co2_grams), 0) as grams from greenpoint_ledger").first<{ grams: number }>();
  return { co2Grams: row?.grams ?? 0 };
}
