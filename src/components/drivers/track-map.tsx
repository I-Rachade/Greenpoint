"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import { useEffect, useRef } from "react";
import { LOME_CENTER, type LatLng } from "@/lib/geo";
import { MAP_STYLE } from "../station-map";

export type TrackPointKind = "driver" | "start" | "end" | "shop";

export interface TrackPoint extends LatLng {
  id: string;
  kind: TrackPointKind;
  /** Shown when the pin is tapped. */
  label?: string;
}

const COLOR: Record<TrackPointKind, string> = {
  driver: "#2563eb",
  start: "#1f7a3a",
  end: "#d97706",
  shop: "#7c3aed",
};

/** A driver as a blue dot with a white ring, so it reads differently from the place pins. */
function driverDot(): HTMLElement {
  const el = document.createElement("div");
  el.style.cssText = `width:18px;height:18px;border-radius:9999px;background:${COLOR.driver};border:3px solid white;box-shadow:0 0 0 2px ${COLOR.driver}55,0 1px 4px #0006`;
  return el;
}

/**
 * Driver phase 2: a small map with drivers (blue dots) and the places of a trip or a shop.
 * The view fits all points the first time and whenever the set of points changes.
 */
export function TrackMap({
  points,
  className = "h-56",
}: {
  points: TrackPoint[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markers = useRef(new Map<string, Marker>());
  const fittedFor = useRef("");

  useEffect(() => {
    if (!containerRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [LOME_CENTER.lng, LOME_CENTER.lat],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    const all = markers.current;
    return () => {
      map.remove();
      mapRef.current = null;
      all.clear();
      fittedFor.current = "";
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set<string>();
    for (const p of points) {
      seen.add(p.id);
      let marker = markers.current.get(p.id);
      if (!marker) {
        marker = (
          p.kind === "driver"
            ? new Marker({ element: driverDot() })
            : new Marker({ color: COLOR[p.kind] })
        )
          .setLngLat([p.lng, p.lat])
          .addTo(map);
        if (p.label) marker.getElement().title = p.label;
        markers.current.set(p.id, marker);
      } else {
        marker.setLngLat([p.lng, p.lat]);
      }
    }
    for (const [id, marker] of markers.current) {
      if (!seen.has(id)) {
        marker.remove();
        markers.current.delete(id);
      }
    }
    const key = points
      .map((p) => p.id)
      .sort()
      .join(",");
    if (!points.length || key === fittedFor.current) return;
    fittedFor.current = key;
    if (points.length === 1) {
      map.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
      return;
    }
    const bounds = new LngLatBounds();
    for (const p of points) bounds.extend([p.lng, p.lat]);
    map.fitBounds(bounds, { padding: 40, maxZoom: 16, duration: 0 });
  }, [points]);

  return (
    <div
      ref={containerRef}
      className={`w-full overflow-hidden rounded-lg ${className}`}
    />
  );
}
