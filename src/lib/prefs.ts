"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Small per-device preferences kept in localStorage: favourite stations, theme,
 * whether the introduction was seen, which notifications were read, and the battery
 * brand last chosen in the station filter (the station page then offers that brand first),
 * and the rider's last Bluetooth reading of their own battery (home "Mon scooter").
 * Every read and write is wrapped: storage can be missing (private mode, blocked
 * site data) and the app must still work, just without remembering.
 */

const KEYS = {
  favorites: "poinderecharge-favorites",
  theme: "poinderecharge-theme",
  onboarded: "poinderecharge-onboarded",
  alertsRead: "poinderecharge-alerts-read",
  brand: "poinderecharge-brand",
  myBattery: "poinderecharge-my-battery",
} as const;

export type Theme = "system" | "light" | "dark";

const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** A stored string, `null` on the server and before hydration. */
function useStored(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null,
  );
}

function parseList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return [];
  }
}

export function useFavorites() {
  const raw = useStored(KEYS.favorites);
  const ids = parseList(raw);
  const toggle = useCallback((id: string) => {
    const current = parseList(read(KEYS.favorites));
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    write(KEYS.favorites, JSON.stringify(next));
  }, []);
  return { ids, has: (id: string) => ids.includes(id), toggle };
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const raw = useStored(KEYS.theme);
  const theme: Theme = raw === "light" || raw === "dark" ? raw : "system";
  const set = useCallback((next: Theme) => write(KEYS.theme, next === "system" ? null : next), []);
  return [theme, set];
}

/** `null` until known (server render), then whether the introduction should be shown. */
export function useOnboarding(): [boolean | null, (seen: boolean) => void] {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(KEYS.onboarded) ?? "",
    () => null,
  );
  const set = useCallback((seen: boolean) => write(KEYS.onboarded, seen ? "1" : null), []);
  return [raw === null ? null : raw !== "1", set];
}

export function useReadAlerts(): [string[], (ids: string[]) => void] {
  const raw = useStored(KEYS.alertsRead);
  const ids = parseList(raw);
  const markRead = useCallback((more: string[]) => {
    const current = new Set(parseList(read(KEYS.alertsRead)));
    more.forEach((id) => current.add(id));
    // Keep the list short: only the newest few hundred ids matter.
    write(KEYS.alertsRead, JSON.stringify([...current].slice(-300)));
  }, []);
  return [ids, markRead];
}

/** The battery brand last chosen in the station filter; null = all brands. */
export function useBrandPref(): [string | null, (brand: string | null) => void] {
  const raw = useStored(KEYS.brand);
  const set = useCallback((brand: string | null) => write(KEYS.brand, brand && brand !== "all" ? brand : null), []);
  return [raw, set];
}

/** The rider's own battery as last read by Bluetooth on this phone (home "Mon scooter", mockup A1). */
export interface MyBatteryReading {
  socPct: number;
  voltageMv: number | null;
  remainingMah: number | null;
  serial: string | null;
  at: string;
}

function parseBattery(raw: string | null): MyBatteryReading | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<MyBatteryReading>;
    if (typeof v.socPct !== "number" || typeof v.at !== "string") return null;
    const num = (x: unknown) => (typeof x === "number" && Number.isFinite(x) ? x : null);
    return { socPct: v.socPct, voltageMv: num(v.voltageMv), remainingMah: num(v.remainingMah), serial: typeof v.serial === "string" ? v.serial : null, at: v.at };
  } catch {
    return null;
  }
}

export function useMyBattery(): [MyBatteryReading | null, (r: MyBatteryReading | null) => void] {
  const raw = useStored(KEYS.myBattery);
  const set = useCallback((r: MyBatteryReading | null) => write(KEYS.myBattery, r ? JSON.stringify(r) : null), []);
  return [parseBattery(raw), set];
}
