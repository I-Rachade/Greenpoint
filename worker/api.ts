import { withinOpeningHours } from "../src/lib/availability";
import {
  ADMIN_HISTORY_DAYS,
  type AdminSnapshot,
  type AuditEntry,
  type AuditTable,
  type ChargingPointInfo,
} from "../src/lib/admin/types";
import { MAX_PROMO_IMAGE_BYTES, pickPromotion, safeImage, safeLink, type Promotion, type PromotionInput } from "../src/lib/promo";
import {
  MAX_UNUSED_RESERVATIONS_PER_DAY,
  RESERVATION_MINUTES,
  STATION_COOLDOWN_MINUTES,
  VEHICLE_TYPES,
  type Profile,
  type Reservation,
  type ReservationType,
  type StationInput,
  type StationView,
  type UserRole,
} from "../src/lib/types";
import { currentUser, register, sendCode, signIn, signOut } from "./auth";
import type { Env } from "./env";
import { ApiError, json, nowIso, randomDigits, readJson, uuid } from "./http";
import { myPayments, paymentCallback, refreshPayment, startPayment } from "./payments";

// Rows as stored in D1 (snake_case, booleans as 0/1, JSON as text).

interface StationRow {
  id: string;
  operator_id: string;
  operator_name: string | null;
  is_own: number | null;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: StationView["kind"];
  vehicle_types: string;
  charging_slots: number;
  battery_capacity: number;
  opening_hours: string;
  phone: string | null;
  is_active: number;
  is_open: number | null;
  free_slots: number | null;
  full_batteries: number | null;
  updated_at: string | null;
  reserved_slots: number;
  reserved_batteries: number;
}

interface ReservationRow {
  id: string;
  user_id: string;
  station_id: string;
  type: ReservationType;
  status: Reservation["status"];
  created_at: string;
  expires_at: string;
  cancel_reason: string | null;
  pickup_code: string;
}

interface PromotionRow {
  id: string;
  title: string;
  body: string;
  image_url: string | null;
  link_url: string | null;
  link_label: string | null;
  is_active: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

const ROLES: UserRole[] = ["rider", "operator", "fleet_manager", "admin"];

function toStationView(r: StationRow): StationView & { isActive: boolean } {
  let vehicleTypes: StationView["vehicleTypes"] = [];
  try {
    vehicleTypes = JSON.parse(r.vehicle_types);
  } catch {}
  return {
    id: r.id,
    operatorId: r.operator_id,
    operatorName: r.operator_name ?? "",
    isOwn: !!r.is_own,
    name: r.name,
    address: r.address,
    lat: r.lat,
    lng: r.lng,
    kind: r.kind,
    vehicleTypes,
    chargingSlots: r.charging_slots,
    batteryCapacity: r.battery_capacity,
    openingHours: r.opening_hours,
    phone: r.phone,
    isActive: !!r.is_active,
    status: {
      stationId: r.id,
      isOpen: !!r.is_open,
      freeSlots: r.free_slots ?? 0,
      fullBatteries: r.full_batteries ?? 0,
      updatedAt: r.updated_at ?? new Date(0).toISOString(),
    },
    reservedSlots: r.reserved_slots,
    reservedBatteries: r.reserved_batteries,
  };
}

function toReservation(r: ReservationRow, withCode: boolean): Reservation {
  return {
    id: r.id,
    userId: r.user_id,
    stationId: r.station_id,
    type: r.type,
    status: r.status,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    cancelReason: r.cancel_reason,
    ...(withCode ? { pickupCode: r.pickup_code } : {}),
  };
}

function toPromotion(r: PromotionRow): Promotion {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    imageUrl: r.image_url,
    linkUrl: r.link_url,
    linkLabel: r.link_label,
    isActive: !!r.is_active,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const STATION_SELECT = `
  select s.*, o.name as operator_name, o.is_own,
         st.is_open, st.free_slots, st.full_batteries, st.updated_at,
         (select count(*) from reservations r where r.station_id = s.id and r.status = 'active' and r.expires_at > ?1 and r.type = 'slot') as reserved_slots,
         (select count(*) from reservations r where r.station_id = s.id and r.status = 'active' and r.expires_at > ?1 and r.type = 'battery') as reserved_batteries
  from stations s
  left join operators o on o.id = s.operator_id
  left join station_status st on st.station_id = s.id`;

/** Everything a request handler needs. */
class Ctx {
  private userPromise: Promise<Profile | null> | null = null;
  constructor(
    readonly env: Env,
    readonly request: Request,
    readonly url: URL,
  ) {}

  get db() {
    return this.env.DB;
  }

  user(): Promise<Profile | null> {
    this.userPromise ??= currentUser(this.env, this.request);
    return this.userPromise;
  }

  async requireUser(): Promise<Profile> {
    const user = await this.user();
    if (!user) throw new ApiError("not_authenticated", 401);
    return user;
  }

  async requireAdmin(): Promise<Profile> {
    const user = await this.requireUser();
    if (user.role !== "admin") throw new ApiError("forbidden", 403);
    return user;
  }

  async isStaffOf(user: Profile, stationId: string): Promise<boolean> {
    if (user.role === "admin") return true;
    const row = await this.db
      .prepare("select 1 from station_staff where station_id = ? and user_id = ?")
      .bind(stationId, user.id)
      .first();
    return !!row;
  }

  /** Activity log entry (the Supabase version wrote these with a trigger). */
  audit(
    actor: string | null,
    table: AuditTable,
    action: AuditEntry["action"],
    rowId: string,
    changes: Record<string, unknown>,
    ids: { stationId?: string | null; userId?: string | null } = {},
  ) {
    return this.db
      .prepare(
        "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(nowIso(), actor, table, action, rowId, ids.stationId ?? null, ids.userId ?? null, JSON.stringify(changes));
  }

  async stations(where: string, ...params: unknown[]): Promise<(StationView & { isActive: boolean })[]> {
    const { results } = await this.db
      .prepare(`${STATION_SELECT} ${where} order by s.name`)
      .bind(nowIso(), ...params)
      .all<StationRow>();
    return results.map(toStationView);
  }
}

/** `{column: [old, new]}` for the fields that changed. */
function diff(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(after)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) out[key] = [before[key] ?? null, after[key]];
  }
  return out;
}

function int(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100_000) throw new ApiError("bad_request");
  return Math.floor(n);
}

