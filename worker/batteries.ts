// Battery register (migration 0041_batteries.sql): every swap battery by its number, per
// brand, with its own history. Shared rules and types in src/lib/batteries.ts.
// recordSwap() (worker/station-work.ts) links its batteries with resolveSwapBattery() and
// swapBatteryStatements(); the rest is the register pages (admins, owners read-only).

import {
  BATTERY_LIST_MAX,
  cleanStatusReason,
  isBatteryStatus,
  REGISTER_MAX,
  sortBrands,
  type BatteryDetail,
  type BatteryFilter,
  type BatteryHistoryEntry,
  type BatteryHistoryType,
  type BatteryList,
  type BatteryLocation,
  type BatteryLookup,
  type BatterySource,
  type BatteryStatus,
  type BatteryStatusInput,
  type BatteryView,
  type RegisterBatteriesInput,
  type RegisterBatteriesResult,
} from "../src/lib/batteries";
import { cleanBatteryLabel, type StationRole } from "../src/lib/station-work";
import type { Profile } from "../src/lib/types";
import { personLabel } from "../src/lib/wallet";
import { ApiError, nowIso, uuid } from "./http";
import { roleAtStation, type StationActor } from "./station-work";

interface Ctx {
  db: D1Database;
  requireUser(): Promise<Profile>;
}

const label = (name: string | null | undefined, phone: string | null | undefined, email: string | null | undefined) =>
  name || phone || email ? personLabel({ fullName: name ?? null, phone: phone ?? null, email: email ?? null }) : null;

// Swaps --------------------------------------------------------------------------------

export interface SwapBattery {
  serial: string;
  /** The brand it has (or gets) in the register; "" = not known. */
  brand: string;
  /** Not registered yet: added with this swap. */
  isNew: boolean;
  /** Registered without a brand: takes the swap's. */
  adopt: boolean;
}

interface FoundRow {
  id: string;
  brand: string;
  status: BatteryStatus;
  last_swap_at: string | null;
}

/**
 * The register entry a swap's battery number means. At a station with battery types
 * (`type`): the battery of that brand, else one without brand (it takes the brand), else a
 * new one; a number registered only under other brands is refused. Without types: the one
 * battery with that number (without brand first, else the last swapped), else a new one
 * without brand.
 */
export async function resolveSwapBattery(db: D1Database, serial: string, type: { brand: string } | null): Promise<SwapBattery & { status: BatteryStatus | null }> {
  const { results } = await db.prepare("select id, brand, status, last_swap_at from batteries where serial = ?").bind(serial).all<FoundRow>();
  if (type) {
    const same = results.find((r) => r.brand === type.brand);
    if (same) return { serial, brand: same.brand, isNew: false, adopt: false, status: same.status };
    const loose = results.find((r) => r.brand === "");
    if (loose) return { serial, brand: type.brand, isNew: false, adopt: true, status: loose.status };
    if (results.length) throw new ApiError("battery_wrong_brand", 409);
    return { serial, brand: type.brand, isNew: true, adopt: false, status: null };
  }
  const found =
    results.find((r) => r.brand === "") ?? [...results].sort((a, b) => (b.last_swap_at ?? "").localeCompare(a.last_swap_at ?? ""))[0];
  if (found) return { serial, brand: found.brand, isNew: false, adopt: false, status: found.status };
  return { serial, brand: "", isNew: true, adopt: false, status: null };
}

/** The station's battery type, with its brand; null at a station without types (key ""). */
export async function swapType(db: D1Database, key: string): Promise<{ id: string; brand: string } | null> {
  if (!key) return null;
  return db.prepare("select id, brand from battery_types where id = ?").bind(key).first<{ id: string; brand: string }>();
}

