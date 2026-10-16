// Fleet managers (plan phase 6): self-registered fleets approved by an admin, invites by phone
// number that the driver confirms (W6, R12), the driver limit of the standard tier (R13),
// manual dispatch of open trips, the swaps billed to the fleet and the statistics of an
// unlocked fleet. Shared rules in src/lib/fleet.ts, table fleets in 0032_fleets.sql.
import { parseContact } from "../src/lib/contact";
import {
  driverLimit,
  FLEET_INVITE_DAYS,
  FLEET_TIERS,
  fleetRange,
  jobForManager,
  managesFleet,
  STANDARD_DRIVER_LIMIT,
  statsUnlocked,
  type AdminFleet,
  type FleetDecision,
  type FleetDriver,
  type FleetDriverStats,
  type FleetInfo,
  type FleetInvite,
  type FleetInviteAnswer,
  type FleetInviteStatus,
  type FleetRemoval,
  type FleetStatement,
  type FleetStats,
  type FleetStatus,
  type FleetTier,
  type FleetView,
  type MyFleetInvite,
} from "../src/lib/fleet";
import { freshPosition, newDriverCode, type DriverPosition, type LedgerEntry } from "../src/lib/drivers";
import { normalizeTogoPhone } from "../src/lib/phone";
import type { Profile } from "../src/lib/types";
import {
  balance,
  BUSY_SQL,
  cleanApplication,
  currentJob,
  customerThingsOpen,
  dispatch,
  DRIVER_SELECT,
  driverRow,
  driverSettings,
  handJob,
  JOB_SELECT,
  loadJob,
  queueOf,
  toJob,
  type DriverRow,
  type JobRow,
} from "./drivers";
import { requireDrivers } from "./features";
import { ApiError, nowIso, uuid } from "./http";
import type { ParcelCtx } from "./parcels";
import { DB_CUSTOMER, DB_DRIVER } from "./roles";

// Fleets ----------------------------------------------------------------------------

export interface FleetRow {
  manager_id: string;
  name: string;
  status: FleetStatus;
  tier: FleetTier;
  created_at: string;
  reviewed_at: string | null;
}

interface InviteRow {
  id: string;
  manager_id: string;
  phone: string;
  invited_by: string;
  status: FleetInviteStatus;
  token: string;
  created_at: string;
  expires_at: string;
  decided_at: string | null;
  user_id: string | null;
}

export async function fleetRow(db: D1Database, managerId: string): Promise<FleetRow | null> {
  return db.prepare("select * from fleets where manager_id = ?").bind(managerId).first<FleetRow>();
}

/** R13: drivers in the fleet plus invites still open. */
async function usedPlaces(db: D1Database, managerId: string): Promise<number> {
  const row = await db
    .prepare(
      `select (select count(*) from fleet_manager_drivers where manager_id = ?1)
            + (select count(*) from fleet_invites where manager_id = ?1 and status = 'pending' and expires_at > ?2) as n`,
    )
    .bind(managerId, nowIso())
    .first<{ n: number }>();
  return row?.n ?? 0;
}

function toInfo(f: FleetRow, used: number): FleetInfo {
  return { managerId: f.manager_id, name: f.name, status: f.status, tier: f.tier, driverLimit: driverLimit(f.tier), used, createdAt: f.created_at };
}

function toInvite(r: InviteRow): FleetInvite {
  return { id: r.id, phone: r.phone, status: r.status, token: r.token, createdAt: r.created_at, expiresAt: r.expires_at, decidedAt: r.decided_at };
}

/** Open invites whose time ran out become 'expired' (on every read, like reservations). */
function expireInvites(db: D1Database) {
  return db.prepare("update fleet_invites set status = 'expired', decided_at = ?1 where status = 'pending' and expires_at <= ?1").bind(nowIso()).run();
}

async function requireManager(c: ParcelCtx): Promise<Profile> {
  const user = await c.requireUser();
  if (!managesFleet(user)) throw new ApiError("forbidden", 403);
  return user;
}

/**
 * A manager of an approved fleet, or an admin (fleet null). Until an admin approves the
 * fleet, every fleet function answers 403 fleet_not_approved (M1).
 */
async function requireApprovedFleet(c: ParcelCtx): Promise<{ user: Profile; fleet: FleetRow | null }> {
  const user = await requireManager(c);
  if (user.role === "admin") return { user, fleet: null };
  const fleet = await fleetRow(c.db, user.id);
  if (!fleet || fleet.status !== "approved") throw new ApiError("fleet_not_approved", 403);
  return { user, fleet };
}