// Riders --------------------------------------------------------------------

async function reserve(c: Ctx, stationId: string, type: ReservationType): Promise<Reservation> {
  const user = await c.requireUser();
  if (type !== "battery" && type !== "slot") throw new ApiError("bad_request");
  const now = nowIso();

  await c.db
    .prepare("update reservations set status = 'expired' where user_id = ? and status = 'active' and expires_at <= ?")
    .bind(user.id, now)
    .run();

  const dayAgo = new Date(Date.now() - 86_400_000).toISOString();
  const cooldownSince = new Date(Date.now() - STATION_COOLDOWN_MINUTES * 60_000).toISOString();
  const checks = await c.db
    .prepare(
      `select
         (select count(*) from reservations where user_id = ?1 and status = 'active') as active,
         (select count(*) from reservations where user_id = ?1 and status in ('cancelled', 'expired') and cancel_reason is null and created_at > ?2) as unused,
         (select count(*) from reservations where user_id = ?1 and station_id = ?3 and status in ('cancelled', 'expired') and cancel_reason is null and created_at > ?4) as recent_here`,
    )
    .bind(user.id, dayAgo, stationId, cooldownSince)
    .first<{ active: number; unused: number; recent_here: number }>();
  if (checks?.active) throw new ApiError("already_reserved");
  if ((checks?.unused ?? 0) >= MAX_UNUSED_RESERVATIONS_PER_DAY) throw new ApiError("daily_limit");
  if (checks?.recent_here) throw new ApiError("cooldown");

  const [station] = await c.stations("where s.id = ?2 and s.is_active = 1", stationId);
  if (!station) throw new ApiError("station_not_found", 404);
  if (!station.status.isOpen || !withinOpeningHours(station.openingHours)) throw new ApiError("station_closed");
  if ((type === "slot" && station.kind === "swap") || (type === "battery" && station.kind === "charging")) {
    throw new ApiError("service_not_offered");
  }

  const id = uuid();
  const code = randomDigits(4);
  const expires = new Date(Date.now() + RESERVATION_MINUTES * 60_000).toISOString();
  let inserted: D1Result;
  try {
    // The availability check and the insert are one statement, so two riders
    // cannot take the last battery at once.
    inserted = await c.db
      .prepare(
        `insert into reservations (id, user_id, station_id, type, status, created_at, expires_at, pickup_code)
         select ?1, ?2, ?3, ?4, 'active', ?5, ?6, ?7
         where (select case when ?4 = 'slot' then free_slots else full_batteries end from station_status where station_id = ?3)
             - (select count(*) from reservations where station_id = ?3 and type = ?4 and status = 'active' and expires_at > ?5) > 0`,
      )
      .bind(id, user.id, stationId, type, now, expires, code)
      .run();
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("already_reserved");
    throw err;
  }
  if (!inserted.meta.changes) throw new ApiError("none_available");
  await c.audit(user.id, "reservations", "insert", id, { type, status: "active", expires_at: expires }, {
    stationId,
    userId: user.id,
  }).run();
  return {
    id,
    userId: user.id,
    stationId,
    type,
    status: "active",
    createdAt: now,
    expiresAt: expires,
    cancelReason: null,
    pickupCode: code,
  };
}

