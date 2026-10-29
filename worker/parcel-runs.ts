// Collection runs and parcel scans (plan phase 7, migration 0034). Shared types in
// shared/parcels.ts (ParcelRun, ParcelScanKind, parseParcelScan).
//
// A collection run takes the parcels handed in at a station to their stations:
//   1. staff choose the parcels and record the driver (driver QR or typed code): "loading";
//   2. staff scan each parcel into the driver's hands; a parcel not on the run is refused;
//   3. the run leaves ("under_way") only when every parcel was scanned; the parcels go
//      "in_transit";
//   4. staff at each destination scan the parcels in; each arrives (pickup code, the
//      recipient is told). The run is "done" when all its parcels are in.
// Staff act at their active station (worker/station-work.ts, R7). Every scan is one row of
// parcel_scans with station, person and role; the same scan twice is one row.

import { parseParcelScan, type ParcelRun, type ParcelRunStatus, type ParcelScanKind } from "../shared/parcels";
import type { StationRole } from "../shared/station-work";
import type { Parcel } from "../shared/parcels";
import { driverByBadge } from "./drivers";
import { ApiError, nowIso, uuid } from "./http";
import {
  arriveParcel,
  event,
  parcelStationActor,
  requireDepot,
  requireStaff,
  station,
  toParcel,
  type ParcelCtx,
  type ParcelRow,
} from "./parcels";

interface RunRow {
  id: string;
  station_id: string;
  driver_id: string;
  status: ParcelRunStatus;
  created_at: string;
  departed_at: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  driver_plate: string | null;
}

const RUN_SELECT = `select r.*, d.full_name as driver_name, u.phone as driver_phone, v.plate as driver_plate
  from parcel_runs r left join drivers d on d.user_id = r.driver_id left join users u on u.id = r.driver_id
  left join fleet_vehicles v on v.id = d.vehicle_id`;