/** The manager's drivers; an admin sees every approved driver. */
async function managedRows(c: ParcelCtx, user: Profile): Promise<DriverRow[]> {
  const { results } =
    user.role === "admin"
      ? await c.db.prepare(`${DRIVER_SELECT} where d.status in ('active', 'suspended') order by d.full_name`).all<DriverRow>()
      : await c.db
          .prepare(`${DRIVER_SELECT} join fleet_manager_drivers f on f.driver_id = d.user_id where f.manager_id = ? order by d.full_name`)
          .bind(user.id)
          .all<DriverRow>();
  return results;
}

export async function fleetView(c: ParcelCtx): Promise<FleetView> {
  const user = await requireManager(c);
  const settings = await driverSettings(c.db);
  let fleet: FleetInfo | null = null;
  if (user.role !== "admin") {
    const row = await fleetRow(c.db, user.id);
    // Not approved (yet): only the fleet itself, so the page can say what is missing.
    if (!row || row.status !== "approved") {
      const info: FleetInfo = row
        ? toInfo(row, 0)
        : { managerId: user.id, name: user.fullName ?? "", status: "pending", tier: "standard", driverLimit: STANDARD_DRIVER_LIMIT, used: 0, createdAt: nowIso() };
      return { fleet: info, drivers: [], invites: [], openJobs: [], settings };
    }
    await expireInvites(c.db);
    fleet = toInfo(row, await usedPlaces(c.db, user.id));
  }
  await dispatch(c);
  const rows = await managedRows(c, user);
  const ids = rows.map((r) => r.user_id);
  const marks = ids.map(() => "?").join(", ");
  const [jobs, open, invites, shops, positions] = await Promise.all([
    ids.length
      ? c.db.prepare(`${JOB_SELECT} where j.driver_id in (${marks}) and j.status in ${BUSY_SQL}`).bind(...ids).all<JobRow>()
      : Promise.resolve({ results: [] as JobRow[] }),
    c.db.prepare(`${JOB_SELECT} where j.status = 'open' order by j.created_at limit 100`).all<JobRow>(),
    fleet
      ? c.db.prepare("select * from fleet_invites where manager_id = ? order by created_at desc limit 30").bind(user.id).all<InviteRow>()
      : Promise.resolve({ results: [] as InviteRow[] }),
    ids.length
      ? c.db
          .prepare(`select k.driver_id, k.in_at, m.name from merchant_checkins k join merchants m on m.id = k.merchant_id where k.out_at is null and k.driver_id in (${marks})`)
          .bind(...ids)
          .all<{ driver_id: string; in_at: string; name: string }>()
      : Promise.resolve({ results: [] as { driver_id: string; in_at: string; name: string }[] }),
    ids.length
      ? c.db.prepare(`select driver_id, lat, lng, at from driver_positions where driver_id in (${marks})`).bind(...ids).all<{ driver_id: string } & DriverPosition>()
      : Promise.resolve({ results: [] as ({ driver_id: string } & DriverPosition)[] }),
  ]);
  const drivers: FleetDriver[] = await Promise.all(
    rows.map(async (r) => {
      const [money, queue] = await Promise.all([balance(c.db, r.user_id), queueOf(c.db, r.user_id)]);
      const job = jobs.results.find((j) => j.driver_id === r.user_id);
      const shop = shops.results.find((k) => k.driver_id === r.user_id);
      return {
        userId: r.user_id,
        fullName: r.full_name,
        phone: r.phone,
        status: r.status,
        vehicle: r.vehicle_id && r.v_type ? { id: r.vehicle_id, type: r.v_type, plate: r.v_plate ?? "", isActive: !!r.v_active } : null,
        balanceFcfa: money.balance,
        queue,
        job: job ? jobForManager(toJob(job)) : null,
        shop: shop ? { name: shop.name, since: shop.in_at } : null,
        position: positionOf(positions.results.find((p) => p.driver_id === r.user_id)),
      };
    }),
  );
  return { fleet, drivers, invites: invites.results.map(toInvite), openJobs: open.results.map((j) => jobForManager(toJob(j))), settings };
}

/** A fresh reported position as the app sees it. */
function positionOf(p: ({ driver_id: string } & DriverPosition) | undefined): DriverPosition | null {
  return p ? freshPosition({ lat: p.lat, lng: p.lng, at: p.at }) : null;
}

