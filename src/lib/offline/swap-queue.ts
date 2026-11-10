// Battery swaps made without network (plan "app du personnel hors ligne"): kept on the phone,
// at most OFFLINE_QUEUE_MAX, and sent one by one, oldest first, when the network is back.
// Each keeps its request id, so a swap sent twice (answer lost on the way) is recorded once,
// and its real time (offlineAt): the server keeps it and marks what no longer matches "to check"
// (worker/station-work.ts, migration 0071). A swap the server refuses stays here, marked refused,
// until the staff remove it; the admin sees it too.

import { OFFLINE_QUEUE_MAX, type SwapInput } from "@shared/station-work";
import { isNetworkError, readJson, writeJson } from "./storage";

const KEY = "poinderecharge-offline-swaps";

export interface QueuedSwap {
  stationId: string;
  stationName: string;
  /** Who made it: only they send it (with their own session). */
  userId: string;
  person: string;
  input: SwapInput & { offlineAt: string };
  status: "pending" | "refused";
  /** Refused: the server's error code. */
  error?: string;
}

export class QueueFullError extends Error {
  constructor() {
    super("offline_queue_full");
  }
}

const listeners = new Set<() => void>();
let snapshot: QueuedSwap[] | null = null;

function read(): QueuedSwap[] {
  const list = readJson<QueuedSwap[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

function write(list: QueuedSwap[]): boolean {
  const ok = writeJson(KEY, list);
  snapshot = null;
  listeners.forEach((fn) => fn());
  return ok;
}

/** The swaps kept on this phone, oldest first (same object until it changes, for useSyncExternalStore). */
export function queuedSwaps(): QueuedSwap[] {
  if (!snapshot) snapshot = read();
  return snapshot;
}

export function subscribeQueue(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    snapshot = null;
    fn();
  };
  if (typeof window !== "undefined") window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    if (typeof window !== "undefined") window.removeEventListener("storage", onStorage);
  };
}

/** Keeps a swap to send later; throws QueueFullError at OFFLINE_QUEUE_MAX (refused ones count until removed). */
export function enqueueSwap(item: Omit<QueuedSwap, "status">): void {
  const list = read();
  if (list.some((q) => q.input.requestId === item.input.requestId)) return;
  if (list.length >= OFFLINE_QUEUE_MAX) throw new QueueFullError();
  if (!write([...list, { ...item, status: "pending" }])) throw new Error("storage_unavailable");
}

export function removeQueuedSwap(requestId: string) {
  write(read().filter((q) => q.input.requestId !== requestId));
}

/** Answers that say nothing about the swap: it stays pending and is sent again later. */
function retryLater(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (isNetworkError(err)) return true;
  // A server failure (500) has no code of its own: try again later too.
  if (e?.code === "unknown" && (!e.message || e.message === "unknown")) return true;
  return e?.code === "not_authenticated" || e?.code === "rate_limited" || e?.code === "active_station_required";
}

export interface FlushResult {
  sent: number;
  refused: number;
  /** Stopped early (no network, session over): what is left goes next time. */
  stopped: boolean;
}

let running: Promise<FlushResult> | null = null;

/**
 * Sends the pending swaps of `userId`, oldest first, one at a time. Stops at the first network
 * failure; a refusal marks that swap refused and goes on with the next one.
 */
export function flushQueue(userId: string, send: (stationId: string, input: SwapInput) => Promise<unknown>): Promise<FlushResult> {
  if (running) return running;
  running = (async () => {
    const result: FlushResult = { sent: 0, refused: 0, stopped: false };
    for (const item of read().filter((q) => q.userId === userId && q.status === "pending")) {
      try {
        await send(item.stationId, item.input);
        removeQueuedSwap(item.input.requestId);
        result.sent += 1;
      } catch (err) {
        if (retryLater(err)) {
          result.stopped = true;
          break;
        }
        const error = (err as { message?: string; code?: string } | null)?.message || (err as { code?: string } | null)?.code || "unknown";
        write(read().map((q) => (q.input.requestId === item.input.requestId ? { ...q, status: "refused", error } : q)));
        result.refused += 1;
      }
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}
