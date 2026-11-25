"use client";

import { useSyncExternalStore } from "react";
import { getActiveStation, setActiveStation, subscribeActiveStation } from "@/lib/active-station";

/** The station chosen on this device (src/lib/active-station.ts) and the way to change it. */
export function useActiveStation(): [string | null, (id: string | null) => void] {
  const id = useSyncExternalStore(subscribeActiveStation, getActiveStation, () => null);
  return [id, setActiveStation];
}
