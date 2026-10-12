"use client";

import { useEffect, useState } from "react";
import type { LatLng } from "./geo";

export type PositionState = "locating" | "ok" | "denied";

/** Follows the user's position live while the page is open. */
export function usePosition(): { position: LatLng | null; state: PositionState } {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [state, setState] = useState<PositionState>("locating");

  useEffect(() => {
    if (!("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("denied");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setState("ok");
      },
      () => setState("denied"),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { position, state };
}
