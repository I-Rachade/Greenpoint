// Service unlock per station (plan W11, invariant R8). See src/lib/station-services.ts
// and migration 0026_station_services.sql.
//
// serviceActive() is the one place that decides whether a service runs at a station:
// its global switch (parcel module, driver module, Lite version) AND the station's unlock.
// Every check that gates a station's service goes through it (reservations, drivers'
// queue, charging, the public station list). Parcel depots check the station half only
// (stationUnlocked), because the parcel module's switch already hides parcel routes as a
// whole and must not start blocking driver trips it never blocked.

import {
  globalServices,
  isStationService,
  STATION_SERVICES,
  type ServiceRequestStatus,
  type StationService,
  type StationServiceInfo,
} from "../src/lib/station-services";
import type { Profile } from "../src/lib/types";
import { personLabel } from "../src/lib/wallet";
import { featuresOf } from "./features";
import { ApiError, nowIso } from "./http";
import type { ParcelCtx } from "./parcels";

type Ctx = Pick<ParcelCtx, "db" | "requireUser" | "requireAdmin" | "audit">;

interface ServiceRow {
  station_id: string;
  service: StationService;
  unlocked: number;
  status: ServiceRequestStatus | null;
  requested_by: string | null;
  requested_at: string | null;
  decided_by: string | null;
  decided_at: string | null;
}

/** Whether the service runs at the station: global switch on AND station unlocked. A global switch off always wins. */
export async function serviceActive(db: D1Database, stationId: string, service: StationService): Promise<boolean> {
  const [features, unlocked] = await Promise.all([featuresOf(db), stationUnlocked(db, stationId, service)]);
  return globalServices(features)[service] && unlocked;
}

/**
 * The station half of serviceActive, for checks whose global half already happens
 * elsewhere and must stay as it is: the parcel switch hides parcel routes as a whole
 * (worker/api.ts), while driver trips that pass by a depot only follow the driver switch.
 */
export async function stationUnlocked(db: D1Database, stationId: string, service: StationService): Promise<boolean> {
  const row = await db.prepare("select unlocked from station_services where station_id = ? and service = ?").bind(stationId, service).first<{ unlocked: number }>();
  return row?.unlocked === 1;
}

/** Ids of the stations unlocked for the service (global switch not checked, as stationUnlocked). */
export async function unlockedStations(db: D1Database, service: StationService): Promise<Set<string>> {
  const { results } = await db.prepare("select station_id from station_services where service = ? and unlocked = 1").bind(service).all<{ station_id: string }>();
  return new Set(results.map((r) => r.station_id));
}

/** Refuses what needs a service the station does not run (now). */
export async function requireService(db: D1Database, stationId: string, service: StationService) {
  if (!(await serviceActive(db, stationId, service))) throw new ApiError("service_not_offered");
}

/** The active services of every station, for lists (same rule as serviceActive). */
export async function activeServices(db: D1Database): Promise<Map<string, Set<StationService>>> {
  const [features, { results }] = await Promise.all([
    featuresOf(db),
    db.prepare("select station_id, service from station_services where unlocked = 1").all<{ station_id: string; service: StationService }>(),
  ]);
  const global = globalServices(features);
  const out = new Map<string, Set<StationService>>();
  for (const r of results) {
    if (!global[r.service]) continue;
    const set = out.get(r.station_id) ?? new Set<StationService>();
    set.add(r.service);
    out.set(r.station_id, set);
  }
  return out;
}

/** SQL: station `station` is unlocked for `service` (global switches are checked apart, with featuresOf). */
export const unlockedSql = (station: string, service: StationService) =>
  `exists (select 1 from station_services ss where ss.station_id = ${station} and ss.service = '${service}' and ss.unlocked = 1)`;

// Owner requests, admin decides ----------------------------------------------------

/** Stations the account runs as owner (Betreiber); staff of a station are not owners. */
async function ownedStation(c: Ctx, user: Profile, stationId: string): Promise<boolean> {
  const row = await c.db
    .prepare("select 1 from stations s join operator_owners o on o.operator_id = s.operator_id where s.id = ? and o.user_id = ?")
    .bind(stationId, user.id)
    .first();
  return !!row;
}

/**
 * GET /api/station-services: every service of the owner's active stations, or of every
 * station for an admin. Staff, riders and everyone else: 403.
 */
