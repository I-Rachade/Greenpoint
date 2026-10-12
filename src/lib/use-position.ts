"use client";

import { useEffect, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import type { LatLng } from "./geo";
import { isNativeApp } from "./native";

export type PositionState = "locating" | "ok" | "denied";

const WATCH_OPTIONS = { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 };

/** Follows the user's position live while the page is open. */
export function usePosition(): { position: LatLng | null; state: PositionState } {
  const [position, setPosition] = useState<LatLng | null>(null);
  const [state, setState] = useState<PositionState>("locating");

  useEffect(() => {
    const onPosition = (coords: { latitude: number; longitude: number }) => {
      setPosition({ lat: coords.latitude, lng: coords.longitude });
      setState("ok");
    };

    if (isNativeApp()) return watchNative(onPosition, () => setState("denied"));

    if (!("geolocation" in navigator)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState("denied");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => onPosition(pos.coords),
      () => setState("denied"),
      WATCH_OPTIONS,
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  return { position, state };
}

/** In the app, the native plugin asks for permission and gives better fixes than the WebView. */
function watchNative(
  onPosition: (coords: { latitude: number; longitude: number }) => void,
  onDenied: () => void,
): () => void {
  let cancelled = false;
  let watchId: string | null = null;

  (async () => {
    try {
      let perm = await Geolocation.checkPermissions();
      if (perm.location !== "granted") perm = await Geolocation.requestPermissions({ permissions: ["location"] });
      if (perm.location !== "granted") return onDenied();
      const id = await Geolocation.watchPosition(WATCH_OPTIONS, (pos, err) => {
        if (pos) onPosition(pos.coords);
        else if (err) onDenied();
      });
      if (cancelled) void Geolocation.clearWatch({ id });
      else watchId = id;
    } catch {
      if (!cancelled) onDenied();
    }
  })();

  return () => {
    cancelled = true;
    if (watchId) void Geolocation.clearWatch({ id: watchId });
  };
}