/**
 * Trips, takings, cash, charging, km and CO2 of the manager's drivers in a period.
 * Only for an approved, unlocked fleet and for admins (M4).
 */
export async function fleetStats(c: ParcelCtx, from: string, to: string): Promise<FleetStats> {
  const { user, fleet } = await requireApprovedFleet(c);
  if (!statsUnlocked(user.role, fleet)) throw new ApiError("fleet_locked", 403);
  const range = fleetRange(from, to);
  if (!range) throw new ApiError("bad_request");
  const ids = (await managedRows(c, user)).map((r) => r.user_id);
  if (!ids.length) return { from, to, drivers: [] };
  const marks = ids.map(() => "?").join(", ");
  const between = (col: string) => `${col} >= ? and ${col} < ?`;
  const [trips, cash, charging, paid, swaps, green] = await Promise.all([
    c.db
      .prepare(
        `select driver_id, status, count(*) as n, sum(fare_fcfa) as fare from delivery_jobs
         where driver_id in (${marks}) and status in ('done', 'failed') and ${between("done_at")} group by driver_id, status`,
      )
      .bind(...ids, range.start, range.end)
      .all<{ driver_id: string; status: "done" | "failed"; n: number; fare: number }>(),
    c.db
      .prepare(
        `select driver_id, kind, sum(amount_fcfa) as amount from driver_ledger
         where driver_id in (${marks}) and ${between("at")} group by driver_id, kind`,
      )
      .bind(...ids, range.start, range.end)
      .all<{ driver_id: string; kind: LedgerEntry["kind"]; amount: number }>(),
    c.db
      .prepare(
        `select user_id, type, count(*) as n from reservations
         where user_id in (${marks}) and status = 'completed' and ${between("created_at")} group by user_id, type`,
      )
      .bind(...ids, range.start, range.end)
      .all<{ user_id: string; type: "battery" | "slot"; n: number }>(),
    c.db
      .prepare(
        `select user_id, sum(amount_xof) as amount from payments
         where user_id in (${marks}) and status = 'succeeded' and ${between("paid_at")} group by user_id`,
      )
      .bind(...ids, range.start, range.end)
      .all<{ user_id: string; amount: number }>(),
    // Swaps at the counter with the driver's pass, billed to the fleet (station-work.ts).
    // Only those billed to this fleet: a driver who moved keeps the old fleet's swaps there.
    c.db
      .prepare(
        `select driver_id, count(*) as n, sum(amount_xof) as amount from swap_log
         where customer_type = 'fleet' and driver_id in (${marks}) and ${between("created_at")}
           ${user.role === "admin" ? "" : "and fleet_manager_id = ?"} group by driver_id`,
      )
      .bind(...ids, range.start, range.end, ...(user.role === "admin" ? [] : [user.id]))
      .all<{ driver_id: string; n: number; amount: number }>(),
    // Km and CO2 of the trips (greenpoint ledger, without points for drivers: W10).
    c.db
      .prepare(
        `select user_id, sum(coalesce(distance_m, 0)) as m, sum(co2_grams) as co2 from greenpoint_ledger
         where user_id in (${marks}) and kind = 'delivery' and ${between("created_at")} group by user_id`,
      )
      .bind(...ids, range.start, range.end)
      .all<{ user_id: string; m: number; co2: number }>(),
  ]);
  const drivers: FleetDriverStats[] = ids.map((id) => {
    const trip = (status: string) => trips.results.find((t) => t.driver_id === id && t.status === status);
    const money = (kind: LedgerEntry["kind"]) => cash.results.find((m) => m.driver_id === id && m.kind === kind)?.amount ?? 0;
    const visits = (type: string) => charging.results.find((r) => r.user_id === id && r.type === type)?.n ?? 0;
    const fleetSwap = swaps.results.find((x) => x.driver_id === id);
    const g = green.results.find((x) => x.user_id === id);
    return {
      userId: id,
      tripsDone: trip("done")?.n ?? 0,
      tripsFailed: trip("failed")?.n ?? 0,
      fareFcfa: trip("done")?.fare ?? 0,
      earningFcfa: money("earning"),
      collectedFcfa: money("collected"),
      settledFcfa: money("settlement"),
      batterySwaps: visits("battery") + (fleetSwap?.n ?? 0),
      chargingSlots: visits("slot"),
      chargingPaidFcfa: paid.results.find((p) => p.user_id === id)?.amount ?? 0,
      fleetSwaps: fleetSwap?.n ?? 0,
      fleetSwapsXof: fleetSwap?.amount ?? 0,
      distanceKm: Math.round((g?.m ?? 0) / 100) / 10,
      co2Grams: g?.co2 ?? 0,
    };
  });
  return { from, to, drivers };
}

