"use client";

import { useEffect } from "react";
import { useOffline, useQueuedSwaps } from "@/lib/offline/hooks";
import { flushQueue } from "@/lib/offline/swap-queue";
import { useApp } from "../app-provider";

/** Every 30 s while swaps wait on the phone, and as soon as the network is back. */
const RETRY_MS = 30_000;

/**
 * Sends the swaps kept on this phone without network (src/lib/offline/swap-queue.ts) to the
 * back-office: on start, when the network comes back, and every 30 s while some wait. Only the
 * swaps of the person signed in, with their own session.
 */
export function OfflineSync() {
  const { backend, profile } = useApp();
  const userId = profile?.id ?? null;
  const pending = useQueuedSwaps().some((q) => q.userId === userId && q.status === "pending");
  const offline = useOffline();

  useEffect(() => {
    if (!userId || !pending || backend.mode !== "cloudflare") return;
    const send = () => void flushQueue(userId, (stationId, input) => backend.recordSwap(stationId, input)).catch(() => undefined);
    send();
    const timer = window.setInterval(send, RETRY_MS);
    window.addEventListener("online", send);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", send);
    };
  }, [backend, userId, pending, offline]);

  return null;
}
