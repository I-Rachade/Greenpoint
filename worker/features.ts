import { effectiveFeatures, type Features } from "../src/lib/features";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { ApiError, nowIso } from "./http";

/**
 * Modules the backoffice can switch off at run time (table app_settings).
 * The Lite preset (lite_mode) hides several of them at once without touching their own switches.
 * While the parcel module is off, the app hides it and only the backoffice
 * still reaches parcel data, so admins can look up and prepare.
 */

/** Customer and staff routes of the parcel depot and of partner bookings. */
export const PARCEL_ROUTE = /^\/api\/(parcels(\/|$)|stations\/[\w-]+\/(parcels|bookings)(\/|$))/;

/** The Lite preset: hides parcels, drivers, Cashplus and car chargers for everyone. Off without the row. */
export async function liteEnabled(db: D1Database): Promise<boolean> {
  const row = await db.prepare("select value from app_settings where key = 'lite_mode'").first<{ value: string }>();
  return row?.value === "1";
}

async function storedParcels(db: D1Database): Promise<boolean> {
  const row = await db.prepare("select value from app_settings where key = 'parcels_enabled'").first<{ value: string }>();
  // Before migration 0012 the row is missing: the module was simply on.
  return row?.value !== "0";
}

export async function parcelsEnabled(env: Env): Promise<boolean> {
  return (await getFeatures(env)).parcels;
}

async function storedDrivers(db: D1Database): Promise<boolean> {
  const row = await db.prepare("select value from app_settings where key = 'drivers_enabled'").first<{ value: string }>();
  return row?.value === "1";
}

/**
 * Everything that needs a driver: rides and couriers ("Courses"), express door to
 * door, pickups at the sender's home, home deliveries and express at the counter.
 * Off until an admin switches it on: without the row, no driver is on the road yet.
 */
export async function driversEnabled(db: D1Database): Promise<boolean> {
  const [drivers, lite] = await Promise.all([storedDrivers(db), liteEnabled(db)]);
  return drivers && !lite;
}

/** Refuses a booking that needs a driver while the driver module is off. */
export async function requireDrivers(db: D1Database) {
  if (!(await driversEnabled(db))) throw new ApiError("drivers_soon", 409);
}

export async function getFeatures(env: Env): Promise<Features> {
  const [parcels, drivers, lite] = await Promise.all([storedParcels(env.DB), storedDrivers(env.DB), liteEnabled(env.DB)]);
  return effectiveFeatures({ parcels, drivers, lite });
}

export async function setParcelsEnabled(env: Env, admin: Profile, enabled: boolean) {
  const now = nowIso();
  const value = enabled ? "1" : "0";
  await env.DB.batch([
    env.DB.prepare(
      `insert into app_settings (key, value, updated_by, updated_at) values ('parcels_enabled', ?1, ?2, ?3)
       on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
    ).bind(value, admin.id, now),
    env.DB.prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'parcels', 'update', 'parcels_enabled', null, null, ?)",
    ).bind(now, admin.id, JSON.stringify({ enabled })),
  ]);
}

export async function setDriversEnabled(env: Env, admin: Profile, enabled: boolean) {
  const now = nowIso();
  const value = enabled ? "1" : "0";
  await env.DB.batch([
    env.DB.prepare(
      `insert into app_settings (key, value, updated_by, updated_at) values ('drivers_enabled', ?1, ?2, ?3)
       on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
    ).bind(value, admin.id, now),
    env.DB.prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'drivers', 'update', 'drivers_enabled', null, null, ?)",
    ).bind(now, admin.id, JSON.stringify({ enabled })),
  ]);
}

export async function setLiteEnabled(env: Env, admin: Profile, enabled: boolean) {
  const now = nowIso();
  const value = enabled ? "1" : "0";
  await env.DB.batch([
    env.DB.prepare(
      `insert into app_settings (key, value, updated_by, updated_at) values ('lite_mode', ?1, ?2, ?3)
       on conflict (key) do update set value = ?1, updated_by = ?2, updated_at = ?3`,
    ).bind(value, admin.id, now),
    env.DB.prepare(
      "insert into audit_log (at, actor, table_name, action, row_id, station_id, user_id, changes) values (?, ?, 'settings', 'update', 'lite_mode', null, null, ?)",
    ).bind(now, admin.id, JSON.stringify({ enabled })),
  ]);
}