/**
 * The fleet's statement: battery swaps billed to it (customer type 'fleet', W7) with their
 * amounts. Every approved fleet sees it, whatever the tier: it is the bill, not a statistic.
 * An admin sees the swaps of every fleet.
 */
export async function fleetStatement(c: ParcelCtx, from: string, to: string): Promise<FleetStatement> {
  const { user } = await requireApprovedFleet(c);
  const range = fleetRange(from, to);
  if (!range) throw new ApiError("bad_request");
  const admin = user.role === "admin";
  const { results } = await c.db
    .prepare(
      `select l.id, l.created_at, l.station_id, s.name as station_name, l.driver_id, d.full_name as driver_name, l.battery_type_id, l.amount_xof
       from swap_log l join stations s on s.id = l.station_id left join drivers d on d.user_id = l.driver_id
       where l.customer_type = 'fleet' and l.created_at >= ?1 and l.created_at < ?2 ${admin ? "" : "and l.fleet_manager_id = ?3"}
       order by l.created_at desc limit 1000`,
    )
    .bind(range.start, range.end, ...(admin ? [] : [user.id]))
    .all<{
      id: string;
      created_at: string;
      station_id: string;
      station_name: string;
      driver_id: string | null;
      driver_name: string | null;
      battery_type_id: string;
      amount_xof: number;
    }>();
  const swaps = results.map((r) => ({
    id: r.id,
    at: r.created_at,
    stationId: r.station_id,
    stationName: r.station_name,
    driverId: r.driver_id,
    driverName: r.driver_name,
    batteryTypeId: r.battery_type_id,
    amountXof: r.amount_xof,
  }));
  return { from, to, swaps, totalXof: swaps.reduce((n, s) => n + s.amountXof, 0) };
}

/** The manager gives an open trip to one of their drivers, ahead of the queue. */
export async function fleetAssign(c: ParcelCtx, jobId: string, driverId: string) {
  const { user } = await requireApprovedFleet(c);
  if (user.role !== "admin") {
    const mine = await c.db
      .prepare("select 1 from fleet_manager_drivers where driver_id = ? and manager_id = ?")
      .bind(driverId, user.id)
      .first();
    if (!mine) throw new ApiError("driver_not_found");
  }
  const job = await loadJob(c.db, jobId);
  if (job.status !== "open") throw new ApiError("job_wrong_status");
  await handJob(c, user.id, job, driverId, "fleet");
}

// Invites ---------------------------------------------------------------------------

/**
 * R12: only a number without an account, or an empty customer account (no money, no active
 * reservation, no open parcel, no booked trip), may be invited. Checked again on accepting.
 */
async function checkInvitable(db: D1Database, phone: string) {
  const account = await db.prepare("select id, role from users where phone = ?").bind(phone).first<{ id: string; role: string }>();
  if (!account) return;
  if (account.role !== DB_CUSTOMER) throw new ApiError("invite_number_taken", 409);
  if (await customerThingsOpen(db, account.id, phone)) throw new ApiError("invite_account_not_empty", 409);
  const inFleet = await db.prepare("select 1 from fleet_manager_drivers where driver_id = ?").bind(account.id).first();
  if (inFleet) throw new ApiError("already_in_fleet", 409);
}

