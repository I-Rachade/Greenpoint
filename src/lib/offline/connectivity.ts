// Whether the app reaches the server: set by each API call (src/lib/backend/cloudflare.ts),
// more reliable than navigator.onLine (a phone on Wi-Fi without internet says "online").

const listeners = new Set<() => void>();
let offline = false;

export function isOffline(): boolean {
  return offline;
}

export function reportReached(reached: boolean) {
  if (offline === !reached) return;
  offline = !reached;
  listeners.forEach((fn) => fn());
}

export function subscribeConnectivity(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