async function myReservations(c: Ctx): Promise<Reservation[]> {
  const user = await c.user();
  if (!user) return [];
  const { results } = await c.db
    .prepare("select * from reservations where user_id = ? order by created_at desc limit 50")
    .bind(user.id)
    .all<ReservationRow>();
  return results.map((r) => toReservation(r, true));
}

async function cancelReservation(c: Ctx, id: string) {
  const user = await c.requireUser();
  const r = await c.db.prepare("select * from reservations where id = ?").bind(id).first<ReservationRow>();
  if (!r) throw new ApiError("forbidden", 403);
  const own = r.user_id === user.id;
  if (!own && user.role !== "admin") throw new ApiError("forbidden", 403);
  if (r.status !== "active") throw new ApiError("reservation_not_active");
  // Cancelled by the team: does not count against the rider's limits.
  const reason = own ? null : "admin";
  await c.db.batch([
    c.db
      .prepare("update reservations set status = 'cancelled', cancel_reason = ? where id = ? and status = 'active'")
      .bind(reason, id),
    c.audit(user.id, "reservations", "update", id, { status: ["active", "cancelled"], ...(reason ? { cancel_reason: [null, reason] } : {}) }, {
      stationId: r.station_id,
      userId: r.user_id,
    }),
  ]);
}

// Station staff -------------------------------------------------------------

async function staffStations(c: Ctx) {
  const user = await c.requireUser();
  if (user.role === "admin") return c.stations("where s.is_active = 1");
  return c.stations(
    "where s.is_active = 1 and s.id in (select station_id from station_staff where user_id = ?2)",
    user.id,
  );
}