/** The manager invites a driver by phone number; the person confirms in the app (W6). */
export async function inviteDriver(c: ParcelCtx, rawPhone: unknown): Promise<FleetInvite> {
  const { user } = await requireApprovedFleet(c);
  // Admins link drivers in the backoffice (setDriverManager); invites are the manager's.
  if (user.role !== "fleet_manager") throw new ApiError("forbidden", 403);
  const phone = normalizeTogoPhone(String(rawPhone ?? ""));
  if (!phone) throw new ApiError("phone_not_allowed");
  await expireInvites(c.db);
  await checkInvitable(c.db, phone);
  const open = await c.db.prepare("select 1 from fleet_invites where manager_id = ? and phone = ? and status = 'pending'").bind(user.id, phone).first();
  if (open) throw new ApiError("invite_pending", 409);
  const now = nowIso();
  const expires = new Date(Date.now() + FLEET_INVITE_DAYS * 86_400_000).toISOString();
  for (let attempt = 0; attempt < 5; attempt++) {
    const id = uuid();
    let changes = 0;
    try {
      // R13 in the same statement as the insert, so two invites at once cannot pass the limit together.
      const res = await c.db
        .prepare(
          `insert into fleet_invites (id, manager_id, phone, invited_by, status, token, created_at, expires_at)
           select ?1, ?2, ?3, ?2, 'pending', ?4, ?5, ?6
           where (select tier from fleets where manager_id = ?2) = 'unlocked'
              or (select count(*) from fleet_manager_drivers where manager_id = ?2)
               + (select count(*) from fleet_invites where manager_id = ?2 and status = 'pending' and expires_at > ?5) < ?7`,
        )
        .bind(id, user.id, phone, newDriverCode(), now, expires, STANDARD_DRIVER_LIMIT)
        .run();
      changes = res.meta?.changes ?? 0;
    } catch (err) {
      if (/UNIQUE/i.test(String(err)) && /token/i.test(String(err))) continue;
      if (/UNIQUE/i.test(String(err))) throw new ApiError("invite_pending", 409);
      throw err;
    }
    if (!changes) throw new ApiError("fleet_limit", 409);
    await c.audit(user.id, "fleet_invites", "insert", id, { phone, manager_id: user.id }, {}).run();
    const row = await c.db.prepare("select * from fleet_invites where id = ?").bind(id).first<InviteRow>();
    return toInvite(row!);
  }
  throw new ApiError("unknown", 500);
}

/** The manager takes back an invite nobody answered yet. */
export async function revokeInvite(c: ParcelCtx, inviteId: string) {
  const { user } = await requireApprovedFleet(c);
  await expireInvites(c.db);
  const row = await c.db.prepare("select * from fleet_invites where id = ?").bind(inviteId).first<InviteRow>();
  if (!row || row.status !== "pending" || (user.role !== "admin" && row.manager_id !== user.id)) throw new ApiError("invite_not_found", 404);
  await c.db.batch([
    c.db.prepare("update fleet_invites set status = 'revoked', decided_at = ? where id = ? and status = 'pending'").bind(nowIso(), inviteId),
    c.audit(user.id, "fleet_invites", "update", inviteId, { status: ["pending", "revoked"] }, {}),
  ]);
}

/** Open invites for the signed-in customer's phone number (shown on login and on /chauffeur). */
export async function myFleetInvites(c: ParcelCtx): Promise<MyFleetInvite[]> {
  const user = await c.user();
  if (!user?.phone || user.role !== "customer") return [];
  await expireInvites(c.db);
  const [{ results }, row] = await Promise.all([
    c.db
      .prepare(
        `select i.token, i.expires_at, f.name from fleet_invites i join fleets f on f.manager_id = i.manager_id
         where i.phone = ? and i.status = 'pending' and f.status = 'approved' order by i.created_at`,
      )
      .bind(user.phone)
      .all<{ token: string; expires_at: string; name: string }>(),
    driverRow(c.db, user.id),
  ]);
  const needsApplication = !row || row.status === "rejected";
  return results.map((r) => ({ token: r.token, fleetName: r.name, expiresAt: r.expires_at, needsApplication }));
}

/** The open invite with this code, for the signed-in account's number (404 otherwise). */
async function inviteForMe(c: ParcelCtx, user: Profile, token: string): Promise<InviteRow> {
  await expireInvites(c.db);
  const row = await c.db.prepare("select * from fleet_invites where token = ?").bind(String(token ?? "").trim().toUpperCase()).first<InviteRow>();
  if (!row || row.status !== "pending" || !user.phone || row.phone !== user.phone) throw new ApiError("invite_not_found", 404);
  return row;
}

/**
 * The invited person accepts: the customer account becomes a driver account in the fleet
 * (R12 checked again; R15: nothing open, so there is no money to move). Without a driver
 * application yet, one comes with the answer; the documents follow on /chauffeur and an
 * admin approves the driver and hands out a vehicle, as for every driver (F1, F2).
 */
