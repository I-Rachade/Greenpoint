// Login without network for station staff (plan "app du personnel hors ligne").
//
// After each login with the server, the phone keeps for that account: the contact, the profile
// and a PBKDF2 fingerprint of the PIN with its own salt (never the PIN). Without network, the
// login screen checks the PIN typed against it. Only station accounts (role operator) that may
// work at a station, at most MAX_ACCOUNTS per phone, each for OFFLINE_MAX_DAYS after its last
// login with the server. Five wrong PINs in a row lock it for 15 minutes, as on the server.

import { parseContact } from "@shared/contact";
import { OFFLINE_MAX_DAYS } from "@shared/station-work";
import type { Profile } from "@shared/types";
import { readJson, writeJson } from "./storage";

const KEY = "poinderecharge-offline-logins";
const MAX_ACCOUNTS = 5;
const ITERATIONS = 100_000;
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;

interface Kept {
  contact: string;
  salt: string;
  hash: string;
  iterations: number;
  profile: Profile;
  /** Last login with the server (ms). */
  savedAt: number;
  failures: number;
  lockedUntil: number;
}

export type OfflineLoginResult = { ok: true; profile: Profile } | { ok: false; error: "unknown_account" | "expired" | "locked" | "wrong_pin" };

/** Station staff and owners who act at stations; customers, drivers, admins and read-only accounts never. */
export function mayLoginOffline(profile: Profile | null | undefined): boolean {
  return !!profile && profile.role === "operator" && !profile.ownerReadOnly;
}

function contactKey(input: string): string | null {
  const c = parseContact(input);
  return c ? `${c.kind}:${c.value}` : null;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const unb64 = (text: string) => Uint8Array.from(atob(text), (ch) => ch.charCodeAt(0));

async function fingerprint(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations }, key, 256);
  return b64(new Uint8Array(bits));
}

function all(): Kept[] {
  const list = readJson<Kept[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

/** After a login with the server: keep (or renew) this account's offline login. */
export async function rememberOfflineLogin(contact: string, pin: string, profile: Profile, now = Date.now()): Promise<void> {
  const id = contactKey(contact);
  if (!id || !mayLoginOffline(profile) || typeof crypto === "undefined" || !crypto.subtle) {
    forgetOfflineLogin(profile.id);
    return;
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const entry: Kept = { contact: id, salt: b64(salt), hash: await fingerprint(pin, salt, ITERATIONS), iterations: ITERATIONS, profile, savedAt: now, failures: 0, lockedUntil: 0 };
  const others = all().filter((k) => k.contact !== id && k.profile.id !== profile.id);
  writeJson(KEY, [entry, ...others].slice(0, MAX_ACCOUNTS));
}

/** The profile kept for an account, renewed when the server sends a newer one. */
export function refreshOfflineProfile(profile: Profile) {
  const list = all();
  const i = list.findIndex((k) => k.profile.id === profile.id);
  if (i < 0) return;
  if (!mayLoginOffline(profile)) return forgetOfflineLogin(profile.id);
  list[i] = { ...list[i], profile };
  writeJson(KEY, list);
}

export function forgetOfflineLogin(userId: string) {
  const list = all();
  const left = list.filter((k) => k.profile.id !== userId);
  if (left.length !== list.length) writeJson(KEY, left);
}

/** Checks the PIN without network. */
export async function offlineSignIn(contact: string, pin: string, now = Date.now()): Promise<OfflineLoginResult> {
  const id = contactKey(contact);
  const list = all();
  const i = id ? list.findIndex((k) => k.contact === id) : -1;
  if (i < 0) return { ok: false, error: "unknown_account" };
  const kept = list[i];
  if (now - kept.savedAt > OFFLINE_MAX_DAYS * 86_400_000) return { ok: false, error: "expired" };
  if (kept.lockedUntil > now) return { ok: false, error: "locked" };
  const ok = (await fingerprint(pin, unb64(kept.salt), kept.iterations)) === kept.hash;
  const failures = ok ? 0 : kept.failures + 1;
  list[i] = { ...kept, failures: failures >= MAX_FAILURES ? 0 : failures, lockedUntil: failures >= MAX_FAILURES ? now + LOCK_MS : kept.lockedUntil };
  writeJson(KEY, list);
  if (!ok) return { ok: false, error: failures >= MAX_FAILURES ? "locked" : "wrong_pin" };
  return { ok: true, profile: kept.profile };
}

// The session opened without network ---------------------------------------------------------

const SESSION_KEY = "poinderecharge-offline-session";

/** The account signed in without network (no server session yet), or null. */
export function offlineSession(): Profile | null {
  return readJson<Profile | null>(SESSION_KEY, null);
}

export function startOfflineSession(profile: Profile) {
  writeJson(SESSION_KEY, profile);
}

export function endOfflineSession() {
  writeJson(SESSION_KEY, null);
}
