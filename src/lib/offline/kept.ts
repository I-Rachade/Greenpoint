// Last answers of the few reads the station screens need to work without network (the person's
// stations, a station's counter), kept per account so that another staff member logging in on
// the same phone never sees them. Read back only when the network fails.

import { readJson, writeJson } from "./storage";

const KEY = "poinderecharge-kept-answers";
const USER_KEY = "poinderecharge-kept-user";
const MAX_ACCOUNTS = 5;

/** GET paths worth keeping: the staff's stations and a station's counter. */
const KEPT_PATHS = [/^\/api\/staff\/stations$/, /^\/api\/stations\/[\w-]+\/counter$/];

type Store = Record<string, { at: number; answers: Record<string, unknown> }>;

export function isKeptPath(path: string): boolean {
  return KEPT_PATHS.some((re) => re.test(path));
}

/** The account the kept answers belong to now (set at login, offline login and each profile read). */
export function setKeptUser(userId: string | null) {
  writeJson(USER_KEY, userId);
}

function keptUser(): string | null {
  return readJson<string | null>(USER_KEY, null);
}

export function keepAnswer(path: string, value: unknown) {
  const user = keptUser();
  if (!user) return;
  const store = readJson<Store>(KEY, {});
  const mine = store[user] ?? { at: 0, answers: {} };
  store[user] = { at: Date.now(), answers: { ...mine.answers, [path]: value } };
  // Only the accounts used last on this phone.
  const ids = Object.keys(store).sort((a, b) => store[b].at - store[a].at);
  for (const id of ids.slice(MAX_ACCOUNTS)) delete store[id];
  writeJson(KEY, store);
}

export function keptAnswer<T>(path: string): T | undefined {
  const user = keptUser();
  if (!user) return undefined;
  return readJson<Store>(KEY, {})[user]?.answers[path] as T | undefined;
}
