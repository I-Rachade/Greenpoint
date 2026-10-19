// Tries of codes typed for someone else or for something held: counter codes (greenpoint rewards,
// Green Credit, card numbers), parcel and door codes, reservation pickup codes. One building block
// (withCodeTry): the try is written down before the code is compared, in one statement with the
// count, so parallel requests cannot pass the limit; a right code takes its try back.
import { ApiError, nowIso } from "./http";

/** Where the tries of one kind of code are written down, and how many are allowed. */
interface TryLog {
  table: "counter_code_tries" | "parcel_code_failures" | "reservation_code_failures";
  /** The column the tries are counted by (who typed, or what the code is for), and its value. */
  key: [column: string, value: string];
  /** Other columns of the row. */
  extra?: [column: string, value: string][];
  maxTries: number;
  lockMinutes: number;
}

/**
 * Runs `check` (which throws when the code is wrong) as one counted try: once `maxTries` tries are
 * counted for the key within `lockMinutes`, 429 code_locked without checking. A right code takes its
 * try back, and so does a refusal `wrong` does not count as a wrong code.
 */
export async function withCodeTry<T>(db: D1Database, log: TryLog, check: () => Promise<T>, wrong: (err: unknown) => boolean = () => true): Promise<T> {
  const since = new Date(Date.now() - log.lockMinutes * 60_000).toISOString();
  const columns = [log.key, ...(log.extra ?? [])];
  const names = columns.map(([c]) => c).join(", ");
  const marks = columns.map((_, i) => `?${i + 4}`).join(", ");
  const tried = await db
    .prepare(
      `insert into ${log.table} (${names}, at)
       select ${marks}, ?1 where (select count(*) from ${log.table} where ${log.key[0]} = ?4 and at > ?2) < ?3
       returning rowid as try_id`,
    )
    .bind(nowIso(), since, log.maxTries, ...columns.map(([, v]) => v))
    .first<{ try_id: number }>();
  if (!tried) throw new ApiError("code_locked", 429);
  const takeBack = () =>
    db.batch([
      db.prepare(`delete from ${log.table} where rowid = ?`).bind(tried.try_id),
      db.prepare(`delete from ${log.table} where at < ?`).bind(new Date(Date.now() - 86_400_000).toISOString()),
    ]);
  let result: T;
  try {
    result = await check();
  } catch (err) {
    if (!wrong(err)) await takeBack();
    throw err;
  }
  await takeBack();
  return result;
}

/** Wrong codes a staff member may type within COUNTER_CODE_LOCK_MINUTES before they are stopped. */
export const COUNTER_CODE_MAX_TRIES = 10;
export const COUNTER_CODE_LOCK_MINUTES = 15;

export type CounterCodeKind = "greenpoint" | "credit" | "card";

/**
 * Checks a code with `check` (which throws when it is wrong), counting the try for this staff
 * member: once COUNTER_CODE_MAX_TRIES wrong tries are counted, 429 code_locked until they age out.
 */
export function withCounterCodeTry<T>(db: D1Database, staffId: string, kind: CounterCodeKind, check: () => Promise<T>): Promise<T> {
  const log: TryLog = { table: "counter_code_tries", key: ["staff_id", staffId], extra: [["kind", kind]], maxTries: COUNTER_CODE_MAX_TRIES, lockMinutes: COUNTER_CODE_LOCK_MINUTES };
  return withCodeTry(db, log, check);
}

/**
 * Checks a pickup code with `check` (which throws when it is wrong), counting the try under
 * `key` in parcel_code_failures (0005): a station id for a bare code, "parcel:<id>" once the
 * parcel is known, "job:<id>" at the door. The try is written first, guarded by the count, so
 * parallel requests cannot pass `maxTries`; only a wrong code (wrong_pickup_code) keeps its try.
 */
export function withPickupCodeTry<T>(db: D1Database, key: string, maxTries: number, lockMinutes: number, check: () => Promise<T>): Promise<T> {
  // Only a wrong code counts; any other refusal (parcel with a driver, …) takes the try back.
  return withCodeTry(db, { table: "parcel_code_failures", key: ["station_id", key], maxTries, lockMinutes }, check, isWrongPickupCode);
}

/** Whether a refusal is a wrong pickup code (the only one that keeps its try). */
export const isWrongPickupCode = (err: unknown) => err instanceof ApiError && err.code === "wrong_pickup_code";

