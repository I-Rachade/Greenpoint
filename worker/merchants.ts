// Merchants (planung/marchand.md): shops that book deliveries and rides. Registration is in
// worker/auth.ts (registerMerchant); bookings, dispatch and pay of shop trips in
// worker/drivers.ts with the rules of worker/merchant-rules.ts. Here: the shop's backoffice
// (view, bookings log, activity log, shop details), the team and its invites, favorite and
// assigned drivers with their approval, check-in and check-out, and the admin's Merchants page.
// Shared rules in src/lib/merchants.ts, tables in 0035_merchants.sql.
import { BUSY_JOB_STATUSES, freshPosition, newDriverCode, parseDriverBadge, type FleetVehicleType, type JobStatus } from "../src/lib/drivers";
import type { LatLng } from "../src/lib/geo";
import {
  cleanRate,
  employeeLimit,
  MERCHANT_INVITE_DAYS,
  MERCHANT_PAY_MODES,
  MERCHANT_TIERS,
  nearShop,
  STANDARD_EMPLOYEE_LIMIT,
  cleanAddressLabel,
  hasStatistics,
  MAX_MERCHANT_ADDRESSES,
  merchantStats as computeStats,
  validStatsQuery,
  type AdminMerchant,
  type MerchantAddress,
  type MerchantAddressInput,
  type MerchantStats,
  type MerchantStatsQuery,
  type StatsCheckin,
  type DriverShops,
  type MerchantActivity,
  type MerchantApprover,
  type MerchantAssignmentRequest,
  type MerchantBookingsQuery,
  type MerchantCheckin,
  type MerchantDecision,
  type MerchantDriver,
  type MerchantDriverInput,
  type MerchantDriverKind,
  type MerchantDriverStatus,
  type MerchantInfo,
  type MerchantInvite,
  type MerchantInviteStatus,
  type MerchantJob,
  type MerchantMember,
  type MerchantPayMode,
  type MerchantShopInput,
  type MerchantStatus,
  type MerchantTier,
  type MerchantToday,
  type MerchantView,
  type MyMerchantInvite,
} from "../src/lib/merchants";
import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile } from "../src/lib/types";
import {
  balance,
  BUSY_SQL,
  closeJob,
  currentJob,
  customerThingsOpen,
  dispatch,
  DRIVER_SELECT,
  driverRow,
  driverSettings,
  JOB_SELECT,
  loadJob,
  receiveShopReturn,
  toJob,
  type DriverRow,
  type JobRow,
} from "./drivers";
import { requireDrivers } from "./features";
import { ApiError, nowIso, uuid } from "./http";
import { cleanShop, closeCheckin, membershipOf, merchantRow, openCheckin, type CheckinRow, type MerchantRow } from "./merchant-rules";
import { notifyUser } from "./notify";
import type { ParcelCtx } from "./parcels";
import { DB_CUSTOMER, DB_DRIVER } from "./roles";

const APP_URL = "https://app.poinderecharge.com";

// Rows ------------------------------------------------------------------------------

interface InviteRow {
  id: string;
  merchant_id: string;
  phone: string;
  invited_by: string;
  status: MerchantInviteStatus;
  token: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  user_id: string | null;
}

interface MemberRow {
  user_id: string;
  merchant_id: string;
  is_owner: number;
  created_at: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

interface AssignmentRow {
  id: string;
  merchant_id: string;
  driver_id: string;
  kind: MerchantDriverKind;
  status: MerchantDriverStatus;
  pay_mode: MerchantPayMode | null;
  rate_per_hour_fcfa: number | null;
  created_at: string;
  created_by: string;
  approved_at: string | null;
  approved_by: string | null;
  approved_as: MerchantApprover | null;
  ended_at: string | null;
  ended_by: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  v_type: FleetVehicleType | null;
  v_plate: string | null;
  checked_in_since: string | null;
  merchant_name: string;
  merchant_address: string;
  merchant_lat: number;
  merchant_lng: number;
}

const ASSIGNMENT_SELECT = `select md.*, d.full_name as driver_name, u.phone as driver_phone, v.type as v_type, v.plate as v_plate,
    (select k.in_at from merchant_checkins k where k.driver_id = md.driver_id and k.merchant_id = md.merchant_id and k.out_at is null) as checked_in_since,
    m.name as merchant_name, m.address as merchant_address, m.lat as merchant_lat, m.lng as merchant_lng
  from merchant_drivers md join merchants m on m.id = md.merchant_id join users u on u.id = md.driver_id
  left join drivers d on d.user_id = md.driver_id left join fleet_vehicles v on v.id = d.vehicle_id`;

const CHECKIN_SELECT = `select k.*, m.name as merchant_name, d.full_name as driver_name, dp.lat as pos_lat, dp.lng as pos_lng, dp.at as pos_at
  from merchant_checkins k join merchants m on m.id = k.merchant_id left join drivers d on d.user_id = k.driver_id
  left join driver_positions dp on dp.driver_id = k.driver_id`;

type CheckinView = CheckinRow & { merchant_name: string; driver_name: string | null; pos_lat?: number | null; pos_lng?: number | null; pos_at?: string | null };

interface AddressRow {
  id: string;
  merchant_id: string;
  label: string;
  address: string;
  phone: string;
  lat: number;
  lng: number;
  created_at: string;
}

function toAddress(r: AddressRow): MerchantAddress {
  return { id: r.id, label: r.label, address: r.address, phone: r.phone, lat: r.lat, lng: r.lng, createdAt: r.created_at };
}

const MEMBER_SELECT = `select mm.*, u.full_name, u.phone, u.email from merchant_members mm join users u on u.id = mm.user_id`;

function toInfo(m: MerchantRow, used: number): MerchantInfo {
  return {
    id: m.id,
    name: m.name,
    phone: m.phone,
    address: m.address,
    lat: m.lat,
    lng: m.lng,
    status: m.status,
    tier: m.tier,
    employeeLimit: employeeLimit(m.tier),
    used,
    ownerId: m.owner_id,
    createdAt: m.created_at,
  };
}

function toInvite(r: InviteRow): MerchantInvite {
  return { id: r.id, phone: r.phone, status: r.status, token: r.token, createdAt: r.created_at, expiresAt: r.expires_at, decidedAt: r.decided_at };
}

function toMember(r: MemberRow): MerchantMember {
  return { userId: r.user_id, fullName: r.full_name, phone: r.phone, email: r.email, isOwner: !!r.is_owner, since: r.created_at };
}

function toDriver(r: AssignmentRow): MerchantDriver {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    driverId: r.driver_id,
    driverName: r.driver_name ?? "",
    driverPhone: r.driver_phone,
    vehicle: r.v_type ? { type: r.v_type, plate: r.v_plate ?? "" } : null,
    kind: r.kind,
    status: r.status,
    payMode: r.pay_mode,
    ratePerHourFcfa: r.rate_per_hour_fcfa,
    createdAt: r.created_at,
    approvedAt: r.approved_at,
    approvedAs: r.approved_as,
    endedAt: r.ended_at,
    checkedInSince: r.kind === "assigned" ? r.checked_in_since : null,
  };
}