async function updateStatus(c: Ctx, stationId: string, patch: { isOpen?: boolean; freeSlots?: number; fullBatteries?: number }) {
  const user = await c.requireUser();
  if (!(await c.isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const before = await c.db
    .prepare("select is_open, free_slots, full_batteries from station_status where station_id = ?")
    .bind(stationId)
    .first<{ is_open: number; free_slots: number; full_batteries: number }>();
  if (!before) throw new ApiError("station_not_found", 404);
  const after = {
    is_open: patch.isOpen === undefined ? before.is_open : patch.isOpen ? 1 : 0,
    free_slots: patch.freeSlots === undefined ? before.free_slots : int(patch.freeSlots),
    full_batteries: patch.fullBatteries === undefined ? before.full_batteries : int(patch.fullBatteries),
  };
  const statements = [
    c.db
      .prepare(
        "update station_status set is_open = ?, free_slots = ?, full_batteries = ?, updated_at = ?, updated_by = ? where station_id = ?",
      )
      .bind(after.is_open, after.free_slots, after.full_batteries, nowIso(), user.id, stationId),
  ];
  const changes = diff(before, after);
  if (Object.keys(changes).length) {
    statements.push(c.audit(user.id, "station_status", "update", stationId, changes, { stationId }));
  }
  // Closing a station cancels its active reservations, so riders do not ride there for nothing.
  if (before.is_open && !after.is_open) {
    const { results } = await c.db
      .prepare("select id, user_id from reservations where station_id = ? and status = 'active'")
      .bind(stationId)
      .all<{ id: string; user_id: string }>();
    for (const r of results) {
      statements.push(
        c.db
          .prepare("update reservations set status = 'cancelled', cancel_reason = 'station_closed' where id = ? and status = 'active'")
          .bind(r.id),
        c.audit(user.id, "reservations", "update", r.id, { status: ["active", "cancelled"], cancel_reason: [null, "station_closed"] }, {
          stationId,
          userId: r.user_id,
        }),
      );
    }
  }
  await c.db.batch(statements);
}

async function stationReservations(c: Ctx, stationId: string) {
  const user = await c.requireUser();
  if (!(await c.isStaffOf(user, stationId))) throw new ApiError("forbidden", 403);
  const { results } = await c.db
    .prepare("select * from reservations where station_id = ? order by created_at desc limit 50")
    .bind(stationId)
    .all<ReservationRow>();
  // Staff never see pickup codes: the rider tells them at the station.
  return results.map((r) => toReservation(r, false));
}

async function completeReservation(c: Ctx, id: string, pickupCode: string) {
  const user = await c.requireUser();
  const r = await c.db.prepare("select * from reservations where id = ?").bind(id).first<ReservationRow>();
  if (!r || !(await c.isStaffOf(user, r.station_id))) throw new ApiError("forbidden", 403);
  if (r.user_id === user.id) throw new ApiError("own_reservation");
  if (r.status !== "active" || r.expires_at <= nowIso()) throw new ApiError("reservation_not_active");
  if (r.pickup_code !== String(pickupCode ?? "").trim()) throw new ApiError("wrong_pickup_code");
  const done = await c.db
    .prepare("update reservations set status = 'completed' where id = ? and status = 'active'")
    .bind(id)
    .run();
  if (!done.meta.changes) throw new ApiError("reservation_not_active");
  // The battery or slot the rider took comes off the counter, so the map does not show it as free again.
  const column = r.type === "battery" ? "full_batteries" : "free_slots";
  await c.db.batch([
    c.db
      .prepare(`update station_status set ${column} = max(${column} - 1, 0), updated_at = ?, updated_by = ? where station_id = ?`)
      .bind(nowIso(), user.id, r.station_id),
    c.audit(user.id, "reservations", "update", id, { status: ["active", "completed"] }, {
      stationId: r.station_id,
      userId: r.user_id,
    }),
  ]);
}

// Admin ---------------------------------------------------------------------

async function listOperators(c: Ctx) {
  const { results } = await c.db
    .prepare("select id, name, is_own from operators order by name")
    .all<{ id: string; name: string; is_own: number }>();
  return results.map((o) => ({ id: o.id, name: o.name, isOwn: !!o.is_own }));
}

function stationRow(input: StationInput) {
  if (!input || typeof input.name !== "string" || !input.name.trim()) throw new ApiError("bad_request");
  if (!["charging", "swap", "both"].includes(input.kind)) throw new ApiError("bad_request");
  const lat = Number(input.lat);
  const lng = Number(input.lng);
  if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) throw new ApiError("bad_request");
  return {
    operator_id: String(input.operatorId),
    name: input.name.trim(),
    address: String(input.address ?? ""),
    lat,
    lng,
    kind: input.kind,
    vehicle_types: JSON.stringify((input.vehicleTypes ?? []).filter((v) => VEHICLE_TYPES.includes(v))),
    charging_slots: int(input.chargingSlots),
    battery_capacity: int(input.batteryCapacity),
    opening_hours: String(input.openingHours ?? ""),
    phone: input.phone ? String(input.phone) : null,
  };
}

async function saveStation(c: Ctx, id: string | null, input: StationInput) {
  const admin = await c.requireAdmin();
  const row = stationRow(input);
  const now = nowIso();
  if (id) {
    const before = await c.db
      .prepare(
        "select operator_id, name, address, lat, lng, kind, vehicle_types, charging_slots, battery_capacity, opening_hours, phone from stations where id = ?",
      )
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("station_not_found", 404);
    await c.db.batch([
      c.db
        .prepare(
          `update stations set operator_id = ?, name = ?, address = ?, lat = ?, lng = ?, kind = ?, vehicle_types = ?,
           charging_slots = ?, battery_capacity = ?, opening_hours = ?, phone = ? where id = ?`,
        )
        .bind(...Object.values(row), id),
      c.audit(admin.id, "stations", "update", id, diff(before, row), { stationId: id }),
    ]);
    return;
  }
  const newId = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into stations (id, operator_id, name, address, lat, lng, kind, vehicle_types, charging_slots,
         battery_capacity, opening_hours, phone, is_active, created_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      )
      .bind(newId, ...Object.values(row), now),
    c.db
      .prepare("insert into station_status (station_id, is_open, free_slots, full_batteries, updated_at) values (?, 1, ?, ?, ?)")
      .bind(newId, row.charging_slots, row.battery_capacity, now),
    c.audit(admin.id, "stations", "insert", newId, row, { stationId: newId }),
  ]);
}

