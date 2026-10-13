// Fleet managers: drivers linked to a manager, manual dispatch of open trips and
// an overview of trips, takings and charging costs. Shared rules in src/lib/fleet.ts.
import { parseContact } from "../src/lib/contact";
import { fleetRange, jobForManager, managesFleet, type FleetDriver, type FleetDriverStats, type FleetStats, type FleetView } from "../src/lib/fleet";
import type { LedgerEntry } from "../src/lib/drivers";
import type { Profile } from "../src/lib/types";
import {
  balance,
  BUSY_SQL,
  dispatch,
  DRIVER_SELECT,
  driverSettings,
  handJob,
  JOB_SELECT,
  loadJob,
  queueOf,
  toJob,
  type DriverRow,
  type JobRow,
} from "./drivers";
import { ApiError, nowIso } from "./http";
import type { ParcelCtx } from "./parcels";
import { DB_CUSTOMER } from "./roles";

async function requireManager(c: ParcelCtx): Promise<Profile> {
  const user = await c.requireUser();
  if (!managesFleet(user)) throw new ApiError("forbidden", 403);
  return user;
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
  await dispatch(c);
  const rows = await managedRows(c, user);
  const ids = rows.map((r) => r.user_id);
  const marks = ids.map(() => "?").join(", ");
  const [jobs, open, settings] = await Promise.all([
    ids.length
      ? c.db.prepare(`${JOB_SELECT} where j.driver_id in (${marks}) and j.status in ${BUSY_SQL}`).bind(...ids).all<JobRow>()
      : Promise.resolve({ results: [] as JobRow[] }),
    c.db.prepare(`${JOB_SELECT} where j.status = 'open' order by j.created_at limit 100`).all<JobRow>(),
    driverSettings(c.db),
  ]);
  const drivers: FleetDriver[] = await Promise.all(
    rows.map(async (r) => {
      const [money, queue] = await Promise.all([balance(c.db, r.user_id), queueOf(c.db, r.user_id)]);
      const job = jobs.results.find((j) => j.driver_id === r.user_id);
      return {
        userId: r.user_id,
        fullName: r.full_name,
        phone: r.phone,
        status: r.status,
        vehicle: r.vehicle_id && r.v_type ? { id: r.vehicle_id, type: r.v_type, plate: r.v_plate ?? "", isActive: !!r.v_active } : null,
        balanceFcfa: money.balance,
        queue,
        job: job ? jobForManager(toJob(job)) : null,
      };
    }),
  );
  return { drivers, openJobs: open.results.map((j) => jobForManager(toJob(j))), settings };
}

/** Trips, takings, cash and charging of the manager's drivers in a period. */
export async function fleetStats(c: ParcelCtx, from: string, to: string): Promise<FleetStats> {
  const user = await requireManager(c);
  const range = fleetRange(from, to);
  if (!range) throw new ApiError("bad_request");
  const ids = (await managedRows(c, user)).map((r) => r.user_id);
  if (!ids.length) return { from, to, drivers: [] };
  const marks = ids.map(() => "?").join(", ");
  const between = (col: string) => `${col} >= ? and ${col} < ?`;
  const [trips, cash, charging, paid] = await Promise.all([
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
  ]);
  const drivers: FleetDriverStats[] = ids.map((id) => {
    const trip = (status: string) => trips.results.find((t) => t.driver_id === id && t.status === status);
    const money = (kind: LedgerEntry["kind"]) => cash.results.find((m) => m.driver_id === id && m.kind === kind)?.amount ?? 0;
    const visits = (type: string) => charging.results.find((r) => r.user_id === id && r.type === type)?.n ?? 0;
    return {
      userId: id,
      tripsDone: trip("done")?.n ?? 0,
      tripsFailed: trip("failed")?.n ?? 0,
      fareFcfa: trip("done")?.fare ?? 0,
      earningFcfa: money("earning"),
      collectedFcfa: money("collected"),
      settledFcfa: money("settlement"),
      batterySwaps: visits("battery"),
      chargingSlots: visits("slot"),
      chargingPaidFcfa: paid.results.find((p) => p.user_id === id)?.amount ?? 0,
    };
  });
  return { from, to, drivers };
}

/** The manager gives an open trip to one of their drivers, ahead of the queue. */
export async function fleetAssign(c: ParcelCtx, jobId: string, driverId: string) {
  const user = await requireManager(c);
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

/** Backoffice: links a driver to a fleet manager (by phone or e-mail), or unlinks with null. */
export async function setDriverManager(c: ParcelCtx, driverId: string, rawContact: unknown) {
  const admin = await c.requireAdmin();
  const driver = await c.db.prepare("select user_id from drivers where user_id = ?").bind(driverId).first();
  if (!driver) throw new ApiError("driver_not_found", 404);
  const before = await c.db
    .prepare("select manager_id from fleet_manager_drivers where driver_id = ?")
    .bind(driverId)
    .first<{ manager_id: string }>();
  const unlink = () => [
    c.db.prepare("delete from fleet_manager_drivers where driver_id = ?").bind(driverId),
    c.audit(admin.id, "fleet_manager_drivers", "delete", driverId, { manager_id: before!.manager_id }, { userId: driverId }),
    demoteIfIdle(c, before!.manager_id, driverId),
  ];
  if (rawContact == null || rawContact === "") {
    if (before) await c.db.batch(unlink());
    return;
  }
  const text = String(rawContact);
  const contact = parseContact(text);
  if (!contact) throw new ApiError(text.includes("@") ? "invalid_contact" : "phone_not_allowed");
  const account = await c.db
    .prepare(`select id, role from users where ${contact.kind === "phone" ? "phone" : "email"} = ?`)
    .bind(contact.value)
    .first<{ id: string; role: string }>();
  if (!account) throw new ApiError("account_not_found", 404);
  if (account.id === driverId) throw new ApiError("forbidden", 403);
  // One role per person: station staff would lose their station rights.
  if (![DB_CUSTOMER, "fleet_manager", "admin"].includes(account.role)) throw new ApiError("has_other_role");
  if (before?.manager_id === account.id) return;
  await c.db.batch([
    ...(before ? unlink() : []),
    c.db
      .prepare("insert into fleet_manager_drivers (driver_id, manager_id, created_at) values (?, ?, ?)")
      .bind(driverId, account.id, nowIso()),
    c.audit(admin.id, "fleet_manager_drivers", "insert", driverId, { manager_id: account.id }, { userId: driverId }),
    // The role follows the link, like station staff (worker/api.ts).
    c.db.prepare("update users set role = 'fleet_manager' where id = ? and role = ?").bind(account.id, DB_CUSTOMER),
  ]);
}

/** A manager left without drivers goes back to customer (the driver being unlinked does not count). */
function demoteIfIdle(c: ParcelCtx, managerId: string, leavingDriverId: string) {
  return c.db
    .prepare(
      `update users set role = ?3 where id = ?1 and role = 'fleet_manager'
         and not exists (select 1 from fleet_manager_drivers where manager_id = ?1 and driver_id <> ?2)`,
    )
    .bind(managerId, leavingDriverId, DB_CUSTOMER);
}