function toCheckin(r: CheckinView): MerchantCheckin {
  return {
    id: r.id,
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    driverId: r.driver_id,
    driverName: r.driver_name ?? "",
    payMode: r.pay_mode,
    ratePerHourFcfa: r.rate_per_hour_fcfa,
    inAt: r.in_at,
    outAt: r.out_at,
    outBy: r.out_by as MerchantCheckin["outBy"],
    amountFcfa: r.amount_fcfa,
    receivedAt: r.received_at,
    // Where a driver checked in now is (driver phase 2); not for ended check-ins.
    position: !r.out_at && r.pos_lat != null && r.pos_lng != null && r.pos_at ? freshPosition({ lat: r.pos_lat, lng: r.pos_lng, at: r.pos_at }) : null,
  };
}

/** The shop's trips with who of the shop booked each. */
async function toMerchantJobs(db: D1Database, rows: JobRow[]): Promise<MerchantJob[]> {
  const ids = [...new Set(rows.map((r) => r.booked_by).filter((id): id is string => !!id))];
  const names = new Map<string, string | null>();
  if (ids.length) {
    const { results } = await db
      .prepare(`select id, coalesce(full_name, phone, email) as name from users where id in (${ids.map(() => "?").join(", ")})`)
      .bind(...ids)
      .all<{ id: string; name: string | null }>();
    for (const r of results) names.set(r.id, r.name);
  }
  return rows.map((r) => ({
    ...toJob(r),
    ...(r.kind === "courier" && r.handover_code && (r.status === "picked_up" || r.status === "at_door") ? { handoverCode: r.handover_code } : {}),
    bookedBy: r.booked_by ? { userId: r.booked_by, name: names.get(r.booked_by) ?? null } : null,
  }));
}