async function adminSnapshot(c: Ctx): Promise<AdminSnapshot> {
  await c.requireAdmin();
  const since = new Date(Date.now() - ADMIN_HISTORY_DAYS * 86_400_000).toISOString();
  const [stations, users, staff, reservations, points] = await Promise.all([
    c.stations(""),
    c.db
      .prepare("select id, phone, full_name, role, created_at, last_sign_in_at from users order by created_at desc")
      .all<{ id: string; phone: string; full_name: string | null; role: UserRole; created_at: string; last_sign_in_at: string | null }>(),
    c.db.prepare("select station_id, user_id from station_staff").all<{ station_id: string; user_id: string }>(),
    c.db
      .prepare("select * from reservations where created_at >= ? order by created_at desc limit 5000")
      .bind(since)
      .all<ReservationRow>(),
    c.db
      .prepare("select id, station_id, label, status, device_id, last_seen_at from charging_points order by label")
      .all<{ id: string; station_id: string; label: string; status: ChargingPointInfo["status"]; device_id: string | null; last_seen_at: string | null }>(),
  ]);
  return {
    stations,
    users: users.results.map((u) => ({
      id: u.id,
      phone: u.phone,
      fullName: u.full_name,
      role: u.role,
      createdAt: u.created_at,
      lastSignInAt: u.last_sign_in_at,
    })),
    staff: staff.results.map((s) => ({ stationId: s.station_id, userId: s.user_id })),
    reservations: reservations.results.map((r) => toReservation(r, false)),
    chargingPoints: points.results.map((p) => ({
      id: p.id,
      stationId: p.station_id,
      label: p.label,
      status: p.status,
      deviceId: p.device_id,
      lastSeenAt: p.last_seen_at,
    })),
  };
}

async function auditLog(c: Ctx): Promise<AuditEntry[]> {
  await c.requireAdmin();
  const q = c.url.searchParams;
  const where: string[] = [];
  const params: unknown[] = [];
  const filters: [string, string, (v: string) => unknown][] = [
    ["table", "table_name = ?", String],
    ["actorId", "actor = ?", String],
    ["stationId", "station_id = ?", String],
    ["beforeId", "id < ?", Number],
  ];
  for (const [key, clause, cast] of filters) {
    const value = q.get(key);
    if (!value) continue;
    where.push(clause);
    params.push(cast(value));
  }
  const limit = Math.min(Math.max(Number(q.get("limit")) || 100, 1), 1000);
  const { results } = await c.db
    .prepare(`select * from audit_log ${where.length ? `where ${where.join(" and ")}` : ""} order by id desc limit ${limit}`)
    .bind(...params)
    .all<{ id: number; at: string; actor: string | null; table_name: AuditTable; action: AuditEntry["action"]; row_id: string; station_id: string | null; user_id: string | null; changes: string }>();
  return results.map((r) => ({
    id: r.id,
    at: r.at,
    actorId: r.actor,
    table: r.table_name,
    action: r.action,
    rowId: r.row_id,
    stationId: r.station_id,
    userId: r.user_id,
    changes: JSON.parse(r.changes || "{}"),
  }));
}