interface SwapBatterySpec {
  battery: SwapBattery;
  direction: "out" | "in";
  type: { id: string; brand: string } | null;
  stationId: string;
  swapId: string;
  /** swap_log.request_id: every statement only takes effect once the swap row exists. */
  requestId: string;
  /** The customer's or driver's account; null for a cash customer. */
  holderId: string | null;
  actor: StationActor;
  now: string;
}

/**
 * Statements that put a swap's battery in the register (added when new, brand taken when
 * it had none), write its history row, move it (handed out: with the customer; brought
 * back: at the station) and point the swap log at it. Part of the swap's batch.
 */
export function swapBatteryStatements(db: D1Database, s: SwapBatterySpec): D1PreparedStatement[] {
  const { battery: b } = s;
  const swapExists = "exists (select 1 from swap_log where request_id = ?)";
  const idOf = "(select id from batteries where brand = ? and serial = ?)";
  const out: D1PreparedStatement[] = [];
  if (b.isNew) {
    const newId = uuid();
    out.push(
      db
        .prepare(
          `insert or ignore into batteries (id, serial, brand, battery_type_id, source, created_at)
           select ?, ?, ?, ?, 'swap', ? where ${swapExists}`,
        )
        .bind(newId, b.serial, b.brand, s.type?.id ?? null, s.now, s.requestId),
      db
        .prepare(
          `insert into battery_history (id, battery_id, type, station_id, swap_id, person_id, role, created_at)
           select ?, ?, 'added_at_swap', ?, ?, ?, ?, ? where exists (select 1 from batteries where id = ?) and ${swapExists}`,
        )
        .bind(uuid(), newId, s.stationId, s.swapId, s.actor.user.id, s.actor.role, s.now, newId, s.requestId),
    );
  }
  if (b.adopt) {
    out.push(
      db
        .prepare(`update batteries set brand = ?, battery_type_id = coalesce(battery_type_id, ?) where brand = '' and serial = ? and ${swapExists}`)
        .bind(b.brand, s.type?.id ?? null, b.serial, s.requestId),
    );
  }
  const handedOut = s.direction === "out";
  out.push(
    db
      .prepare(
        `insert into battery_history (id, battery_id, type, station_id, swap_id, holder_user_id, person_id, role, created_at)
         select ?, id, ?, ?, ?, ?, ?, ?, ? from batteries where brand = ? and serial = ? and ${swapExists}`,
      )
      .bind(uuid(), s.direction, s.stationId, s.swapId, s.holderId, s.actor.user.id, s.actor.role, s.now, b.brand, b.serial, s.requestId),
    db
      .prepare(
        `update batteries set location = ?, station_id = ?, holder_user_id = ?, last_swap_at = ?,
           battery_type_id = coalesce(battery_type_id, ?)
         where brand = ? and serial = ? and ${swapExists}`,
      )
      .bind(handedOut ? "customer" : "station", handedOut ? null : s.stationId, handedOut ? s.holderId : null, s.now, s.type?.id ?? null, b.brand, b.serial, s.requestId),
    db
      .prepare(`update swap_log set ${handedOut ? "battery_out_id" : "battery_in_id"} = ${idOf} where request_id = ?`)
      .bind(b.brand, b.serial, s.requestId),
  );
  return out;
}

/** GET /api/stations/:id/batteries/lookup?serial=&batteryTypeId=: what the swap form shows under a number. */
export async function lookupBattery(c: Ctx, stationId: string, rawSerial: string | null, rawType: string | null): Promise<BatteryLookup> {
  const user = await c.requireUser();
  if (!(await roleAtStation(c.db, user, stationId))) throw new ApiError("forbidden", 403);
  const serial = cleanBatteryLabel(rawSerial);
  if (!serial) throw new ApiError("bad_request");
  let type: { id: string; brand: string } | null = null;
  if (rawType) {
    const known = await c.db
      .prepare("select t.id, t.brand from station_battery_types sbt join battery_types t on t.id = sbt.battery_type_id where sbt.station_id = ? and t.id = ?")
      .bind(stationId, rawType)
      .first<{ id: string; brand: string }>();
    if (!known) throw new ApiError("bad_request");
    type = known;
  }
  try {
    const found = await resolveSwapBattery(c.db, serial, type);
    return found.isNew ? { state: "new", brand: null, status: null } : { state: "known", brand: found.adopt ? "" : found.brand, status: found.status };
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "battery_wrong_brand") throw err;
    const other = await c.db.prepare("select brand, status from batteries where serial = ? order by brand limit 1").bind(serial).first<{ brand: string; status: BatteryStatus }>();
    return { state: "wrong_brand", brand: other?.brand ?? null, status: other?.status ?? null };
  }
}