export async function acceptInvite(c: ParcelCtx, token: string, answer: FleetInviteAnswer | null) {
  const user = await c.requireUser();
  const invite = await inviteForMe(c, user, token);
  if (user.role !== "customer") throw new ApiError("has_other_role");
  await requireDrivers(c.db);
  const fleet = await fleetRow(c.db, invite.manager_id);
  if (!fleet || fleet.status !== "approved") throw new ApiError("invite_not_found", 404);
  if (await customerThingsOpen(c.db, user.id, user.phone)) throw new ApiError("invite_account_not_empty", 409);
  const inFleet = await c.db.prepare("select 1 from fleet_manager_drivers where driver_id = ?").bind(user.id).first();
  if (inFleet) throw new ApiError("already_in_fleet", 409);
  const existing = await driverRow(c.db, user.id);
  const application = !existing || existing.status === "rejected" ? cleanApplication(answer?.application) : null;
  const now = nowIso();
  const driverStatements = (): D1PreparedStatement[] => {
    if (!existing) {
      const a = application!;
      return [
        c.db
          .prepare(
            "insert into drivers (user_id, status, full_name, id_number, license_number, wanted_type, code, created_at) values (?, 'pending', ?, ?, ?, ?, ?, ?)",
          )
          .bind(user.id, a.fullName, a.idNumber, a.licenseNumber, a.wantedType, newDriverCode(), now),
        c.audit(user.id, "drivers", "insert", user.id, { status: "pending", wanted_type: a.wantedType, fleet: invite.manager_id }, { userId: user.id }),
      ];
    }
    if (!application) return [];
    return [
      c.db
        .prepare("update drivers set status = 'pending', full_name = ?, id_number = ?, license_number = ?, wanted_type = ? where user_id = ?")
        .bind(application.fullName, application.idNumber, application.licenseNumber, application.wantedType, user.id),
      c.audit(user.id, "drivers", "update", user.id, { status: [existing.status, "pending"] }, { userId: user.id }),
    ];
  };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await c.db.batch([
        ...driverStatements(),
        // Guarded: the invite must still be open, so it is used once; the link and the role follow it.
        c.db
          .prepare("update fleet_invites set status = 'accepted', decided_at = ?, user_id = ? where id = ? and status = 'pending'")
          .bind(now, user.id, invite.id),
        c.db
          .prepare(
            `insert into fleet_manager_drivers (driver_id, manager_id, created_at)
             select ?1, ?2, ?3 where exists (select 1 from fleet_invites where id = ?4 and status = 'accepted' and user_id = ?1)`,
          )
          .bind(user.id, invite.manager_id, now, invite.id),
        // One role per account: the customer account becomes a driver account (0030).
        c.db
          .prepare(
            `update users set role = ?1 where id = ?2 and role = ?3
               and exists (select 1 from fleet_manager_drivers where driver_id = ?2 and manager_id = ?4)`,
          )
          .bind(DB_DRIVER, user.id, DB_CUSTOMER, invite.manager_id),
        // Other open invites for the same number end here.
        c.db
          .prepare("update fleet_invites set status = 'expired', decided_at = ? where phone = ? and status = 'pending' and id <> ?")
          .bind(now, invite.phone, invite.id),
        c.audit(user.id, "fleet_invites", "update", invite.id, { status: ["pending", "accepted"] }, { userId: user.id }),
        c.audit(user.id, "fleet_manager_drivers", "insert", user.id, { manager_id: invite.manager_id, invite: invite.id }, { userId: user.id }),
        c.audit(user.id, "profiles", "update", user.id, { role: ["customer", "driver"] }, { userId: user.id }),
      ]);
      return;
    } catch (err) {
      // A driver code already taken: try another one.
      if (!existing && /UNIQUE/i.test(String(err)) && /code/i.test(String(err))) continue;
      throw err;
    }
  }
  throw new ApiError("unknown", 500);
}

/** The invited person says no. */
export async function declineInvite(c: ParcelCtx, token: string) {
  const user = await c.requireUser();
  const invite = await inviteForMe(c, user, token);
  await c.db.batch([
    c.db.prepare("update fleet_invites set status = 'declined', decided_at = ?, user_id = ? where id = ? and status = 'pending'").bind(nowIso(), user.id, invite.id),
    c.audit(user.id, "fleet_invites", "update", invite.id, { status: ["pending", "declined"] }, { userId: user.id }),
  ]);
}

/**
 * The manager (or an admin) takes a driver out of the fleet; not during a trip. With no cash
 * open either, the account goes back to customer (R15, as the admin's release in
 * worker/drivers.ts); with cash open it stays a driver account outside any fleet until the
 * cash is settled at a station and an admin releases it.
 */