async function setUserRole(c: Ctx, userId: string, role: UserRole) {
  const admin = await c.requireAdmin();
  if (!ROLES.includes(role)) throw new ApiError("bad_request");
  if (userId === admin.id) throw new ApiError("forbidden", 403);
  const before = await c.db.prepare("select role from users where id = ?").bind(userId).first<{ role: UserRole }>();
  if (!before) throw new ApiError("forbidden", 403);
  if (before.role === role) return;
  await c.db.batch([
    c.db.prepare("update users set role = ? where id = ?").bind(role, userId),
    c.audit(admin.id, "profiles", "update", userId, { role: [before.role, role] }, { userId }),
  ]);
}

async function assignStaff(c: Ctx, stationId: string, userId: string) {
  const admin = await c.requireAdmin();
  const inserted = await c.db
    .prepare("insert or ignore into station_staff (station_id, user_id) values (?, ?)")
    .bind(stationId, userId)
    .run();
  if (!inserted.meta.changes) return;
  // The role follows the assignment.
  await c.db.batch([
    c.audit(admin.id, "station_staff", "insert", `${stationId}:${userId}`, {}, { stationId, userId }),
    c.db.prepare("update users set role = 'operator' where id = ? and role = 'rider'").bind(userId),
  ]);
}

async function unassignStaff(c: Ctx, stationId: string, userId: string) {
  const admin = await c.requireAdmin();
  const deleted = await c.db
    .prepare("delete from station_staff where station_id = ? and user_id = ?")
    .bind(stationId, userId)
    .run();
  if (!deleted.meta.changes) return;
  await c.db.batch([
    c.audit(admin.id, "station_staff", "delete", `${stationId}:${userId}`, {}, { stationId, userId }),
    c.db
      .prepare(
        "update users set role = 'rider' where id = ?1 and role = 'operator' and not exists (select 1 from station_staff where user_id = ?1)",
      )
      .bind(userId),
  ]);
}

async function setStationActive(c: Ctx, stationId: string, active: boolean) {
  const admin = await c.requireAdmin();
  const res = await c.db.prepare("update stations set is_active = ? where id = ?").bind(active ? 1 : 0, stationId).run();
  if (!res.meta.changes) throw new ApiError("station_not_found", 404);
  await c.audit(admin.id, "stations", "update", stationId, { is_active: [!active, active] }, { stationId }).run();
}

// Advertising popup ---------------------------------------------------------

async function currentPromotion(c: Ctx): Promise<Promotion | null> {
  const now = nowIso();
  const { results } = await c.db
    .prepare(
      `select * from promotions where is_active = 1 and (starts_at is null or starts_at <= ?1)
       and (ends_at is null or ends_at > ?1) order by updated_at desc limit 1`,
    )
    .bind(now)
    .all<PromotionRow>();
  return pickPromotion(results.map(toPromotion), new Date());
}

function promotionRow(input: PromotionInput) {
  const title = String(input?.title ?? "").trim();
  if (!title || title.length > 120) throw new ApiError("bad_request");
  const body = String(input.body ?? "").trim();
  if (body.length > 1000) throw new ApiError("bad_request");
  const image = input.imageUrl ? safeImage(input.imageUrl) : null;
  const link = input.linkUrl ? safeLink(input.linkUrl) : null;
  if ((input.imageUrl && (!image || image.startsWith("data:"))) || (input.linkUrl && !link)) throw new ApiError("bad_request");
  const date = (v: string | null) => (v ? new Date(v).toISOString() : null);
  let starts: string | null;
  let ends: string | null;
  try {
    starts = date(input.startsAt);
    ends = date(input.endsAt);
  } catch {
    throw new ApiError("bad_request");
  }
  if (starts && ends && ends <= starts) throw new ApiError("bad_request");
  return {
    title,
    body,
    image_url: image,
    link_url: link,
    link_label: input.linkLabel ? String(input.linkLabel).trim().slice(0, 40) || null : null,
    is_active: input.isActive ? 1 : 0,
    starts_at: starts,
    ends_at: ends,
  };
}

async function listPromotions(c: Ctx) {
  await c.requireAdmin();
  const { results } = await c.db.prepare("select * from promotions order by created_at desc").all<PromotionRow>();
  return results.map(toPromotion);
}

