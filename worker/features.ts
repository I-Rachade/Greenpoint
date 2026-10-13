import type { Features } from "../src/lib/features";
import type { Profile } from "../src/lib/types";
import type { Env } from "./env";
import { nowIso } from "./http";

/**
 * Modules the backoffice can switch off at run time (table app_settings).
 * While the parcel module is off, the app hides it and only the backoffice
 * still reaches parcel data, so admins can look up and prepare.
 */

/** Customer and staff routes of the parcel depot and of partner bookings. */
export const PARCEL_ROUTE = /^\/api\/(parcels(\/|$)|stations\/[\w-]+\/(parcels|bookings)(\/|$))/;

export async function parcelsEnabled(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("select value from app_settings where key = 'parcels_enabled'").first<{ value: string }>();
  // Before migration 0012 the row is missing: the module was simply on.
  return row?.value !== "0";
}

export async function getFeatures(env: Env): Promise<Features> {
  return { parcels: await parcelsEnabled(env) };
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
