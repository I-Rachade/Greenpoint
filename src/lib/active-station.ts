// The station a person works at now (W3, W4): kept per device, sent with every
// station action (header ACTIVE_STATION_HEADER, see src/lib/station-work.ts). Owners
// and admins choose it before any station action; staff with one station get theirs.

const KEY = "poinderecharge-active-station";
const listeners = new Set<() => void>();
let memory: string | null = null;

export function getActiveStation(): string | null {
  try {
    return window.localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

export function setActiveStation(id: string | null) {
  memory = id;
  try {
    if (id) window.localStorage.setItem(KEY, id);
    else window.localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: kept for this page only.
  }
  listeners.forEach((fn) => fn());
}

export function subscribeActiveStation(onChange: () => void): () => void {
  listeners.add(onChange);
  const onStorage = (e: StorageEvent) => e.key === KEY && onChange();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onStorage);
  };
}