/** A scan of a parcel changing hands; "insert or ignore": the same scan twice is one row. */
export function scanStatement(
  db: D1Database,
  s: { parcelId: string; runId: string; kind: ParcelScanKind; driverId: string | null; stationId: string | null; by: string; role: StationRole | "driver" },
): D1PreparedStatement {
  return db
    .prepare(
      `insert or ignore into parcel_scans (parcel_id, run_id, kind, driver_id, station_id, scanned_by, role, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(s.parcelId, s.runId, s.kind, s.driverId, s.stationId, s.by, s.role, nowIso());
}

/** The parcel a scan names (slip QR, pickup QR or typed number), or parcel_not_found. */
export async function scannedParcel(db: D1Database, code: unknown): Promise<ParcelRow> {
  const trackingNo = parseParcelScan(String(code ?? ""));
  const row = trackingNo ? await db.prepare("select * from parcels where tracking_no = ?").bind(trackingNo).first<ParcelRow>() : null;
  if (!row) throw new ApiError("parcel_not_found", 404);
  return row;
}

async function runView(db: D1Database, r: RunRow): Promise<ParcelRun> {
  const { results } = await db
    .prepare(
      `select p.id, p.tracking_no, p.to_station_id, p.size,
         exists (select 1 from parcel_scans s where s.parcel_id = p.id and s.run_id = ?1 and s.kind = 'handover_to_driver') as scanned,
         exists (select 1 from parcel_scans s where s.parcel_id = p.id and s.run_id = ?1 and s.kind = 'received_at_station') as received
       from parcels p where p.run_id = ?1 order by p.tracking_no`,
    )
    .bind(r.id)
    .all<{ id: string; tracking_no: string; to_station_id: string; size: Parcel["size"]; scanned: number; received: number }>();
  return {
    id: r.id,
    stationId: r.station_id,
    driver: { userId: r.driver_id, name: r.driver_name ?? "?", phone: r.driver_phone, plate: r.driver_plate },
    status: r.status,
    createdAt: r.created_at,
    departedAt: r.departed_at,
    parcels: results.map((p) => ({
      id: p.id,
      trackingNo: p.tracking_no,
      toStationId: p.to_station_id,
      size: p.size,
      scanned: !!p.scanned,
      received: !!p.received,
    })),
  };
}

async function loadRun(db: D1Database, id: string): Promise<RunRow | null> {
  return db.prepare(`${RUN_SELECT} where r.id = ?`).bind(id).first<RunRow>();
}

/** A run of this station that is still being loaded. */
async function loadingRun(c: ParcelCtx, stationId: string, runId: string): Promise<RunRow> {
  const run = await loadRun(c.db, runId);
  if (!run || run.station_id !== stationId) throw new ApiError("run_not_found", 404);
  if (run.status !== "loading") throw new ApiError("run_wrong_status");
  return run;
}

/** Runs leaving this station: being loaded, under way, and those of the last 7 days. Staff of the station read them. */
export async function stationRuns(c: ParcelCtx, stationId: string): Promise<ParcelRun[]> {
  await requireStaff(c, stationId);
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { results } = await c.db
    .prepare(`${RUN_SELECT} where r.station_id = ? and (r.status in ('loading', 'under_way') or r.created_at > ?) order by r.created_at desc limit 50`)
    .bind(stationId, since)
    .all<RunRow>();
  return Promise.all(results.map((r) => runView(c.db, r)));
}

/** Staff choose the parcels a driver takes on a collection run and record the driver (QR or typed code). */
export async function startRun(c: ParcelCtx, stationId: string, badge: unknown, ids: unknown): Promise<ParcelRun> {
  const actor = await parcelStationActor(c, stationId);
  await requireDepot(c.db, stationId);
  const driver = await driverByBadge(c, badge);
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 200) throw new ApiError("bad_request");
  const clean = [...new Set(ids.map(String))];
  const { results: rows } = await c.db
    .prepare(`select * from parcels where id in (${clean.map(() => "?").join(", ")})`)
    .bind(...clean)
    .all<ParcelRow>();
  if (rows.length !== clean.length) throw new ApiError("parcel_not_found", 404);
  // Only parcels handed in here and waiting; express parcels go with their own driver trip.
  if (rows.some((r) => r.from_station_id !== stationId || r.status !== "deposited" || r.express || r.run_id)) throw new ApiError("parcel_wrong_status");
  // The shipping label has to be on the parcel: it is what staff and the driver scan.
  if (rows.some((r) => !r.label_printed_at)) throw new ApiError("parcel_label_missing");
  const id = uuid();
  const now = nowIso();
  await c.db.batch([
    c.db
      .prepare("insert into parcel_runs (id, station_id, driver_id, status, created_by, created_role, created_at) values (?, ?, ?, 'loading', ?, ?, ?)")
      .bind(id, stationId, driver.user_id, actor.user.id, actor.role, now),
    ...rows.map((r) => c.db.prepare("update parcels set run_id = ? where id = ? and status = 'deposited' and run_id is null").bind(id, r.id)),
    c.audit(actor.user.id, "parcel_runs", "insert", id, { driver: driver.user_id, parcels: rows.map((r) => r.tracking_no), role: actor.role }, { stationId, userId: driver.user_id }),
  ]);
  // Another run took one of the parcels in the meantime: nothing of this one stays.
  const taken = await c.db.prepare("select count(*) as n from parcels where run_id = ?").bind(id).first<{ n: number }>();
  if ((taken?.n ?? 0) !== rows.length) {
    await c.db.batch([
      c.db.prepare("update parcels set run_id = null where run_id = ?").bind(id),
      c.db.prepare("update parcel_runs set status = 'cancelled', done_at = ? where id = ?").bind(nowIso(), id),
    ]);
    throw new ApiError("parcel_wrong_status");
  }
  return runView(c.db, (await loadRun(c.db, id))!);
}

/**
 * Staff scan one parcel into the driver's hands. A parcel that is not on this run is
 * refused; the same parcel scanned twice is recorded once.
 */
export async function scanRunParcel(c: ParcelCtx, stationId: string, runId: string, code: unknown): Promise<ParcelRun> {
  const actor = await parcelStationActor(c, stationId);
  const run = await loadingRun(c, stationId, runId);
  const parcel = await scannedParcel(c.db, code);
  if (parcel.run_id !== run.id || parcel.status !== "deposited") throw new ApiError("parcel_not_in_run", 409);
  const res = await scanStatement(c.db, {
    parcelId: parcel.id,
    runId: run.id,
    kind: "handover_to_driver",
    driverId: run.driver_id,
    stationId,
    by: actor.user.id,
    role: actor.role,
  }).run();
  if (res.meta.changes) {
    await c.audit(actor.user.id, "parcels", "update", parcel.id, { scan: "handover_to_driver", run: run.id, driver: run.driver_id, role: actor.role }, { stationId }).run();
  }
  return runView(c.db, run);
}

/** Takes a parcel off a run that is still being loaded (not found on the shelf, does not fit). */
export async function removeRunParcel(c: ParcelCtx, stationId: string, runId: string, parcelId: string): Promise<ParcelRun> {
  const actor = await parcelStationActor(c, stationId);
  const run = await loadingRun(c, stationId, runId);
  const res = await c.db.prepare("update parcels set run_id = null where id = ? and run_id = ? and status = 'deposited'").bind(parcelId, run.id).run();
  if (!res.meta.changes) throw new ApiError("parcel_not_in_run", 409);
  await c.db.batch([
    c.db.prepare("delete from parcel_scans where parcel_id = ? and run_id = ?").bind(parcelId, run.id),
    c.audit(actor.user.id, "parcel_runs", "update", run.id, { removed: parcelId, role: actor.role }, { stationId }),
  ]);
  return runView(c.db, run);
}

/** Calls off a run that has not left: its parcels wait for the next one. */
export async function cancelRun(c: ParcelCtx, stationId: string, runId: string) {
  const actor = await parcelStationActor(c, stationId);
  const run = await loadingRun(c, stationId, runId);
  const res = await c.db.prepare("update parcel_runs set status = 'cancelled', done_at = ? where id = ? and status = 'loading'").bind(nowIso(), run.id).run();
  if (!res.meta.changes) throw new ApiError("run_wrong_status");
  await c.db.batch([
    c.db.prepare("update parcels set run_id = null where run_id = ? and status = 'deposited'").bind(run.id),
    // The parcels never left: their scans for this run go, the log keeps the run.
    c.db.prepare("delete from parcel_scans where run_id = ?").bind(run.id),
    c.audit(actor.user.id, "parcel_runs", "update", run.id, { status: ["loading", "cancelled"], role: actor.role }, { stationId }),
  ]);
}

/** The run leaves: only when every parcel on it was scanned into the driver's hands. Its parcels go "in_transit". */
export async function departRun(c: ParcelCtx, stationId: string, runId: string): Promise<ParcelRun> {
  const actor = await parcelStationActor(c, stationId);
  const run = await loadingRun(c, stationId, runId);
  const view = await runView(c.db, run);
  if (view.parcels.length === 0) throw new ApiError("run_wrong_status");
  if (view.parcels.some((p) => !p.scanned)) throw new ApiError("run_unscanned", 409);
  const now = nowIso();
  const res = await c.db
    .prepare("update parcel_runs set status = 'under_way', departed_at = ? where id = ? and status = 'loading'")
    .bind(now, run.id)
    .run();
  if (!res.meta.changes) throw new ApiError("run_wrong_status");
  await c.db.batch([
    ...view.parcels.flatMap((p) => [
      c.db.prepare("update parcels set status = 'in_transit', in_transit_at = ? where id = ? and status = 'deposited' and run_id = ?").bind(now, p.id, run.id),
      event(c, p.id, actor.user.id, "in_transit", stationId),
      c.audit(actor.user.id, "parcels", "update", p.id, { status: ["deposited", "in_transit"], run: run.id, driver: run.driver_id, role: actor.role }, { stationId }),
    ]),
    c.audit(actor.user.id, "parcel_runs", "update", run.id, { status: ["loading", "under_way"], role: actor.role }, { stationId, userId: run.driver_id }),
  ]);
  return runView(c.db, (await loadRun(c.db, run.id))!);
}

/**
 * Staff at the destination scan a parcel in from a collection run: it arrives (pickup
 * code, the recipient is told). Scanning a parcel that is already in is no change.
 * Parcels a driver brings on a trip (express, pickup) are taken in with the driver's QR
 * (worker/drivers.ts, receiveFromDriver).
 */
export async function receiveParcel(c: ParcelCtx, stationId: string, code: unknown): Promise<Parcel> {
  const actor = await parcelStationActor(c, stationId);
  const parcel = await scannedParcel(c.db, code);
  if (parcel.to_station_id !== stationId) throw new ApiError("parcel_wrong_status");
  const runId = parcel.run_id ?? "";
  if (parcel.status === "arrived") {
    const scanned = await c.db
      .prepare("select 1 from parcel_scans where parcel_id = ? and run_id = ? and kind = 'received_at_station'")
      .bind(parcel.id, runId)
      .first();
    if (scanned) return toParcel(parcel, false);
  }
  if (parcel.status !== "in_transit") throw new ApiError("parcel_wrong_status");
  if (parcel.express) throw new ApiError("parcel_with_driver");
  const run = parcel.run_id ? await loadRun(c.db, parcel.run_id) : null;
  // Timed now: the scan comes before the arrival it leads to.
  const scan = scanStatement(c.db, {
    parcelId: parcel.id,
    runId,
    kind: "received_at_station",
    driverId: run?.driver_id ?? null,
    stationId,
    by: actor.user.id,
    role: actor.role,
  });
  await arriveParcel(c, parcel, actor.user.id, stationId, await station(c.db, stationId));
  await c.db.batch([
    scan,
    c.audit(actor.user.id, "parcels", "update", parcel.id, { scan: "received_at_station", run: runId || null, role: actor.role }, { stationId }),
  ]);
  // The run is done once none of its parcels is still on the road.
  if (run && run.status === "under_way") {
    await c.db
      .prepare(
        `update parcel_runs set status = 'done', done_at = ? where id = ? and status = 'under_way'
         and not exists (select 1 from parcels where run_id = ? and status = 'in_transit')`,
      )
      .bind(nowIso(), run.id, run.id)
      .run();
  }
  const row = await c.db.prepare("select * from parcels where id = ?").bind(parcel.id).first<ParcelRow>();
  return toParcel(row!, false);
}
