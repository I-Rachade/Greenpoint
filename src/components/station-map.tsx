"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { stationAvailability } from "@/lib/availability";
import { LOME_CENTER, type LatLng } from "@/lib/geo";
import { isUnattended } from "@/lib/station-extras";
import type { StationView } from "@/lib/types";
import { AVAILABILITY_COLORS } from "./availability-badge";
import { useReducedMotion } from "./ui";

// Free vector tiles from OpenStreetMap data, no API key, commercial use allowed.
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface Props {
  stations: StationView[];
  position: LatLng | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/** What a marker looks like; when this is unchanged after a live update, the marker is left alone. */
function markerLook(station: StationView, selected: boolean): string {
  return [
    station.name,
    station.kind,
    station.isSolar,
    (station.evChargers ?? []).length > 0,
    stationAvailability(station),
    isUnattended(station),
    selected,
  ].join("|");
}

/** Draws a station marker into `el` (a button created once per station and kept). */
function drawMarker(el: HTMLButtonElement, station: StationView, selected: boolean) {
  el.replaceChildren();
  el.setAttribute("aria-label", station.name);
  el.setAttribute("aria-pressed", String(selected));
  const size = selected ? 34 : 26;
  Object.assign(el.style, {
    width: `${size}px`,
    height: `${size}px`,
    borderRadius: "9999px",
    // Stations with an electric car charger get a blue ring.
    border: `3px solid ${(station.evChargers ?? []).length > 0 ? "var(--gp-info)" : "white"}`,
    boxShadow: "0 1px 4px rgba(0,0,0,.4)",
    background: AVAILABILITY_COLORS[stationAvailability(station)],
    color: "white",
    fontSize: selected ? "16px" : "13px",
    lineHeight: "1",
    cursor: "pointer",
    // Stations nobody answers for (no phone, no staff) are shown greyed out: no reservation there.
    opacity: isUnattended(station) && !selected ? "0.55" : "1",
    filter: isUnattended(station) ? "grayscale(1)" : "",
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
      background: "var(--gp-yellow)",
      color: "var(--gp-forest)",
      fontSize: "11px",
      lineHeight: "16px",
      textAlign: "center",
      boxShadow: "0 0 0 2px white",
    });
    el.appendChild(sun);
  } else {
    el.style.position = "";
  }
}

export function StationMap({ stations, position, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef(new Map<string, { marker: Marker; el: HTMLButtonElement; look: string }>());
  const userMarkerRef = useRef<Marker | null>(null);
  const onSelectRef = useRef(onSelect);
  const reduced = useReducedMotion();

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

  // Station markers, keyed by station: a live update only touches the markers that changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const station of stations) {
      seen.add(station.id);
      const look = markerLook(station, station.id === selectedId);
      const current = markers.get(station.id);
      if (current) {
        const at = current.marker.getLngLat();
        if (at.lng !== station.lng || at.lat !== station.lat) current.marker.setLngLat([station.lng, station.lat]);
        if (current.look !== look) {
          drawMarker(current.el, station, station.id === selectedId);
          current.look = look;
        }
        continue;
      }
      const el = document.createElement("button");
      el.type = "button";
      drawMarker(el, station, station.id === selectedId);
      const id = station.id;
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelectRef.current(id);
      });
      markers.set(id, { marker: new Marker({ element: el }).setLngLat([station.lng, station.lat]).addTo(map), el, look });
    }
    for (const [id, { marker }] of markers) {
      if (seen.has(id)) continue;
      marker.remove();
      markers.delete(id);
    }
  }, [stations, selectedId]);

  // The map is removed with its markers; forget them too.
  useEffect(() => {
    const markers = markersRef.current;
    return () => markers.clear();
  }, []);

  // User position: blue dot with a slow, calm pulse (none with reduced motion).
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    userMarkerRef.current?.remove();
    userMarkerRef.current = null;
    if (!position) return;
    const el = document.createElement("div");
    Object.assign(el.style, { position: "relative", width: "16px", height: "16px" });
    const halo = document.createElement("span");
    Object.assign(halo.style, {
      position: "absolute",
      inset: "0",
      borderRadius: "9999px",
      background: "var(--gp-info)",
      opacity: "0.25",
    });
    const dot = document.createElement("span");
    Object.assign(dot.style, {
      position: "absolute",
      inset: "0",
      borderRadius: "9999px",
      background: "var(--gp-info)",
      border: "3px solid white",
      boxShadow: "0 0 0 6px rgba(47,128,237,.25)",
    });
    el.append(halo, dot);
    if (!reduced && typeof halo.animate === "function") {
      halo.animate(
        [
          { transform: "scale(1)", opacity: 0.35 },
          { transform: "scale(3)", opacity: 0 },
        ],
        { duration: 2400, iterations: Infinity, easing: "ease-out" },
      );
    }
    userMarkerRef.current = new Marker({ element: el }).setLngLat([position.lng, position.lat]).addTo(map);
  }, [position, reduced]);

  // Move to the selected station: a flight, or a jump with reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    const station = stations.find((s) => s.id === selectedId);
    if (!map || !station) return;
    const view = { center: [station.lng, station.lat] as [number, number], zoom: Math.max(map.getZoom(), 14) };
    if (reduced) map.jumpTo(view);
    else map.flyTo(view);
    // Only when the selection changes, not on every live update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  // Centre on the user once their position first arrives.
  const centredRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (map && position && !centredRef.current) {
      centredRef.current = true;
      const view = { center: [position.lng, position.lat] as [number, number], zoom: 13 };
      if (reduced) map.jumpTo(view);
      else map.flyTo(view);
    }
  }, [position, reduced]);

  return <div ref={containerRef} className="h-full w-full" />;
}
