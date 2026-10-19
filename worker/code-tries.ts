// Tries of codes staff type at the counter for someone else (greenpoint rewards, Green Credit, card numbers).
// The try is written down before the code is compared, in one statement with the count, so
// parallel requests cannot pass the limit; a right code takes its try back.
import { ApiError, nowIso } from "./http";

/** Wrong codes a staff member may type within COUNTER_CODE_LOCK_MINUTES before they are stopped. */
export const COUNTER_CODE_MAX_TRIES = 10;
export const COUNTER_CODE_LOCK_MINUTES = 15;

export type CounterCodeKind = "greenpoint" | "credit" | "card";

/**
 * Checks a code with `check` (which throws when it is wrong), counting the try for this staff
 * member: once COUNTER_CODE_MAX_TRIES wrong tries are counted, 429 code_locked until they age out.
 */
export async function withCounterCodeTry<T>(db: D1Database, staffId: string, kind: CounterCodeKind, check: () => Promise<T>): Promise<T> {
  const now = nowIso();
  const since = new Date(Date.now() - COUNTER_CODE_LOCK_MINUTES * 60_000).toISOString();
  const tried = await db
    .prepare(
      `insert into counter_code_tries (staff_id, kind, at)
       select ?1, ?2, ?3 where (select count(*) from counter_code_tries where staff_id = ?1 and at > ?4) < ?5
       returning rowid`,
    )
    .bind(staffId, kind, now, since, COUNTER_CODE_MAX_TRIES)
    .first<{ rowid: number }>();
  if (!tried) throw new ApiError("code_locked", 429);
  const result = await check();
  await db.batch([
    db.prepare("delete from counter_code_tries where rowid = ?").bind(tried.rowid),
    db.prepare("delete from counter_code_tries where at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()),
  ]);
  return result;
}

/**
 * Checks a pickup code with `check` (which throws when it is wrong), counting the try under
 * `key` in parcel_code_failures (0005): a station id for a bare code, "parcel:<id>" once the
 * parcel is known, "job:<id>" at the door. The try is written first, guarded by the count, so
 * parallel requests cannot pass `maxTries`; only a wrong code (wrong_pickup_code) keeps its try.
 */
export async function withPickupCodeTry<T>(db: D1Database, key: string, maxTries: number, lockMinutes: number, check: () => Promise<T>): Promise<T> {
  const since = new Date(Date.now() - lockMinutes * 60_000).toISOString();
  const tried = await db
    .prepare(
      `insert into parcel_code_failures (station_id, at)
       select ?1, ?2 where (select count(*) from parcel_code_failures where station_id = ?1 and at > ?3) < ?4
       returning id`,
    )
    .bind(key, nowIso(), since, maxTries)
    .first<{ id: number }>();
  if (!tried) throw new ApiError("code_locked", 429);
  const takeBack = () =>
    db.batch([
      db.prepare("delete from parcel_code_failures where id = ?").bind(tried.id),
      db.prepare("delete from parcel_code_failures where at < ?").bind(new Date(Date.now() - 86_400_000).toISOString()),
    ]);
  let result: T;
  try {
    result = await check();
  } catch (err) {
    // Only a wrong code counts; any other refusal (parcel with a driver, …) takes the try back.
    if (!(err instanceof ApiError && err.code === "wrong_pickup_code")) await takeBack();
    throw err;
  }
  await takeBack();
  return result;
}