export async function removeDriver(c: ParcelCtx, driverId: string): Promise<FleetRemoval> {
  const { user } = await requireApprovedFleet(c);
  const link = await c.db.prepare("select manager_id from fleet_manager_drivers where driver_id = ?").bind(driverId).first<{ manager_id: string }>();
  if (!link || (user.role !== "admin" && link.manager_id !== user.id)) throw new ApiError("driver_not_found", 404);
  if (await currentJob(c.db, driverId)) throw new ApiError("driver_busy");
  const row = await driverRow(c.db, driverId);
  const release = !!row && row.u_role === DB_DRIVER && (await balance(c.db, driverId)).balance === 0;
  await c.db.batch([
    c.db.prepare("delete from fleet_manager_drivers where driver_id = ?").bind(driverId),
    c.audit(user.id, "fleet_manager_drivers", "delete", driverId, { manager_id: link.manager_id }, { userId: driverId }),
    ...(release
      ? [
          c.db.prepare("delete from driver_queue where driver_id = ?").bind(driverId),
          // W1: the drivers table only holds driver accounts. Trips and the cash ledger stay (no foreign key).
          c.db.prepare("delete from drivers where user_id = ?").bind(driverId),
          c.db.prepare("update users set role = ? where id = ? and role = ?").bind(DB_CUSTOMER, driverId, DB_DRIVER),
          c.audit(user.id, "drivers", "update", driverId, { status: [row!.status, null], released: true }, { userId: driverId }),
          c.audit(user.id, "profiles", "update", driverId, { role: ["driver", "customer"] }, { userId: driverId }),
        ]
      : []),
  ]);
  return { released: release };
}

// Backoffice ------------------------------------------------------------------------

/** Every fleet with its drivers and invites; pending ones first. */
export async function adminFleets(c: ParcelCtx): Promise<AdminFleet[]> {
  await c.requireAdmin();
  await expireInvites(c.db);
  const [fleets, drivers, invites] = await Promise.all([
    c.db
      .prepare(
        `select f.*, coalesce(u.phone, u.email) as contact from fleets f join users u on u.id = f.manager_id
         order by case f.status when 'pending' then 0 when 'approved' then 1 else 2 end, f.created_at desc`,
      )
      .all<FleetRow & { contact: string | null }>(),
    c.db
      .prepare("select f.manager_id, d.user_id, d.full_name, d.status from fleet_manager_drivers f join drivers d on d.user_id = f.driver_id order by d.full_name")
      .all<{ manager_id: string; user_id: string; full_name: string; status: FleetDriver["status"] }>(),
    c.db.prepare("select * from fleet_invites order by created_at desc limit 500").all<InviteRow>(),
  ]);
  return fleets.results.map((f) => {
    const mine = drivers.results.filter((d) => d.manager_id === f.manager_id);
    const theirs = invites.results.filter((i) => i.manager_id === f.manager_id);
    return {
      ...toInfo(f, mine.length + theirs.filter((i) => i.status === "pending").length),
      contact: f.contact,
      reviewedAt: f.reviewed_at,
      drivers: mine.map((d) => ({ userId: d.user_id, fullName: d.full_name, status: d.status })),
      invites: theirs.map(toInvite),
    };
  });
}

/** Approves a registered fleet (its functions open) or refuses it. */
export async function reviewFleet(c: ParcelCtx, managerId: string, action: FleetDecision) {
  const admin = await c.requireAdmin();
  const fleet = await fleetRow(c.db, managerId);
  if (!fleet) throw new ApiError("not_found", 404);
  let next: FleetStatus;
  if (action === "approve") {
    if (fleet.status === "approved") return;
    next = "approved";
  } else if (action === "reject") {
    // An approved fleet is not refused afterwards: its drivers are removed one by one instead.
    if (fleet.status !== "pending") throw new ApiError("forbidden", 403);
    next = "rejected";
  } else {
    throw new ApiError("bad_request");
  }
  await c.db.batch([
    c.db.prepare("update fleets set status = ?, reviewed_at = ?, reviewed_by = ? where manager_id = ?").bind(next, nowIso(), admin.id, managerId),
    c.audit(admin.id, "fleets", "update", managerId, { status: [fleet.status, next] }, { userId: managerId }),
  ]);
}