// Register pages -----------------------------------------------------------------------

interface Viewer {
  user: Profile;
  /** Admins see and change everything; an owner reads the batteries of own stations. */
  admin: boolean;
}

const OWN_STATIONS = `select s.id from stations s join operator_owners o on o.operator_id = s.operator_id where o.user_id = ?`;

async function viewer(c: Ctx): Promise<Viewer> {
  const user = await c.requireUser();
  if (user.role === "admin") return { user, admin: true };
  if (user.role === "operator") {
    const owner = await c.db.prepare("select 1 as ok from operator_owners where user_id = ? limit 1").bind(user.id).first<{ ok: number }>();
    if (owner) return { user, admin: false };
  }
  throw new ApiError("forbidden", 403);
}

async function ownStations(c: Ctx, v: Viewer): Promise<Set<string> | null> {
  if (v.admin) return null;
  const { results } = await c.db.prepare(OWN_STATIONS).bind(v.user.id).all<{ id: string }>();
  return new Set(results.map((r) => r.id));
}

interface BatteryRow {
  id: string;
  serial: string;
  brand: string;
  battery_type_id: string | null;
  type_label: string | null;
  status: BatteryStatus;
  source: BatterySource;
  location: BatteryLocation;
  station_id: string | null;
  station_name: string | null;
  h_name: string | null;
  h_phone: string | null;
  h_email: string | null;
  out_station: string | null;
  swaps: number;
  last_swap_at: string | null;
  created_at: string;
}

const BATTERY_SELECT = `
  select b.*, t.brand || ' ' || t.name as type_label, s.name as station_name,
         hu.full_name as h_name, hu.phone as h_phone, hu.email as h_email,
         (select h.station_id from battery_history h where h.battery_id = b.id and h.type = 'out' order by h.created_at desc, h.rowid desc limit 1) as out_station,
         (select count(*) from battery_history h where h.battery_id = b.id and h.type in ('out', 'in')) as swaps
  from batteries b
  left join battery_types t on t.id = b.battery_type_id
  left join stations s on s.id = b.station_id
  left join users hu on hu.id = b.holder_user_id`;

function toBattery(r: BatteryRow, own: Set<string> | null): BatteryView {
  // An owner sees who has it only when it was handed out at one of their stations.
  const holderShown = r.location === "customer" && (!own || (r.out_station !== null && own.has(r.out_station)));
  return {
    id: r.id,
    serial: r.serial,
    brand: r.brand,
    batteryTypeId: r.battery_type_id,
    typeLabel: r.type_label,
    status: r.status,
    source: r.source,
    location: r.location,
    stationId: r.station_id,
    stationName: r.station_name,
    holder: holderShown ? label(r.h_name, r.h_phone, r.h_email) : null,
    swaps: r.swaps,
    lastSwapAt: r.last_swap_at,
    createdAt: r.created_at,
  };
}