/** Employees (the merchant not counted) plus open invites: what the limit counts. */
async function usedPlaces(db: D1Database, merchantId: string): Promise<number> {
  const row = await db
    .prepare(
      `select (select count(*) from merchant_members where merchant_id = ?1 and is_owner = 0)
            + (select count(*) from merchant_invites where merchant_id = ?1 and status = 'pending' and expires_at > ?2) as n`,
    )
    .bind(merchantId, nowIso())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function expireInvites(db: D1Database) {
  return db.prepare("update merchant_invites set status = 'expired', decided_at = ?1 where status = 'pending' and expires_at <= ?1").bind(nowIso()).run();
}

/** Audit entry of a shop: merchant_id in the changes puts it in the shop's activity log. */
function shopAudit(c: ParcelCtx, actor: string | null, table: Parameters<ParcelCtx["audit"]>[1], action: "insert" | "update" | "delete", rowId: string, merchantId: string, changes: Record<string, unknown>, userId: string | null = null) {
  return c.audit(actor, table, action, rowId, { merchant_id: merchantId, ...changes }, { userId });
}

// Access ----------------------------------------------------------------------------

interface Member {
  user: Profile;
  shop: MerchantRow;
  isOwner: boolean;
}

async function requireMember(c: ParcelCtx): Promise<Member> {
  const user = await c.requireUser();
  if (user.role !== "merchant") throw new ApiError("forbidden", 403);
  const member = await membershipOf(c.db, user.id);
  if (!member) throw new ApiError("forbidden", 403);
  return { user, ...member };
}

/** Until an admin approves the shop (and while it is suspended), its functions answer merchant_not_approved. */
async function requireApprovedMember(c: ParcelCtx): Promise<Member> {
  const m = await requireMember(c);
  if (m.shop.status !== "approved") throw new ApiError("merchant_not_approved", 403);
  return m;
}

/** The backoffice is the merchant's only (not the employees'). */
async function requireOwner(c: ParcelCtx): Promise<Member> {
  const m = await requireApprovedMember(c);
  if (!m.isOwner) throw new ApiError("forbidden", 403);
  return m;
}

// The shop --------------------------------------------------------------------------

function todayStart(): string {
  return `${nowIso().slice(0, 10)}T00:00:00.000Z`;
}

const RUNNING: JobStatus[] = ["open", ...BUSY_JOB_STATUSES];

export async function merchantView(c: ParcelCtx): Promise<MerchantView> {
  const { shop, isOwner } = await requireMember(c);
  const settings = await driverSettings(c.db);
  const today: MerchantToday = { booked: 0, running: 0, done: 0, failed: 0, cancelled: 0 };
  const empty = { live: [], members: [], invites: [], drivers: [], checkins: [], unpaid: [], addresses: [] };
  if (shop.status !== "approved") return { merchant: toInfo(shop, 0), isOwner, today, settings, ...empty };
  await expireInvites(c.db);
  const [live, counts, used, addresses] = await Promise.all([
    c.db
      .prepare(`${JOB_SELECT} where j.merchant_id = ? and j.status in (${RUNNING.map(() => "?").join(", ")}) order by j.created_at desc limit 100`)
      .bind(shop.id, ...RUNNING)
      .all<JobRow>(),
    c.db
      .prepare("select status, count(*) as n from delivery_jobs where merchant_id = ? and created_at >= ? group by status")
      .bind(shop.id, todayStart())
      .all<{ status: JobStatus; n: number }>(),
    usedPlaces(c.db, shop.id),
    c.db.prepare("select * from merchant_addresses where merchant_id = ? order by created_at").bind(shop.id).all<AddressRow>(),
  ]);
  for (const r of counts.results) {
    today.booked += r.n;
    if (r.status === "done") today.done += r.n;
    else if (r.status === "failed") today.failed += r.n;
    else if (r.status === "cancelled") today.cancelled += r.n;
    else today.running += r.n;
  }
  const base = {
    merchant: toInfo(shop, used),
    isOwner,
    today,
    settings,
    live: await toMerchantJobs(c.db, live.results),
    addresses: addresses.results.map(toAddress),
  };
  if (!isOwner) return { ...base, members: [], invites: [], drivers: [], checkins: [], unpaid: [] };
  const [members, invites, drivers, checkins, unpaid] = await Promise.all([
    c.db.prepare(`${MEMBER_SELECT} where mm.merchant_id = ? order by mm.is_owner desc, mm.created_at`).bind(shop.id).all<MemberRow>(),
    c.db.prepare("select * from merchant_invites where merchant_id = ? order by created_at desc limit 30").bind(shop.id).all<InviteRow>(),
    c.db
      .prepare(`${ASSIGNMENT_SELECT} where md.merchant_id = ? and (md.status in ('pending', 'active') or md.created_at > ?) order by md.kind, md.created_at desc`)
      .bind(shop.id, new Date(Date.now() - 30 * 86_400_000).toISOString())
      .all<AssignmentRow>(),
    c.db.prepare(`${CHECKIN_SELECT} where k.merchant_id = ? and k.out_at is null order by k.in_at`).bind(shop.id).all<CheckinView>(),
    c.db
      .prepare(`${CHECKIN_SELECT} where k.merchant_id = ? and k.pay_mode = 'hourly' and k.out_at is not null and k.received_at is null order by k.in_at`)
      .bind(shop.id)
      .all<CheckinView>(),
  ]);
  return {
    ...base,
    members: members.results.map(toMember),
    invites: invites.results.map(toInvite),
    drivers: drivers.results.map(toDriver),
    checkins: checkins.results.map(toCheckin),
    unpaid: unpaid.results.map(toCheckin),
  };
}

/** Most lines of the bookings log (and its CSV export) for one period. */
const BOOKINGS_MAX = 2000;

/** The shop's bookings in a period (every member: decision 4), newest first. */
export async function merchantBookings(c: ParcelCtx, query: MerchantBookingsQuery): Promise<MerchantJob[]> {
  const { shop } = await requireApprovedMember(c);
  const from = String(query?.from ?? "");
  const to = String(query?.to ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new ApiError("bad_request");
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const where = ["j.merchant_id = ?", "j.created_at >= ?", "j.created_at < ?"];
  const params: unknown[] = [shop.id, `${from}T00:00:00.000Z`, end.toISOString()];
  if (query.status) {
    where.push("j.status = ?");
    params.push(query.status);
  }
  if (query.bookedBy) {
    where.push("j.booked_by = ?");
    params.push(query.bookedBy);
  }
  const { results } = await c.db
    .prepare(`${JOB_SELECT} where ${where.join(" and ")} order by j.created_at desc limit ${BOOKINGS_MAX}`)
    .bind(...params)
    .all<JobRow>();
  return toMerchantJobs(c.db, results);
}

/**
 * The shop's statistics (merchant of an unlocked shop only, decision 5): trips booked in the
 * period, and the check-ins of its assigned drivers that ended in it.
 */
export async function merchantStatistics(c: ParcelCtx, query: Partial<MerchantStatsQuery>): Promise<MerchantStats> {
  const { shop } = await requireOwner(c);
  if (!hasStatistics(shop.tier)) throw new ApiError("merchant_locked", 403);
  if (!validStatsQuery(query)) throw new ApiError("bad_request");
  const start = `${query.from}T00:00:00.000Z`;
  const end = new Date(`${query.to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  const [trips, checkins] = await Promise.all([
    c.db
      .prepare(
        `select j.status, j.fare_fcfa, j.created_at, j.picked_up_at, j.done_at, j.booked_by, j.driver_id, coalesce(u.full_name, u.phone, u.email) as booker
         from delivery_jobs j left join users u on u.id = j.booked_by
         where j.merchant_id = ? and j.created_at >= ? and j.created_at < ?`,
      )
      .bind(shop.id, start, end.toISOString())
      .all<{ status: JobStatus; fare_fcfa: number; created_at: string; picked_up_at: string | null; done_at: string | null; booked_by: string | null; driver_id: string | null; booker: string | null }>(),
    c.db
      .prepare(`${CHECKIN_SELECT} where k.merchant_id = ? and k.out_at >= ? and k.out_at < ?`)
      .bind(shop.id, start, end.toISOString())
      .all<CheckinView>(),
  ]);
  return computeStats(
    query,
    trips.results.map((t) => ({
      status: t.status,
      fareFcfa: t.fare_fcfa,
      createdAt: t.created_at,
      pickedUpAt: t.picked_up_at,
      doneAt: t.done_at,
      bookedBy: t.booked_by ? { userId: t.booked_by, name: t.booker } : null,
      driverId: t.driver_id,
    })),
    checkins.results.map(
      (k): StatsCheckin => ({ driverId: k.driver_id, driverName: k.driver_name ?? "", payMode: k.pay_mode, inAt: k.in_at, outAt: k.out_at!, amountFcfa: k.amount_fcfa }),
    ),
  );
}

/**
 * Any member confirms a courier whose recipient was absent is back at the shop. Also while
 * the shop is suspended, so the driver is not left waiting.
 */
export async function confirmShopReturn(c: ParcelCtx, jobId: string) {
  const { user, shop } = await requireMember(c);
  const job = await loadJob(c.db, jobId);
  if (job.merchant_id !== shop.id) throw new ApiError("job_not_found", 404);
  await receiveShopReturn(c, job, user.id);
}

// Saved addresses -------------------------------------------------------------------

/** The merchant saves a pickup address (at most MAX_MERCHANT_ADDRESSES). */
export async function addMerchantAddress(c: ParcelCtx, input: Partial<MerchantAddressInput>): Promise<MerchantAddress> {
  const { user, shop } = await requireOwner(c);
  const label = cleanAddressLabel(input?.label);
  if (!label) throw new ApiError("bad_request");
  const place = cleanShop({ ...input, name: label });
  const id = uuid();
  const now = nowIso();
  // The limit in the insert itself, so two saves at once cannot pass it.
  const res = await c.db
    .prepare(
      `insert into merchant_addresses (id, merchant_id, label, address, phone, lat, lng, created_at, created_by)
       select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9 where (select count(*) from merchant_addresses where merchant_id = ?2) < ?10`,
    )
    .bind(id, shop.id, label, place.address, place.phone, place.lat, place.lng, now, user.id, MAX_MERCHANT_ADDRESSES)
    .run();
  if (!res.meta.changes) throw new ApiError("address_limit");
  await shopAudit(c, user.id, "merchant_addresses", "insert", id, shop.id, { label, address: place.address }).run();
  return { id, label, address: place.address, phone: place.phone, lat: place.lat, lng: place.lng, createdAt: now };
}

export async function removeMerchantAddress(c: ParcelCtx, addressId: string) {
  const { user, shop } = await requireOwner(c);
  const row = await c.db.prepare("select * from merchant_addresses where id = ? and merchant_id = ?").bind(addressId, shop.id).first<AddressRow>();
  if (!row) throw new ApiError("not_found", 404);
  await c.db.batch([
    c.db.prepare("delete from merchant_addresses where id = ?").bind(row.id),
    shopAudit(c, user.id, "merchant_addresses", "delete", row.id, shop.id, { label: row.label, address: row.address }),
  ]);
}

/** The shop's activity log (merchant only): team, drivers, check-ins, bookings and cancellations. */
export async function merchantActivity(c: ParcelCtx): Promise<MerchantActivity[]> {
  const { shop } = await requireOwner(c);
  const { results } = await c.db
    .prepare(
      `select a.id, a.at, a.table_name, a.action, a.changes, coalesce(u.full_name, u.phone, u.email) as actor_name from audit_log a
       left join users u on u.id = a.actor
       where json_extract(a.changes, '$.merchant_id') = ?1
          or (a.table_name = 'delivery_jobs' and a.row_id in (select id from delivery_jobs where merchant_id = ?1))
       order by a.id desc limit 300`,
    )
    .bind(shop.id)
    .all<{ id: number; at: string; table_name: string; action: string; changes: string; actor_name: string | null }>();
  return results.map((r) => {
    let changes: Record<string, unknown> = {};
    try {
      changes = JSON.parse(r.changes) as Record<string, unknown>;
    } catch {
      /* kept empty */
    }
    return { id: r.id, at: r.at, actorName: r.actor_name, table: r.table_name, action: r.action, changes };
  });
}

/** The merchant changes the shop's name, phone or address. */
export async function updateShop(c: ParcelCtx, input: MerchantShopInput) {
  const { user, shop } = await requireOwner(c);
  const next = cleanShop(input);
  const changes: Record<string, unknown> = {};
  for (const key of ["name", "phone", "address", "lat", "lng"] as const) {
    if (shop[key] !== next[key]) changes[key] = [shop[key], next[key]];
  }
  if (!Object.keys(changes).length) return;
  await c.db.batch([
    c.db.prepare("update merchants set name = ?, phone = ?, address = ?, lat = ?, lng = ? where id = ?").bind(next.name, next.phone, next.address, next.lat, next.lng, shop.id),
    shopAudit(c, user.id, "merchants", "update", shop.id, shop.id, changes),
  ]);
}

// Team ------------------------------------------------------------------------------

/** R12: a number without an account, or an empty customer account, may be invited. Checked again on accepting. */
async function checkInvitable(db: D1Database, phone: string) {
  const account = await db.prepare("select id, role from users where phone = ?").bind(phone).first<{ id: string; role: string }>();
  if (!account) return;
  if (account.role === "merchant") throw new ApiError("already_in_merchant", 409);
  if (account.role !== DB_CUSTOMER) throw new ApiError("invite_number_taken", 409);
  if (await customerThingsOpen(db, account.id, phone)) throw new ApiError("invite_account_not_empty", 409);
}

/** The merchant invites an employee by phone number; the person confirms in the app. */
export async function inviteEmployee(c: ParcelCtx, rawPhone: unknown): Promise<MerchantInvite> {
  const { user, shop } = await requireOwner(c);
  const phone = normalizeTogoPhone(String(rawPhone ?? ""));
  if (!phone) throw new ApiError("phone_not_allowed");
  await expireInvites(c.db);
  await checkInvitable(c.db, phone);
  const open = await c.db.prepare("select 1 from merchant_invites where merchant_id = ? and phone = ? and status = 'pending'").bind(shop.id, phone).first();
  if (open) throw new ApiError("invite_pending", 409);
  const now = nowIso();
  const expires = new Date(Date.now() + MERCHANT_INVITE_DAYS * 86_400_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = uuid();
    let changes = 0;
    try {
      // The limit in the same statement as the insert, so two invites at once cannot pass it together.
      const res = await c.db
        .prepare(
          `insert into merchant_invites (id, merchant_id, phone, invited_by, status, token, created_at, expires_at)
           select ?1, ?2, ?3, ?4, 'pending', ?5, ?6, ?7
           where (select tier from merchants where id = ?2) = 'unlocked'
              or (select count(*) from merchant_members where merchant_id = ?2 and is_owner = 0)
               + (select count(*) from merchant_invites where merchant_id = ?2 and status = 'pending' and expires_at > ?6) < ?8`,
        )
        .bind(id, shop.id, phone, user.id, newDriverCode(), now, expires, STANDARD_EMPLOYEE_LIMIT)
        .run();
      changes = res.meta?.changes ?? 0;
    } catch (err) {
      if (/UNIQUE/i.test(String(err)) && /token/i.test(String(err))) continue;
      if (/UNIQUE/i.test(String(err))) throw new ApiError("invite_pending", 409);
      throw err;
    }
    if (!changes) throw new ApiError("merchant_limit", 409);
    await shopAudit(c, user.id, "merchant_invites", "insert", id, shop.id, { phone }).run();
    const row = await c.db.prepare("select * from merchant_invites where id = ?").bind(id).first<InviteRow>();
    return toInvite(row!);
  }
  throw new ApiError("unknown", 500);
}

export async function revokeEmployeeInvite(c: ParcelCtx, inviteId: string) {
  const { user, shop } = await requireOwner(c);
  await expireInvites(c.db);
  const row = await c.db.prepare("select * from merchant_invites where id = ?").bind(inviteId).first<InviteRow>();
  if (!row || row.status !== "pending" || row.merchant_id !== shop.id) throw new ApiError("invite_not_found", 404);
  await c.db.batch([
    c.db.prepare("update merchant_invites set status = 'revoked', decided_at = ? where id = ? and status = 'pending'").bind(nowIso(), inviteId),
    shopAudit(c, user.id, "merchant_invites", "update", inviteId, shop.id, { status: ["pending", "revoked"] }),
  ]);
}

/** Open shop invites for the signed-in customer's phone number. */
export async function myMerchantInvites(c: ParcelCtx): Promise<MyMerchantInvite[]> {
  const user = await c.user();
  if (!user?.phone || user.role !== "customer") return [];
  await expireInvites(c.db);
  const { results } = await c.db
    .prepare(
      `select i.token, i.expires_at, m.name from merchant_invites i join merchants m on m.id = i.merchant_id
       where i.phone = ? and i.status = 'pending' and m.status = 'approved' order by i.created_at`,
    )
    .bind(user.phone)
    .all<{ token: string; expires_at: string; name: string }>();
  return results.map((r) => ({ token: r.token, merchantName: r.name, expiresAt: r.expires_at }));
}

async function inviteForMe(c: ParcelCtx, user: Profile, token: string): Promise<InviteRow> {
  await expireInvites(c.db);
  const row = await c.db.prepare("select * from merchant_invites where token = ?").bind(String(token ?? "").trim().toUpperCase()).first<InviteRow>();
  if (!row || row.status !== "pending" || !user.phone || row.phone !== user.phone) throw new ApiError("invite_not_found", 404);
  return row;
}

/** The invited person accepts: the customer account becomes an employee account of the shop (R12, R15). */
export async function acceptMerchantInvite(c: ParcelCtx, token: string) {
  const user = await c.requireUser();
  const invite = await inviteForMe(c, user, token);
  if (user.role !== "customer") throw new ApiError("has_other_role");
  const shop = await merchantRow(c.db, invite.merchant_id);
  if (!shop || shop.status !== "approved") throw new ApiError("invite_not_found", 404);
  if (await customerThingsOpen(c.db, user.id, user.phone)) throw new ApiError("invite_account_not_empty", 409);
  if (await membershipOf(c.db, user.id)) throw new ApiError("already_in_merchant", 409);
  const now = nowIso();
  await c.db.batch([
    // Guarded: the invite must still be open, so it is used once; the membership and the role follow it.
    c.db.prepare("update merchant_invites set status = 'accepted', decided_at = ?, user_id = ? where id = ? and status = 'pending'").bind(now, user.id, invite.id),
    c.db
      .prepare(
        `insert into merchant_members (user_id, merchant_id, is_owner, created_at, added_by)
         select ?1, ?2, 0, ?3, ?4 where exists (select 1 from merchant_invites where id = ?5 and status = 'accepted' and user_id = ?1)`,
      )
      .bind(user.id, shop.id, now, invite.invited_by, invite.id),
    // One role per account: the customer account becomes a merchant account.
    c.db
      .prepare("update users set role = 'merchant' where id = ?1 and role = ?2 and exists (select 1 from merchant_members where user_id = ?1 and merchant_id = ?3)")
      .bind(user.id, DB_CUSTOMER, shop.id),
    c.db.prepare("update merchant_invites set status = 'expired', decided_at = ? where phone = ? and status = 'pending' and id <> ?").bind(now, invite.phone, invite.id),
    shopAudit(c, user.id, "merchant_invites", "update", invite.id, shop.id, { status: ["pending", "accepted"] }, user.id),
    shopAudit(c, user.id, "merchant_members", "insert", user.id, shop.id, { invite: invite.id }, user.id),
    c.audit(user.id, "profiles", "update", user.id, { role: ["customer", "merchant"] }, { userId: user.id }),
  ]);
}

export async function declineMerchantInvite(c: ParcelCtx, token: string) {
  const user = await c.requireUser();
  const invite = await inviteForMe(c, user, token);
  await c.db.batch([
    c.db.prepare("update merchant_invites set status = 'declined', decided_at = ?, user_id = ? where id = ? and status = 'pending'").bind(nowIso(), user.id, invite.id),
    shopAudit(c, user.id, "merchant_invites", "update", invite.id, invite.merchant_id, { status: ["pending", "declined"] }, user.id),
  ]);
}

/** Statements that take an employee out of the shop: the account becomes a customer account again (R15). */
function releaseMember(c: ParcelCtx, actor: string, memberId: string, merchantId: string): D1PreparedStatement[] {
  return [
    c.db.prepare("delete from merchant_members where user_id = ? and merchant_id = ? and is_owner = 0").bind(memberId, merchantId),
    c.db.prepare("update users set role = ? where id = ? and role = 'merchant'").bind(DB_CUSTOMER, memberId),
    shopAudit(c, actor, "merchant_members", "delete", memberId, merchantId, {}, memberId),
    c.audit(actor, "profiles", "update", memberId, { role: ["merchant", "customer"] }, { userId: memberId }),
  ];
}

/** The merchant takes an employee out of the shop. Their bookings stay with the shop. The merchant cannot be removed. */
export async function removeEmployee(c: ParcelCtx, memberId: string) {
  const { user, shop } = await requireOwner(c);
  const row = await c.db.prepare("select * from merchant_members where user_id = ? and merchant_id = ?").bind(memberId, shop.id).first<MemberRow>();
  if (!row) throw new ApiError("not_found", 404);
  if (row.is_owner) throw new ApiError("forbidden", 403);
  await c.db.batch(releaseMember(c, user.id, memberId, shop.id));
}

// Drivers of the shop -----------------------------------------------------------------

/** An active driver by driver code (under their QR code) or phone number. */
async function findDriver(db: D1Database, raw: unknown): Promise<DriverRow> {
  const text = String(raw ?? "");
  const phone = normalizeTogoPhone(text);
  const code = phone ? null : parseDriverBadge(text);
  const row = phone
    ? await db.prepare(`${DRIVER_SELECT} where u.phone = ?`).bind(phone).first<DriverRow>()
    : code
      ? await db.prepare(`${DRIVER_SELECT} where d.code = ?`).bind(code).first<DriverRow>()
      : null;
  if (!row || row.status !== "active" || row.u_role !== DB_DRIVER) throw new ApiError("driver_not_found", 404);
  return row;
}

async function assignment(db: D1Database, id: string): Promise<AssignmentRow> {
  const row = await db.prepare(`${ASSIGNMENT_SELECT} where md.id = ?`).bind(id).first<AssignmentRow>();
  if (!row) throw new ApiError("assignment_not_found", 404);
  return row;
}

function cleanPay(input: { payMode?: unknown; ratePerHourFcfa?: unknown }): { mode: MerchantPayMode; rate: number | null } {
  const mode = input?.payMode as MerchantPayMode;
  if (!MERCHANT_PAY_MODES.includes(mode)) throw new ApiError("bad_request");
  const rate = cleanRate(mode, input.ratePerHourFcfa);
  if (rate === undefined) throw new ApiError("bad_request");
  return { mode, rate };
}

function payText(mode: MerchantPayMode, rate: number | null): string {
  return mode === "hourly" ? `${rate} FCFA de l'heure` : "à la course";
}

/** The driver (and their fleet manager) are told about a new or changed assignment to approve. */
async function tellAssignment(c: ParcelCtx, shop: MerchantRow, driverId: string, mode: MerchantPayMode, rate: number | null) {
  const message = {
    subject: `${shop.name} veut vous affecter`,
    text: `poinderecharge : ${shop.name} (${shop.address}) souhaite vous affecter comme chauffeur, payé ${payText(mode, rate)}. Acceptez ou refusez dans l'app : ${APP_URL}/chauffeur`,
  };
  const manager = await c.db.prepare("select manager_id from fleet_manager_drivers where driver_id = ?").bind(driverId).first<{ manager_id: string }>();
  await Promise.all([notifyUser(c.env, driverId, message), ...(manager ? [notifyUser(c.env, manager.manager_id, message)] : [])]);
}

/**
 * The merchant adds a favorite driver (told only, decision 8) or assigns a driver with a
 * pay option (pending until the driver, their fleet manager or an admin approves, decision 9).
 */
export async function addMerchantDriver(c: ParcelCtx, input: MerchantDriverInput): Promise<MerchantDriver> {
  const { user, shop } = await requireOwner(c);
  await requireDrivers(c.db);
  const kind = input?.kind;
  if (kind !== "favorite" && kind !== "assigned") throw new ApiError("bad_request");
  const pay = kind === "assigned" ? cleanPay(input) : null;
  const driver = await findDriver(c.db, input.driver);
  const id = uuid();
  const now = nowIso();
  try {
    await c.db.batch([
      c.db
        .prepare(
          `insert into merchant_drivers (id, merchant_id, driver_id, kind, status, pay_mode, rate_per_hour_fcfa, created_at, created_by)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, shop.id, driver.user_id, kind, kind === "favorite" ? "active" : "pending", pay?.mode ?? null, pay?.rate ?? null, now, user.id),
      shopAudit(c, user.id, "merchant_drivers", "insert", id, shop.id, { kind, driver: driver.user_id, pay_mode: pay?.mode ?? null, rate_per_hour_fcfa: pay?.rate ?? null }, driver.user_id),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("merchant_driver_exists", 409);
    throw err;
  }
  if (pay) await tellAssignment(c, shop, driver.user_id, pay.mode, pay.rate);
  else {
    await notifyUser(c.env, driver.user_id, {
      subject: `${shop.name} vous a ajouté à ses chauffeurs favoris`,
      text: `poinderecharge : ${shop.name} (${shop.address}) vous a ajouté à ses chauffeurs favoris. Ses courses vous seront proposées en premier quand vous êtes dans la file d'une station proche.`,
    });
  }
  return toDriver(await assignment(c.db, id));
}

/** A new pay option for an assigned driver: needs a new approval. Not while the driver is checked in at the shop. */
export async function changeMerchantPay(c: ParcelCtx, assignmentId: string, input: { payMode?: unknown; ratePerHourFcfa?: unknown }) {
  const { user, shop } = await requireOwner(c);
  const row = await assignment(c.db, assignmentId);
  if (row.merchant_id !== shop.id || row.kind !== "assigned" || !["pending", "active"].includes(row.status)) throw new ApiError("assignment_not_found", 404);
  const pay = cleanPay(input);
  if (row.checked_in_since) throw new ApiError("driver_checked_in_here");
  if (pay.mode === row.pay_mode && pay.rate === row.rate_per_hour_fcfa) return;
  await c.db.batch([
    c.db
      .prepare(
        `update merchant_drivers set pay_mode = ?, rate_per_hour_fcfa = ?, status = 'pending', approved_at = null, approved_by = null, approved_as = null
         where id = ? and status in ('pending', 'active')`,
      )
      .bind(pay.mode, pay.rate, row.id),
    shopAudit(
      c,
      user.id,
      "merchant_drivers",
      "update",
      row.id,
      shop.id,
      { pay_mode: [row.pay_mode, pay.mode], rate_per_hour_fcfa: [row.rate_per_hour_fcfa, pay.rate], status: [row.status, "pending"] },
      row.driver_id,
    ),
  ]);
  await tellAssignment(c, shop, row.driver_id, pay.mode, pay.rate);
}

/**
 * Ends a favorite or an assignment: by the merchant, the driver or an admin. A driver
 * checked in at the shop is checked out with it (not during a trip).
 */
export async function endMerchantDriver(c: ParcelCtx, assignmentId: string) {
  const user = await c.requireUser();
  // The role first (R2): nothing is looked up for someone who may not end anything.
  if (user.role !== "admin" && user.role !== "driver" && user.role !== "merchant") throw new ApiError("forbidden", 403);
  const row = await assignment(c.db, assignmentId);
  if (!["pending", "active"].includes(row.status)) throw new ApiError("assignment_not_found", 404);
  let by: "merchant" | "driver" | "admin";
  if (user.role === "admin") by = "admin";
  else if (user.role === "driver" && user.id === row.driver_id) by = "driver";
  else {
    const { shop } = await requireOwner(c);
    if (shop.id !== row.merchant_id) throw new ApiError("assignment_not_found", 404);
    by = "merchant";
  }
  const checkin = row.kind === "assigned" ? await openCheckin(c.db, row.driver_id) : null;
  const here = checkin && checkin.merchant_id === row.merchant_id ? checkin : null;
  if (here && (await busyForShop(c.db, row.driver_id))) throw new ApiError("driver_busy");
  const now = nowIso();
  await c.db.batch([
    c.db.prepare("update merchant_drivers set status = 'ended', ended_at = ?, ended_by = ? where id = ? and status in ('pending', 'active')").bind(now, user.id, row.id),
    shopAudit(c, user.id, "merchant_drivers", "update", row.id, row.merchant_id, { status: [row.status, "ended"], by }, row.driver_id),
    ...(here ? closeCheckin(c, here, by, user.id, now) : []),
  ]);
}

async function busyForShop(db: D1Database, driverId: string): Promise<boolean> {
  return !!(await currentJob(db, driverId));
}

/** The merchant checks a driver out (e.g. they left the shop); not during a trip. */
export async function merchantCheckout(c: ParcelCtx, driverId: string) {
  const { user, shop } = await requireOwner(c);
  const checkin = await openCheckin(c.db, driverId);
  if (!checkin || checkin.merchant_id !== shop.id) throw new ApiError("not_assigned", 404);
  if (await busyForShop(c.db, driverId)) throw new ApiError("driver_busy");
  await c.db.batch(closeCheckin(c, checkin, "merchant", user.id));
}

// Approval of assignments ---------------------------------------------------------------

/** Assignments waiting for the signed-in driver, the fleet manager's drivers, or (admin) everyone. */
export async function assignmentRequests(c: ParcelCtx): Promise<MerchantAssignmentRequest[]> {
  const user = await c.requireUser();
  let sql: string;
  let params: unknown[];
  if (user.role === "admin") {
    sql = `${ASSIGNMENT_SELECT} where md.kind = 'assigned' and md.status = 'pending' and m.status = 'approved' order by md.created_at`;
    params = [];
  } else if (user.role === "driver") {
    sql = `${ASSIGNMENT_SELECT} where md.kind = 'assigned' and md.status = 'pending' and m.status = 'approved' and md.driver_id = ? order by md.created_at`;
    params = [user.id];
  } else if (user.role === "fleet_manager") {
    sql = `${ASSIGNMENT_SELECT} join fleet_manager_drivers f on f.driver_id = md.driver_id
      where md.kind = 'assigned' and md.status = 'pending' and m.status = 'approved' and f.manager_id = ? order by md.created_at`;
    params = [user.id];
  } else {
    throw new ApiError("forbidden", 403);
  }
  const { results } = await c.db.prepare(sql).bind(...params).all<AssignmentRow>();
  return results.map((r) => ({
    id: r.id,
    merchantId: r.merchant_id,
    merchantName: r.merchant_name,
    merchantAddress: r.merchant_address,
    driverId: r.driver_id,
    driverName: r.driver_name ?? "",
    payMode: r.pay_mode!,
    ratePerHourFcfa: r.rate_per_hour_fcfa,
    createdAt: r.created_at,
  }));
}

/** One of: the driver, the driver's fleet manager or an admin approves or declines an assignment with its pay option (decision 9). */
export async function decideAssignment(c: ParcelCtx, assignmentId: string, approve: boolean) {
  const user = await c.requireUser();
  if (user.role !== "admin" && user.role !== "driver" && user.role !== "fleet_manager") throw new ApiError("forbidden", 403);
  const row = await assignment(c.db, assignmentId);
  if (row.kind !== "assigned" || row.status !== "pending") throw new ApiError("assignment_not_found", 404);
  let as: MerchantApprover;
  if (user.role === "admin") as = "admin";
  else if (user.role === "driver" && user.id === row.driver_id) as = "driver";
  else if (user.role === "fleet_manager") {
    const mine = await c.db.prepare("select 1 from fleet_manager_drivers where driver_id = ? and manager_id = ?").bind(row.driver_id, user.id).first();
    if (!mine) throw new ApiError("assignment_not_found", 404);
    as = "fleet_manager";
  } else throw new ApiError("assignment_not_found", 404);
  const shop = await merchantRow(c.db, row.merchant_id);
  if (!shop || shop.status !== "approved") throw new ApiError("merchant_not_approved", 409);
  const next: MerchantDriverStatus = approve ? "active" : "declined";
  const res = await c.db.batch([
    c.db
      .prepare("update merchant_drivers set status = ?, approved_at = ?, approved_by = ?, approved_as = ? where id = ? and status = 'pending'")
      .bind(next, nowIso(), user.id, as, row.id),
    shopAudit(c, user.id, "merchant_drivers", "update", row.id, row.merchant_id, { status: ["pending", next], as, pay_mode: row.pay_mode, rate_per_hour_fcfa: row.rate_per_hour_fcfa }, row.driver_id),
  ]);
  if (!res[0].meta.changes) throw new ApiError("assignment_not_found", 404);
  await notifyUser(c.env, shop.owner_id, {
    subject: approve ? `${row.driver_name ?? "Le chauffeur"} est affecté à ${shop.name}` : `Affectation refusée`,
    text: approve
      ? `poinderecharge : l'affectation de ${row.driver_name ?? "votre chauffeur"} (${payText(row.pay_mode!, row.rate_per_hour_fcfa)}) est acceptée. Il peut se déclarer chez vous dans l'app.`
      : `poinderecharge : l'affectation de ${row.driver_name ?? "votre chauffeur"} à ${shop.name} a été refusée.`,
  });
}

// The driver ----------------------------------------------------------------------------

async function requireActiveDriver(c: ParcelCtx): Promise<{ user: Profile; row: DriverRow }> {
  const user = await c.requireUser();
  if (user.role !== "driver") throw new ApiError("not_a_driver", 403);
  const row = await driverRow(c.db, user.id);
  if (!row || row.status !== "active" || row.u_role !== DB_DRIVER) throw new ApiError("not_a_driver", 403);
  return { user, row };
}

export async function driverShops(c: ParcelCtx): Promise<DriverShops> {
  const { user } = await requireActiveDriver(c);
  const [assigned, favorites, checkin, unpaid] = await Promise.all([
    c.db
      .prepare(`${ASSIGNMENT_SELECT} where md.driver_id = ? and md.kind = 'assigned' and md.status in ('pending', 'active') and m.status = 'approved' order by m.name`)
      .bind(user.id)
      .all<AssignmentRow>(),
    c.db
      .prepare(
        `select md.merchant_id, m.name from merchant_drivers md join merchants m on m.id = md.merchant_id
         where md.driver_id = ? and md.kind = 'favorite' and md.status = 'active' and m.status = 'approved' order by m.name`,
      )
      .bind(user.id)
      .all<{ merchant_id: string; name: string }>(),
    c.db.prepare(`${CHECKIN_SELECT} where k.driver_id = ? and k.out_at is null`).bind(user.id).first<CheckinView>(),
    c.db
      .prepare(`${CHECKIN_SELECT} where k.driver_id = ? and k.pay_mode = 'hourly' and k.out_at is not null and k.received_at is null order by k.in_at`)
      .bind(user.id)
      .all<CheckinView>(),
  ]);
  return {
    assignments: assigned.results.map((r) => ({
      ...toDriver(r),
      merchantName: r.merchant_name,
      merchantAddress: r.merchant_address,
      merchantLat: r.merchant_lat,
      merchantLng: r.merchant_lng,
    })),
    favoriteOf: favorites.results.map((f) => ({ merchantId: f.merchant_id, merchantName: f.name })),
    checkin: checkin ? toCheckin(checkin) : null,
    unpaid: unpaid.results.map(toCheckin),
  };
}

/**
 * "Je suis chez <shop>": with an approved assignment, close to the shop (decision 12), not on a
 * trip and below the cash limit. The driver leaves any station queue and gets only the
 * shop's trips until they check out. One check-in at a time (decision 10).
 */
export async function checkIn(c: ParcelCtx, merchantId: string, position: unknown) {
  const { user, row } = await requireActiveDriver(c);
  await requireDrivers(c.db);
  if (!row.vehicle_id || !row.v_active) throw new ApiError("no_vehicle");
  const link = await c.db
    .prepare("select * from merchant_drivers where merchant_id = ? and driver_id = ? and kind = 'assigned' and status = 'active'")
    .bind(merchantId, user.id)
    .first<AssignmentRow>();
  const shop = await merchantRow(c.db, merchantId);
  if (!link || !shop) throw new ApiError("not_assigned", 404);
  if (shop.status !== "approved") throw new ApiError("merchant_not_approved", 409);
  if (await openCheckin(c.db, user.id)) throw new ApiError("checked_in_at_shop");
  if (await currentJob(c.db, user.id)) throw new ApiError("driver_busy");
  const s = await driverSettings(c.db);
  if ((await balance(c.db, user.id)).balance >= s.cashLimitFcfa) throw new ApiError("cash_limit");
  const p = position as LatLng | null;
  if (!p || typeof p.lat !== "number" || typeof p.lng !== "number" || !nearShop(p, shop)) throw new ApiError("too_far");
  const id = uuid();
  try {
    await c.db.batch([
      c.db
        .prepare(
          `insert into merchant_checkins (id, merchant_id, driver_id, assignment_id, pay_mode, rate_per_hour_fcfa, in_at)
           select ?1, ?2, ?3, ?4, ?5, ?6, ?7 where not exists (select 1 from delivery_jobs where driver_id = ?3 and status in ${BUSY_SQL})`,
        )
        .bind(id, shop.id, user.id, link.id, link.pay_mode, link.rate_per_hour_fcfa, nowIso()),
      c.db.prepare("delete from driver_queue where driver_id = ? and exists (select 1 from merchant_checkins where id = ?)").bind(user.id, id),
      shopAudit(c, user.id, "merchant_checkins", "insert", id, shop.id, { pay_mode: link.pay_mode, rate_per_hour_fcfa: link.rate_per_hour_fcfa }, user.id),
    ]);
  } catch (err) {
    if (/UNIQUE/i.test(String(err))) throw new ApiError("checked_in_at_shop");
    throw err;
  }
  if (!(await openCheckin(c.db, user.id))) throw new ApiError("driver_busy");
  await dispatch(c);
}

/** "Je pars": any time except during a trip (finish it first). Afterwards a normal driver again. */
export async function checkOut(c: ParcelCtx) {
  const { user } = await requireActiveDriver(c);
  const checkin = await openCheckin(c.db, user.id);
  if (!checkin) return;
  if (await busyForShop(c.db, user.id)) throw new ApiError("driver_busy");
  await c.db.batch(closeCheckin(c, checkin, "driver", user.id));
}

/** The driver confirms the shop paid the hours of a check-in. */
export async function confirmHoursReceived(c: ParcelCtx, checkinId: string) {
  const { user } = await requireActiveDriver(c);
  const row = await c.db.prepare("select * from merchant_checkins where id = ?").bind(checkinId).first<CheckinRow>();
  if (!row || row.driver_id !== user.id || row.pay_mode !== "hourly" || !row.out_at || row.received_at) throw new ApiError("not_found", 404);
  await c.db.batch([
    c.db.prepare("update merchant_checkins set received_at = ? where id = ? and received_at is null").bind(nowIso(), row.id),
    shopAudit(c, user.id, "merchant_checkins", "update", row.id, row.merchant_id, { received: row.amount_fcfa }, user.id),
  ]);
}

// Backoffice ------------------------------------------------------------------------------

export async function adminMerchants(c: ParcelCtx): Promise<AdminMerchant[]> {
  await c.requireAdmin();
  await expireInvites(c.db);
  const [shops, members, invites, drivers] = await Promise.all([
    c.db
      .prepare(
        `select m.*, coalesce(u.phone, u.email) as contact from merchants m join users u on u.id = m.owner_id
         order by case m.status when 'pending' then 0 when 'approved' then 1 when 'suspended' then 2 else 3 end, m.created_at desc`,
      )
      .all<MerchantRow & { contact: string | null }>(),
    c.db.prepare(`${MEMBER_SELECT} order by mm.is_owner desc, mm.created_at`).all<MemberRow>(),
    c.db.prepare("select * from merchant_invites order by created_at desc limit 500").all<InviteRow>(),
    c.db.prepare(`${ASSIGNMENT_SELECT} where md.status in ('pending', 'active') order by md.kind, md.created_at desc`).all<AssignmentRow>(),
  ]);
  return shops.results.map((m) => {
    const team = members.results.filter((r) => r.merchant_id === m.id);
    const theirs = invites.results.filter((i) => i.merchant_id === m.id);
    const used = team.filter((r) => !r.is_owner).length + theirs.filter((i) => i.status === "pending").length;
    return {
      ...toInfo(m, used),
      contact: m.contact,
      reviewedAt: m.reviewed_at,
      members: team.map(toMember),
      invites: theirs.map(toInvite),
      drivers: drivers.results.filter((d) => d.merchant_id === m.id).map(toDriver),
    };
  });
}

/**
 * Approves, rejects (pending only), suspends or reactivates a shop. Suspending checks its
 * drivers out and calls off its trips whose driver has nothing yet; trips under way finish.
 */
export async function reviewMerchant(c: ParcelCtx, merchantId: string, action: MerchantDecision) {
  const admin = await c.requireAdmin();
  const shop = await merchantRow(c.db, merchantId);
  if (!shop) throw new ApiError("not_found", 404);
  const allowed: Record<MerchantDecision, MerchantStatus[]> = {
    approve: ["pending", "rejected"],
    reject: ["pending"],
    suspend: ["approved"],
    reactivate: ["suspended"],
  };
  const target: Record<MerchantDecision, MerchantStatus> = { approve: "approved", reject: "rejected", suspend: "suspended", reactivate: "approved" };
  if (!allowed[action]) throw new ApiError("bad_request");
  if (!allowed[action].includes(shop.status)) throw new ApiError("forbidden", 403);
  const next = target[action];
  const now = nowIso();
  const res = await c.db.batch([
    c.db.prepare("update merchants set status = ?, reviewed_at = ?, reviewed_by = ? where id = ? and status = ?").bind(next, now, admin.id, shop.id, shop.status),
    shopAudit(c, admin.id, "merchants", "update", shop.id, shop.id, { status: [shop.status, next] }, shop.owner_id),
  ]);
  if (!res[0].meta.changes) throw new ApiError("forbidden", 403);
  if (action === "suspend") {
    const { results: checkins } = await c.db.prepare("select * from merchant_checkins where merchant_id = ? and out_at is null").bind(shop.id).all<CheckinRow>();
    for (const k of checkins) await c.db.batch(closeCheckin(c, k, "admin", admin.id, now));
    const { results: jobs } = await c.db
      .prepare(`${JOB_SELECT} where j.merchant_id = ? and j.status in ('open', 'assigned', 'accepted')`)
      .bind(shop.id)
      .all<JobRow>();
    for (const job of jobs) await closeJob(c, job, ["open", "assigned", "accepted"], admin.id);
  }
}

/** Standard (3 employees, no statistics) or unlocked (paid outside the app). */
export async function setMerchantTier(c: ParcelCtx, merchantId: string, tier: MerchantTier) {
  const admin = await c.requireAdmin();
  if (!MERCHANT_TIERS.includes(tier)) throw new ApiError("bad_request");
  const shop = await merchantRow(c.db, merchantId);
  if (!shop) throw new ApiError("not_found", 404);
  if (shop.tier === tier) return;
  await c.db.batch([
    c.db.prepare("update merchants set tier = ?, tier_set_at = ?, tier_set_by = ? where id = ?").bind(tier, nowIso(), admin.id, shop.id),
    shopAudit(c, admin.id, "merchants", "update", shop.id, shop.id, { tier: [shop.tier, tier] }, shop.owner_id),
  ]);
}

/** An admin makes another employee of the shop its merchant (the former merchant stays as an employee). */
export async function setMerchantOwner(c: ParcelCtx, merchantId: string, userId: string) {
  const admin = await c.requireAdmin();
  const shop = await merchantRow(c.db, merchantId);
  if (!shop) throw new ApiError("not_found", 404);
  if (shop.owner_id === userId) return;
  const member = await c.db.prepare("select 1 from merchant_members where user_id = ? and merchant_id = ?").bind(userId, shop.id).first();
  if (!member) throw new ApiError("not_found", 404);
  await c.db.batch([
    c.db.prepare("update merchant_members set is_owner = case when user_id = ? then 1 else 0 end where merchant_id = ?").bind(userId, shop.id),
    c.db.prepare("update merchants set owner_id = ? where id = ?").bind(userId, shop.id),
    shopAudit(c, admin.id, "merchants", "update", shop.id, shop.id, { owner_id: [shop.owner_id, userId] }, userId),
  ]);
}

/** An admin takes an employee out of a shop (back to customer), as the merchant can. */
export async function adminRemoveEmployee(c: ParcelCtx, merchantId: string, memberId: string) {
  const admin = await c.requireAdmin();
  const row = await c.db.prepare("select * from merchant_members where user_id = ? and merchant_id = ?").bind(memberId, merchantId).first<MemberRow>();
  if (!row) throw new ApiError("not_found", 404);
  if (row.is_owner) throw new ApiError("forbidden", 403);
  await c.db.batch(releaseMember(c, admin.id, memberId, merchantId));
}
