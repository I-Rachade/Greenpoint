"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { stationAvailability } from "@/lib/availability";
import { LOME_CENTER, type LatLng } from "@/lib/geo";
import type { StationView } from "@/lib/types";
import { AVAILABILITY_COLORS } from "./availability-badge";

// Free vector tiles from OpenStreetMap data, no API key, commercial use allowed.
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface Props {
  stations: StationView[];
  position: LatLng | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

function markerElement(station: StationView, selected: boolean): HTMLElement {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", station.name);
  const size = selected ? 34 : 26;
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "9999px",
    border: "3px solid white",
    boxShadow: "0 1px 4px rgba(0,0,0,.4)",
    background: AVAILABILITY_COLORS[stationAvailability(station)],
    color: "white",
    fontSize: selected ? "16px" : "13px",
    lineHeight: "1",
    cursor: "pointer",
  });
  el.textContent = station.kind === "swap" ? "🔋" : station.kind === "parcel" ? "📦" : "⚡";
  // Solar stations (they earn greenpoints) carry a small sun.
  if (station.isSolar) {
    el.setAttribute("aria-label", `${station.name} ☀`);
    el.style.position = "relative";
    const sun = document.createElement("span");
    sun.textContent = "☀";
    Object.assign(sun.style, {
      position: "absolute",
      top: "-9px",
      right: "-9px",
      width: "16px",
      height: "16px",
      borderRadius: "9999px",
      background: "#fbbf24",
      color: "#78350f",
      fontSize: "11px",
      lineHeight: "16px",
      textAlign: "center",
      boxShadow: "0 0 0 2px white",
    });
    el.appendChild(sun);
  }
  return el;
}

export function StationMap({ stations, position, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

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
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // Station markers, redrawn when data or selection changes.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = stations.map((station) => {
      const el = markerElement(station, station.id === selectedId);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(station.id);
      });
      return new Marker({ element: el }).setLngLat([station.lng, station.lat]).addTo(map);
    });
  }, [stations, selectedId]);

  // User position: blue dot.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!position) return;
    const el = document.createElement("div");
    Object.assign(el.style, {
      width: "16px",
      height: "16px",
      borderRadius: "9999px",
      background: "#2F80ED",
      border: "3px solid white",
      boxShadow: "0 0 0 6px rgba(47,128,237,.25)",
    });
    userMarkerRef.current = new Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(map);
  }, [position]);

  // Fly to the selected station.
  useEffect(() => {
    const map = mapRef.current;
    const station = stations.find((s) => s.id === selectedId);
    if (map && station) map.flyTo({ center: [station.lng, station.lat], zoom: Math.max(map.getZoom(), 14) });
    // Only when the selection changes, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Centre on the user once their position first arrives.
  const centredRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (map && position && !centredRef.current) {
      centredRef.current = true;
      map.flyTo({ center: [position.lng, position.lat], zoom: 13 });
    }
  }, [position]);

  return <div ref={containerRef} className="h-full w-full" />;
}