/** GET /api/batteries?brand=&q=&status=&stationId=: the register, per brand. */
export async function listBatteries(c: Ctx, filter: BatteryFilter): Promise<BatteryList> {
  const v = await viewer(c);
  const own = await ownStations(c, v);
  const stationId = filter.stationId || null;
  if (stationId && own && !own.has(stationId)) throw new ApiError("forbidden", 403);
  const scope = v.admin ? null : v.user.id;
  const scopeSql = `(?1 is null or exists (select 1 from battery_history h where h.battery_id = b.id and h.station_id in (${OWN_STATIONS.replace("?", "?1")})))`;
  const q = String(filter.q ?? "").trim().toUpperCase();
  const like = q ? `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
  const brand = filter.brand === undefined || filter.brand === null ? null : String(filter.brand);
  const status = isBatteryStatus(filter.status) ? filter.status : null;
  const [list, counts, types] = await Promise.all([
    c.db
      .prepare(
        `${BATTERY_SELECT}
         where ${scopeSql} and (?2 is null or b.brand = ?2) and (?3 is null or b.serial like ?3 escape '\\') and (?4 is null or b.status = ?4)
           and (?5 is null or exists (select 1 from battery_history h where h.battery_id = b.id and h.station_id = ?5))
         order by coalesce(b.last_swap_at, b.created_at) desc, b.serial limit ${BATTERY_LIST_MAX}`,
      )
      .bind(scope, brand, like, status, stationId)
      .all<BatteryRow>(),
    c.db.prepare(`select b.brand, count(*) as n from batteries b where ${scopeSql} group by b.brand`).bind(scope).all<{ brand: string; n: number }>(),
    c.db.prepare("select distinct brand from battery_types").all<{ brand: string }>(),
  ]);
  const byBrand = new Map<string, number>(types.results.map((t) => [t.brand, 0]));
  for (const r of counts.results) byBrand.set(r.brand, r.n);
  return {
    brands: sortBrands([...byBrand].map(([b, count]) => ({ brand: b, count }))),
    batteries: list.results.map((r) => toBattery(r, own)),
    canEdit: v.admin,
  };
}

interface HistoryRow {
  id: string;
  type: BatteryHistoryType;
  station_id: string | null;
  station_name: string | null;
  swap_id: string | null;
  status: BatteryStatus | null;
  reason: string | null;
  role: StationRole;
  created_at: string;
  h_name: string | null;
  h_phone: string | null;
  h_email: string | null;
  p_name: string | null;
  p_phone: string | null;
  p_email: string | null;
  payment: string | null;
  amount_xof: number | null;
}

/** GET /api/batteries/:id: one battery with its history, newest first. */
export async function batteryDetail(c: Ctx, id: string): Promise<BatteryDetail> {
  const v = await viewer(c);
  const own = await ownStations(c, v);
  const row = await c.db.prepare(`${BATTERY_SELECT} where b.id = ?`).bind(id).first<BatteryRow>();
  if (!row) throw new ApiError("not_found", 404);
  const { results } = await c.db
    .prepare(
      `select h.*, s.name as station_name, hu.full_name as h_name, hu.phone as h_phone, hu.email as h_email,
              pu.full_name as p_name, pu.phone as p_phone, pu.email as p_email, l.payment, l.amount_xof
       from battery_history h
       left join stations s on s.id = h.station_id
       left join users hu on hu.id = h.holder_user_id
       left join users pu on pu.id = h.person_id
       left join swap_log l on l.id = h.swap_id
       where h.battery_id = ? order by h.created_at desc, h.rowid desc`,
    )
    .bind(id)
    .all<HistoryRow>();
  if (own && !results.some((h) => h.station_id && own.has(h.station_id))) throw new ApiError("not_found", 404);
  const history: BatteryHistoryEntry[] = results.map((h) => {
    // An owner does not see the people of another operator's station.
    const hidden = own !== null && h.station_id !== null && !own.has(h.station_id);
    return {
      id: h.id,
      type: h.type,
      stationId: h.station_id,
      stationName: h.station_name,
      swapId: h.swap_id,
      holder: hidden ? null : label(h.h_name, h.h_phone, h.h_email),
      payment: hidden ? null : h.payment,
      amountXof: hidden ? null : h.amount_xof,
      status: h.status,
      reason: h.reason,
      person: hidden ? "" : (label(h.p_name, h.p_phone, h.p_email) ?? ""),
      role: h.role,
      createdAt: h.created_at,
    };
  });
  return { ...toBattery(row, own), history };
}

async function requireAdmin(c: Ctx): Promise<Profile> {
  const user = await c.requireUser();
  if (user.role !== "admin") throw new ApiError("forbidden", 403);
  return user;
}

/** POST /api/admin/batteries: registers numbers for a battery type (admins); known ones stay as they are. */
export async function registerBatteries(c: Ctx, input: RegisterBatteriesInput): Promise<RegisterBatteriesResult> {
  const admin = await requireAdmin(c);
  const type = await c.db.prepare("select id, brand from battery_types where id = ?").bind(String(input?.batteryTypeId ?? "")).first<{ id: string; brand: string }>();
  if (!type || !Array.isArray(input?.serials)) throw new ApiError("bad_request");
  const serials: string[] = [];
  const invalid: string[] = [];
  for (const raw of input.serials) {
    const clean = cleanBatteryLabel(raw);
    if (!clean) invalid.push(String(raw ?? ""));
    else if (!serials.includes(clean)) serials.push(clean);
  }
  if (serials.length > REGISTER_MAX) throw new ApiError("bad_request");
  const existing: string[] = [];
  let added = 0;
  const now = nowIso();
  for (let i = 0; i < serials.length; i += 100) {
    const chunk = serials.slice(i, i + 100);
    const { results } = await c.db
      .prepare("select serial, brand from batteries where serial in (select value from json_each(?)) and brand in (?, '')")
      .bind(JSON.stringify(chunk), type.brand)
      .all<{ serial: string; brand: string }>();
    const statements: D1PreparedStatement[] = [];
    for (const serial of chunk) {
      if (results.some((r) => r.serial === serial && r.brand === type.brand)) {
        existing.push(serial);
        continue;
      }
      const loose = results.some((r) => r.serial === serial && r.brand === "");
      if (loose) {
        statements.push(
          c.db.prepare("update batteries set brand = ?, battery_type_id = ? where brand = '' and serial = ?").bind(type.brand, type.id, serial),
        );
      } else {
        statements.push(
          c.db
            .prepare("insert or ignore into batteries (id, serial, brand, battery_type_id, source, created_at) values (?, ?, ?, ?, 'registered', ?)")
            .bind(uuid(), serial, type.brand, type.id, now),
        );
      }
      statements.push(
        c.db
          .prepare(
            `insert into battery_history (id, battery_id, type, person_id, role, created_at)
             select ?, id, 'registered', ?, 'admin', ? from batteries where brand = ? and serial = ?`,
          )
          .bind(uuid(), admin.id, now, type.brand, serial),
      );
      added++;
    }
    if (statements.length) await c.db.batch(statements);
  }
  return { added, existing, invalid };
}

/** PATCH /api/admin/batteries/:id: in service, repair, lost or retired, with an optional reason (admins). */
export async function setBatteryStatus(c: Ctx, id: string, input: BatteryStatusInput): Promise<void> {
  const admin = await requireAdmin(c);
  const reason = cleanStatusReason(input?.reason);
  if (!isBatteryStatus(input?.status) || reason === undefined) throw new ApiError("bad_request");
  const now = nowIso();
  const res = await c.db.batch([
    c.db.prepare("update batteries set status = ? where id = ?").bind(input.status, id),
    c.db
      .prepare(
        `insert into battery_history (id, battery_id, type, status, reason, person_id, role, created_at)
         select ?, id, 'status', ?, ?, ?, 'admin', ? from batteries where id = ?`,
      )
      .bind(uuid(), input.status, reason, admin.id, now, id),
  ]);
  if (!res[0].meta.changes) throw new ApiError("not_found", 404);
}