async function savePromotion(c: Ctx, id: string | null, input: PromotionInput) {
  const admin = await c.requireAdmin();
  const row = promotionRow(input);
  const now = nowIso();
  if (id) {
    const before = await c.db
      .prepare("select title, body, image_url, link_url, link_label, is_active, starts_at, ends_at from promotions where id = ?")
      .bind(id)
      .first<Record<string, unknown>>();
    if (!before) throw new ApiError("not_found", 404);
    await c.db.batch([
      c.db
        .prepare(
          `update promotions set title = ?, body = ?, image_url = ?, link_url = ?, link_label = ?, is_active = ?,
           starts_at = ?, ends_at = ?, updated_at = ? where id = ?`,
        )
        .bind(...Object.values(row), now, id),
      c.audit(admin.id, "promotions", "update", id, diff(before, row)),
    ]);
    return;
  }
  const newId = uuid();
  await c.db.batch([
    c.db
      .prepare(
        `insert into promotions (id, title, body, image_url, link_url, link_label, is_active, starts_at, ends_at, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(newId, ...Object.values(row), now, now),
    c.audit(admin.id, "promotions", "insert", newId, row),
  ]);
}

async function deletePromotion(c: Ctx, id: string) {
  const admin = await c.requireAdmin();
  const before = await c.db.prepare("select title from promotions where id = ?").bind(id).first<{ title: string }>();
  if (!before) return;
  await c.db.batch([
    c.db.prepare("delete from promotions where id = ?").bind(id),
    c.audit(admin.id, "promotions", "delete", id, { title: before.title }),
  ]);
}

const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function uploadImage(c: Ctx) {
  await c.requireAdmin();
  const type = (c.request.headers.get("Content-Type") ?? "").split(";")[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  if (!ext) throw new ApiError("bad_request");
  const length = Number(c.request.headers.get("Content-Length"));
  if (length > MAX_PROMO_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  const body = await c.request.arrayBuffer();
  if (body.byteLength > MAX_PROMO_IMAGE_BYTES) throw new ApiError("image_too_large", 413);
  if (!body.byteLength) throw new ApiError("bad_request");
  const key = `promotions/${uuid()}.${ext}`;
  await c.env.MEDIA.put(key, body, { httpMetadata: { contentType: type, cacheControl: "public, max-age=31536000, immutable" } });
  const local = c.url.hostname === "localhost" || c.url.hostname === "127.0.0.1";
  return { url: `${local ? c.url.origin : `https://${c.url.host}`}/api/media/${key}` };
}

async function media(c: Ctx, key: string): Promise<Response> {
  const object = await c.env.MEDIA.get(key);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("ETag", object.httpEtag);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  headers.set("X-Content-Type-Options", "nosniff");
  return new Response(object.body, { headers });
}

// Routing -------------------------------------------------------------------

type Handler = (c: Ctx, params: string[]) => Promise<unknown>;

const ROUTES: [string, RegExp, Handler][] = [
  ["GET", /^\/api\/stations$/, (c) => c.stations("where s.is_active = 1")],
  ["GET", /^\/api\/operators$/, (c) => listOperators(c)],
  ["GET", /^\/api\/me$/, (c) => c.user()],
  [
    "POST",
    /^\/api\/auth\/send$/,
    async (c) => {
      const { phone } = await readJson<{ phone: string }>(c.request);
      await sendCode(c.env, phone);
      return { ok: true };
    },
  ],
  [
    "POST",
    /^\/api\/auth\/register$/,
    async (c) => {
      const { phone, code, pin } = await readJson<{ phone: string; code: string; pin: string }>(c.request);
      return register(c.env, phone, code, pin);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/login$/,
    async (c) => {
      const { phone, pin } = await readJson<{ phone: string; pin: string }>(c.request);
      return signIn(c.env, phone, pin);
    },
  ],
  [
    "POST",
    /^\/api\/auth\/logout$/,
    async (c) => {
      await signOut(c.env, c.request);
      return { ok: true };
    },
  ],
  ["GET", /^\/api\/reservations\/mine$/, (c) => myReservations(c)],
  [
    "POST",
    /^\/api\/reservations$/,
    async (c) => {
      const { stationId, type } = await readJson<{ stationId: string; type: ReservationType }>(c.request);
      return reserve(c, String(stationId), type);
    },
  ],
  ["POST", /^\/api\/reservations\/([\w-]+)\/cancel$/, async (c, [id]) => cancelReservation(c, id)],
  [
    "POST",
    /^\/api\/reservations\/([\w-]+)\/complete$/,
    async (c, [id]) => {
      const { pickupCode } = await readJson<{ pickupCode: string }>(c.request);
      return completeReservation(c, id, pickupCode);
    },
  ],
  ["GET", /^\/api\/staff\/stations$/, (c) => staffStations(c)],
  [
    "PATCH",
    /^\/api\/stations\/([\w-]+)\/status$/,
    async (c, [id]) => updateStatus(c, id, await readJson(c.request)),
  ],
  ["GET", /^\/api\/stations\/([\w-]+)\/reservations$/, (c, [id]) => stationReservations(c, id)],
  ["GET", /^\/api\/promotions\/current$/, (c) => currentPromotion(c)],
  ["GET", /^\/api\/payments\/mine$/, async (c) => myPayments(c.env, await c.requireUser())],
  ["POST", /^\/api\/payments$/, async (c) => startPayment(c.env, await c.requireUser(), c.request)],
  ["POST", /^\/api\/payments\/([\w-]+)\/refresh$/, async (c, [id]) => refreshPayment(c.env, await c.requireUser(), id)],
  [
    "POST",
    /^\/api\/admin\/stations$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: StationInput }>(c.request);
      return saveStation(c, id, input);
    },
  ],
  [
    "POST",
    /^\/api\/admin\/stations\/([\w-]+)\/active$/,
    async (c, [id]) => setStationActive(c, id, !!(await readJson<{ active: boolean }>(c.request)).active),
  ],
  ["GET", /^\/api\/admin\/snapshot$/, (c) => adminSnapshot(c)],
  ["GET", /^\/api\/admin\/audit$/, (c) => auditLog(c)],
  [
    "POST",
    /^\/api\/admin\/users\/([\w-]+)\/role$/,
    async (c, [id]) => setUserRole(c, id, (await readJson<{ role: UserRole }>(c.request)).role),
  ],
  [
    "POST",
    /^\/api\/admin\/staff$/,
    async (c) => {
      const { stationId, userId } = await readJson<{ stationId: string; userId: string }>(c.request);
      return assignStaff(c, String(stationId), String(userId));
    },
  ],
  [
    "DELETE",
    /^\/api\/admin\/staff$/,
    async (c) => {
      const { stationId, userId } = await readJson<{ stationId: string; userId: string }>(c.request);
      return unassignStaff(c, String(stationId), String(userId));
    },
  ],
  ["GET", /^\/api\/admin\/promotions$/, (c) => listPromotions(c)],
  [
    "POST",
    /^\/api\/admin\/promotions$/,
    async (c) => {
      const { id, input } = await readJson<{ id: string | null; input: PromotionInput }>(c.request);
      return savePromotion(c, id, input);
    },
  ],
  ["DELETE", /^\/api\/admin\/promotions\/([\w-]+)$/, (c, [id]) => deletePromotion(c, id)],
  ["POST", /^\/api\/admin\/media$/, (c) => uploadImage(c)],
];

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const c = new Ctx(env, request, url);
  try {
    const mediaMatch = /^\/api\/media\/(promotions\/[\w-]+\.(?:png|jpg|webp|gif))$/.exec(url.pathname);
    if (mediaMatch && (request.method === "GET" || request.method === "HEAD")) return await media(c, mediaMatch[1]);
    // Called by the payment provider, answers in plain text (see worker/payments.ts).
    if (url.pathname === "/api/payments/callback" && request.method === "POST") return await paymentCallback(env, request);
    for (const [method, pattern, handler] of ROUTES) {
      const m = pattern.exec(url.pathname);
      if (!m) continue;
      if (request.method !== method) continue;
      const result = await handler(c, m.slice(1));
      return json(result ?? null);
    }
    return json({ error: "not_found" }, 404);
  } catch (err) {
    if (err instanceof ApiError) return json({ error: err.code }, err.status);
    console.error(err);
    return json({ error: "unknown" }, 500);
  }
}
