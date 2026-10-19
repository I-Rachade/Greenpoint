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
