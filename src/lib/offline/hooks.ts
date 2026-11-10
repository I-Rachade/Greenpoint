"use client";

import { useSyncExternalStore } from "react";
import { isOffline, subscribeConnectivity } from "./connectivity";
import { queuedSwaps, subscribeQueue, type QueuedSwap } from "./swap-queue";

const NONE: QueuedSwap[] = [];

/** The swaps kept on this phone (src/lib/offline/swap-queue.ts), live. */
export function useQueuedSwaps(): QueuedSwap[] {
  return useSyncExternalStore(subscribeQueue, queuedSwaps, () => NONE);
}

/** True while the server cannot be reached (the last call failed for lack of network). */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribeConnectivity, isOffline, () => false);
}