/** Standard (3 drivers, no statistics) or unlocked (paid outside the app). */
export async function setFleetTier(c: ParcelCtx, managerId: string, tier: FleetTier) {
  const admin = await c.requireAdmin();
  if (!FLEET_TIERS.includes(tier)) throw new ApiError("bad_request");
  const fleet = await fleetRow(c.db, managerId);
  if (!fleet) throw new ApiError("not_found", 404);
  if (fleet.tier === tier) return;
  await c.db.batch([
    c.db.prepare("update fleets set tier = ?, tier_set_at = ?, tier_set_by = ? where manager_id = ?").bind(tier, nowIso(), admin.id, managerId),
    c.audit(admin.id, "fleets", "update", managerId, { tier: [fleet.tier, tier] }, { userId: managerId }),
  ]);
}

/** A fleet for an account an admin makes a fleet manager: approved right away. */
export function approvedFleetFor(db: D1Database, userId: string, name: string | null, adminId: string) {
  const now = nowIso();
  return db
    .prepare(
      `insert into fleets (manager_id, name, status, tier, created_at, reviewed_at, reviewed_by)
       values (?1, ?2, 'approved', 'standard', ?3, ?3, ?4)
       on conflict (manager_id) do update set status = 'approved', reviewed_at = ?3, reviewed_by = ?4 where status <> 'approved'`,
    )
    .bind(userId, name && name.trim().length >= 2 ? name.trim().slice(0, 80) : "Flotte", now, adminId);
}

/** Open invites of a fleet end when the account stops being a fleet manager. */
export function revokeOpenInvites(db: D1Database, managerId: string) {
  return db.prepare("update fleet_invites set status = 'revoked', decided_at = ? where manager_id = ? and status = 'pending'").bind(nowIso(), managerId);
}

/** Backoffice: links a driver to a fleet manager (by phone or e-mail), or unlinks with null. */
export async function setDriverManager(c: ParcelCtx, driverId: string, rawContact: unknown) {
  const admin = await c.requireAdmin();
  const driver = await c.db.prepare("select user_id from drivers where user_id = ?").bind(driverId).first();
  if (!driver) throw new ApiError("driver_not_found", 404);
  const before = await c.db
    .prepare("select manager_id from fleet_manager_drivers where driver_id = ?")
    .bind(driverId)
    .first<{ manager_id: string }>();
  // A fleet manager is an account of its own (phase 6): losing the last driver does not end it.
  const unlink = () => [
    c.db.prepare("delete from fleet_manager_drivers where driver_id = ?").bind(driverId),
    c.audit(admin.id, "fleet_manager_drivers", "delete", driverId, { manager_id: before!.manager_id }, { userId: driverId }),
  ];
  if (rawContact == null || rawContact === "") {
    if (before) await c.db.batch(unlink());
    return;
  }
  const text = String(rawContact);
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const account = await c.db
    .prepare(`select id, role, full_name from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<{ id: string; role: string; full_name: string | null }>();
  if (!account) throw new ApiError("account_not_found", 404);
  if (account.id === driverId) throw new ApiError("forbidden", 403);
  // One role per person: station staff would lose their station rights.
  if (![DB_CUSTOMER, "fleet_manager", "admin"].includes(account.role)) throw new ApiError("has_other_role");
  if (before?.manager_id === account.id) return;
  if (account.role === "fleet_manager") {
    const fleet = await fleetRow(c.db, account.id);
    if (fleet && fleet.status !== "approved") throw new ApiError("fleet_not_approved", 409);
    // R13 holds for the admin too: unlock the fleet first.
    if (fleet?.tier !== "unlocked" && (await usedPlaces(c.db, account.id)) >= STANDARD_DRIVER_LIMIT) throw new ApiError("fleet_limit", 409);
  }
  await c.db.batch([
    ...(before ? unlink() : []),
    c.db
      .prepare("insert into fleet_manager_drivers (driver_id, manager_id, created_at) values (?, ?, ?)")
      .bind(driverId, account.id, nowIso()),
    c.audit(admin.id, "fleet_manager_drivers", "insert", driverId, { manager_id: account.id }, { userId: driverId }),
    // A customer linked by the admin becomes a fleet manager with an approved fleet.
    ...(account.role === DB_CUSTOMER
      ? [
          c.db.prepare("update users set role = 'fleet_manager' where id = ? and role = ?").bind(account.id, DB_CUSTOMER),
          approvedFleetFor(c.db, account.id, account.full_name, admin.id),
        ]
      : []),
  ]);
}