export async function listStationServices(c: Ctx): Promise<StationServiceInfo[]> {
  const user = await c.requireUser();
  let stations: { id: string; name: string }[];
  if (user.role === "admin") {
    stations = (await c.db.prepare("select id, name from stations order by name").all<{ id: string; name: string }>()).results;
  } else if (user.role === "operator") {
    stations = (
      await c.db
        .prepare(
          `select s.id, s.name from stations s where s.is_active = 1
             and s.operator_id in (select operator_id from operator_owners where user_id = ?) order by s.name`,
        )
        .bind(user.id)
        .all<{ id: string; name: string }>()
    ).results;
    if (!stations.length) throw new ApiError("forbidden", 403);
  } else {
    throw new ApiError("forbidden", 403);
  }
  const [features, rows, people] = await Promise.all([
    featuresOf(c.db),
    c.db.prepare("select * from station_services").all<ServiceRow>(),
    c.db
      .prepare("select id, phone, email, full_name from users where id in (select requested_by from station_services where requested_by is not null)")
      .all<{ id: string; phone: string | null; email: string | null; full_name: string | null }>(),
  ]);
  const global = globalServices(features);
  const byKey = new Map(rows.results.map((r) => [`${r.station_id}:${r.service}`, r]));
  const label = new Map(people.results.map((u) => [u.id, personLabel({ fullName: u.full_name, phone: u.phone, email: u.email })]));
  return stations.flatMap((s) =>
    STATION_SERVICES.map((service) => {
      const r = byKey.get(`${s.id}:${service}`);
      const unlocked = r?.unlocked === 1;
      return {
        stationId: s.id,
        stationName: s.name,
        service,
        unlocked,
        status: r?.status ?? null,
        requestedBy: r?.requested_by ? (label.get(r.requested_by) ?? null) : null,
        requestedAt: r?.requested_at ?? null,
        decidedAt: r?.decided_at ?? null,
        globalOn: global[service],
        active: global[service] && unlocked,
      };
    }),
  );
}

function checkService(service: unknown): StationService {
  if (!isStationService(service)) throw new ApiError("bad_request");
  return service;
}

async function current(c: Ctx, stationId: string, service: StationService) {
  return c.db.prepare("select * from station_services where station_id = ? and service = ?").bind(stationId, service).first<ServiceRow>();
}

/** POST /api/station-services/request: the station's owner asks for a service. Owners only (an admin switches directly). */
export async function requestService(c: Ctx, stationId: string, rawService: unknown) {
  const user = await c.requireUser();
  if (user.role !== "operator" || !(await ownedStation(c, user, stationId))) throw new ApiError("forbidden", 403);
  const service = checkService(rawService);
  const before = await current(c, stationId, service);
  if (before?.unlocked) throw new ApiError("service_already_unlocked", 409);
  if (before?.status === "pending") throw new ApiError("service_request_pending", 409);
  const now = nowIso();
  await c.db.batch([
    c.db
      .prepare(
        `insert into station_services (station_id, service, unlocked, status, requested_by, requested_at) values (?1, ?2, 0, 'pending', ?3, ?4)
         on conflict (station_id, service) do update set status = 'pending', requested_by = ?3, requested_at = ?4, decided_by = null, decided_at = null`,
      )
      .bind(stationId, service, user.id, now),
    c.audit(user.id, "station_services", before ? "update" : "insert", `${stationId}:${service}`, { service, status: [before?.status ?? null, "pending"] }, { stationId }),
  ]);
}

/** POST /api/admin/station-services/decide: an admin approves (unlocks) or rejects a pending request. */
export async function decideService(c: Ctx, stationId: string, rawService: unknown, approve: boolean) {
  const admin = await c.requireAdmin();
  const service = checkService(rawService);
  const before = await current(c, stationId, service);
  if (before?.status !== "pending") throw new ApiError("no_pending_request", 409);
  const status = approve ? "approved" : "rejected";
  const now = nowIso();
  const done = await c.db.batch([
    c.db
      .prepare(
        `update station_services set status = ?3, unlocked = case when ?3 = 'approved' then 1 else unlocked end, decided_by = ?4, decided_at = ?5
         where station_id = ?1 and service = ?2 and status = 'pending'`,
      )
      .bind(stationId, service, status, admin.id, now),
    c.audit(
      admin.id,
      "station_services",
      "update",
      `${stationId}:${service}`,
      { service, status: ["pending", status], ...(approve && !before.unlocked ? { unlocked: [false, true] } : {}) },
      { stationId },
    ),
  ]);
  if (!done[0].meta.changes) throw new ApiError("no_pending_request", 409);
}

/**
 * POST /api/admin/station-services/set: an admin switches a service on or off at a station.
 * A pending request is settled with it (on = approved, off = rejected). Off keeps the station's data.
 */
export async function setService(c: Ctx, stationId: string, rawService: unknown, unlocked: boolean) {
  const admin = await c.requireAdmin();
  const service = checkService(rawService);
  const station = await c.db.prepare("select 1 from stations where id = ?").bind(stationId).first();
  if (!station) throw new ApiError("station_not_found", 404);
  const before = await current(c, stationId, service);
  if (!!before?.unlocked === unlocked) return;
  const now = nowIso();
  const settled = before?.status === "pending" ? (unlocked ? "approved" : "rejected") : null;
  await c.db.batch([
    c.db
      .prepare(
        `insert into station_services (station_id, service, unlocked, status, decided_by, decided_at) values (?1, ?2, ?3, ?4, ?5, ?6)
         on conflict (station_id, service) do update set unlocked = ?3, status = coalesce(?7, status), decided_by = ?5, decided_at = ?6`,
      )
      .bind(stationId, service, unlocked ? 1 : 0, unlocked ? "approved" : null, admin.id, now, settled),
    c.audit(
      admin.id,
      "station_services",
      before ? "update" : "insert",
      `${stationId}:${service}`,
      { service, unlocked: [!!before?.unlocked, unlocked], ...(settled ? { status: ["pending", settled] } : {}) },
      { stationId },
    ),
  ]);
}
