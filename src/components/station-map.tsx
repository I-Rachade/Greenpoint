"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, NavigationControl, Popup } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { stationAvailability } from "@shared/availability";
import { LOME_CENTER, type LatLng } from "@shared/geo";
import { format } from "@/lib/i18n/format";
import type { RepairCenter } from "@shared/repair-centers";
import type { ShareStation } from "@shared/share";
import { isUnattended } from "@shared/station-extras";
import type { StationView } from "@shared/types";
import { AVAILABILITY_COLORS } from "./availability-badge";
import { useI18n } from "./i18n-provider";
import { useReducedMotion } from "./ui";

// Free vector tiles from OpenStreetMap data, no API key, commercial use allowed.
export const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface Props {
  stations: StationView[];
  /** Repair workshops away from stations: a wrench marker with a small card, no selection. */
  workshops?: RepairCenter[];
  /** Share stations: a pill with the number of vehicles parked there, a tap opens the Share tab. */
  share?: ShareStation[];
  position: LatLng | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  /** A small label above some markers, e.g. their distance (full-screen map, mockup A2). */
  labels?: Record<string, string>;
  /** Zoom buttons; off where other controls sit in that corner. */
  controls?: boolean;
  /** Draw a line from the user to the selected station and keep both in view. */
  route?: boolean;
  /** Room kept free over the map's edges (px) when fitting the route, e.g. under the cards. */
  padding?: { top: number; bottom: number; left: number; right: number };
  /** Other people on the map, e.g. customers on their way (staff screen B2): a small blue dot with a label. */
  others?: { id: string; lat: number; lng: number; label?: string }[];
}

const ROUTE_SOURCE = "gp-route";

/** What a marker looks like; when this is unchanged after a live update, the marker is left alone. */
function markerLook(station: StationView, selected: boolean, label?: string): string {
  return [
    label ?? "",
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
function drawMarker(el: HTMLButtonElement, station: StationView, selected: boolean, label?: string) {
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
    el.style.position = label ? "relative" : "";
  }
  // Distance pill above the marker; dark on the selected station.
  if (label) {
    const pill = document.createElement("span");
    pill.textContent = label;
    Object.assign(pill.style, {
      position: "absolute",
      bottom: "calc(100% + 6px)",
      left: "50%",
      transform: "translateX(-50%)",
      padding: "2px 7px",
      borderRadius: "8px",
      background: selected ? "var(--gp-forest)" : "white",
      color: selected ? "white" : "var(--gp-forest)",
      fontSize: "11px",
      fontWeight: "700",
      lineHeight: "16px",
      whiteSpace: "nowrap",
      boxShadow: "0 1px 4px rgba(0,0,0,.25)",
      pointerEvents: "none",
    });
    el.appendChild(pill);
  }
}

/** The small card of a workshop marker, built from text nodes (names come from the backoffice). */
function workshopCard(w: RepairCenter, labels: { title: string; call: string }): HTMLElement {
  const box = document.createElement("div");
  Object.assign(box.style, { fontSize: "13px", lineHeight: "1.35", color: "#14281d", maxWidth: "220px" });
  const name = document.createElement("strong");
  name.textContent = w.name;
  const kind = document.createElement("div");
  kind.textContent = labels.title;
  kind.style.color = "#5b6b62";
  box.append(name, kind);
  if (w.address) {
    const address = document.createElement("div");
    address.textContent = w.address;
    box.append(address);
  }
  if (w.phone) {
    const call = document.createElement("a");
    call.href = `tel:${w.phone.replace(/[^\d+]/g, "")}`;
    call.textContent = `${labels.call} ${w.phone}`;
    Object.assign(call.style, { display: "inline-block", marginTop: "4px", fontWeight: "600", color: "#1f7a45" });
    box.append(call);
  }
  return box;
}

export function StationMap({ stations, workshops = [], share = [], position, selectedId, onSelect, labels, route = false, padding, controls = true, others }: Props) {
  const { t } = useI18n();
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
    if (controls) map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // The controls are set once, with the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Station markers, keyed by station: a live update only touches the markers that changed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = markersRef.current;
    const seen = new Set<string>();
    for (const station of stations) {
      seen.add(station.id);
      const label = labels?.[station.id];
      const look = markerLook(station, station.id === selectedId, label);
      const current = markers.get(station.id);
      if (current) {
        const at = current.marker.getLngLat();
        if (at.lng !== station.lng || at.lat !== station.lat) current.marker.setLngLat([station.lng, station.lat]);
        if (current.look !== look) {
          drawMarker(current.el, station, station.id === selectedId, label);
          current.look = look;
        }
        continue;
      }
      const el = document.createElement("button");
      el.type = "button";
      drawMarker(el, station, station.id === selectedId, label);
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
  }, [stations, selectedId, labels]);

  // The way to the selected station: a straight dashed line (no route is fetched), kept in view with the user.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !route) return;
    const station = stations.find((s) => s.id === selectedId);
    const coordinates = position && station ? [[position.lng, position.lat], [station.lng, station.lat]] : [];
    const data = { type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates } };
    const draw = () => {
      const source = map.getSource(ROUTE_SOURCE) as { setData?: (d: unknown) => void } | undefined;
      if (source?.setData) return source.setData(data);
      map.addSource(ROUTE_SOURCE, { type: "geojson", data });
      map.addLayer({
        id: ROUTE_SOURCE,
        type: "line",
        source: ROUTE_SOURCE,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#12823B", "line-width": 4, "line-dasharray": [1.5, 1.5] },
      });
    };
    if (map.isStyleLoaded()) draw();
    else map.once("load", draw);
    return () => {
      map.off("load", draw);
    };
  }, [route, position, selectedId, stations]);

  // Workshop markers: grey with a wrench, below the stations; a tap opens their card.
  const workshopMarkersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of workshopMarkersRef.current) m.remove();
    workshopMarkersRef.current = workshops.map((w) => {
      const el = document.createElement("button");
      el.type = "button";
      el.setAttribute("aria-label", `${w.name}, ${t.stationLook.workshop}`);
      Object.assign(el.style, {
        width: "24px",
        height: "24px",
        borderRadius: "9999px",
        border: "2px solid white",
        boxShadow: "0 1px 4px rgba(0,0,0,.4)",
        background: "#475569",
        fontSize: "12px",
        lineHeight: "1",
        cursor: "pointer",
      });
      el.textContent = "🔧";
      const title = w.operatorName ? format(t.stationLook.workshopOf, { brand: w.operatorName }) : t.stationLook.workshop;
      const popup = new Popup({ offset: 14, closeButton: true }).setDOMContent(workshopCard(w, { title, call: t.stationLook.call }));
      return new Marker({ element: el }).setLngLat([w.lng, w.lat]).setPopup(popup).addTo(map);
    });
    return () => {
      for (const m of workshopMarkersRef.current) m.remove();
      workshopMarkersRef.current = [];
    };
  }, [workshops, t]);

  // Share vehicles: a pill above the station's marker with the count of vehicles parked there.
  const shareMarkersRef = useRef<Marker[]>([]);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const m of shareMarkersRef.current) m.remove();
    shareMarkersRef.current = share.map((st) => {
      const el = document.createElement("a");
      el.href = `/share#share-${encodeURIComponent(st.stationId)}`;
      el.setAttribute("aria-label", `${st.name}, ${format(t.share.stationLine, { n: st.vehicles.length, radius: st.radiusM })}`);
      Object.assign(el.style, {
        display: "block",
        padding: "1px 6px",
        borderRadius: "9999px",
        border: "2px solid white",
        boxShadow: "0 1px 4px rgba(0,0,0,.4)",
        background: st.vehicles.length ? "var(--gp-forest)" : "#64748b",
        color: "white",
        fontSize: "11px",
        fontWeight: "600",
        lineHeight: "16px",
        whiteSpace: "nowrap",
      });
      el.textContent = `🛵 ${st.vehicles.length}`;
      return new Marker({ element: el, anchor: "bottom", offset: [0, -16] }).setLngLat([st.lng, st.lat]).addTo(map);
    });
    return () => {
      for (const m of shareMarkersRef.current) m.remove();
      shareMarkersRef.current = [];
    };
  }, [share, t]);

  // Other people (customers on their way): a blue dot with a small label, all kept in view with the selected station once.
  const otherMarkersRef = useRef(new Map<string, Marker>());
  const othersFittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = otherMarkersRef.current;
    const seen = new Set<string>();
    for (const o of others ?? []) {
      seen.add(o.id);
      const current = markers.get(o.id);
      if (current) {
        current.setLngLat([o.lng, o.lat]);
        const pill = current.getElement().querySelector("span[data-label]");
        if (pill) pill.textContent = o.label ?? "";
        continue;
      }
      // The marker element itself is placed by MapLibre (absolute); the dot inside carries the label.
      const el = document.createElement("div");
      const dot = document.createElement("div");
      Object.assign(dot.style, { position: "relative", width: "14px", height: "14px", borderRadius: "9999px", background: "var(--gp-info)", border: "3px solid white", boxShadow: "0 1px 4px rgba(0,0,0,.35)" });
      el.append(dot);
      if (o.label !== undefined) {
        const pill = document.createElement("span");
        pill.dataset.label = "";
        Object.assign(pill.style, {
          position: "absolute",
          bottom: "16px",
          left: "50%",
          transform: "translateX(-50%)",
          padding: "1px 6px",
          borderRadius: "9999px",
          background: "white",
          color: "#0B3B2E",
          fontSize: "11px",
          fontWeight: "700",
          lineHeight: "16px",
          whiteSpace: "nowrap",
          boxShadow: "0 1px 3px rgba(0,0,0,.3)",
        });
        pill.textContent = o.label;
        dot.append(pill);
      }
      markers.set(o.id, new Marker({ element: el }).setLngLat([o.lng, o.lat]).addTo(map));
    }
    for (const [id, marker] of markers) {
      if (seen.has(id)) continue;
      marker.remove();
      markers.delete(id);
    }
    const station = stations.find((st) => st.id === selectedId);
    if (!othersFittedRef.current && station && (others ?? []).length > 0) {
      othersFittedRef.current = true;
      const lngs = [station.lng, ...others!.map((o) => o.lng)];
      const lats = [station.lat, ...others!.map((o) => o.lat)];
      map.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: padding ?? 40, maxZoom: 16, duration: 0 },
      );
    }
  }, [others, stations, selectedId, padding]);

  // The map is removed with its markers; forget them too (and fit again on the next map).
  useEffect(() => {
    const markers = markersRef.current;
    const otherMarkers = otherMarkersRef.current;
    return () => {
      markers.clear();
      otherMarkers.clear();
      othersFittedRef.current = false;
      routeFittedRef.current = false;
    };
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

  // With a route, keep the user and the station in view once the user's position first arrives.
  const routeFittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    const station = stations.find((s) => s.id === selectedId);
    if (!map || !station || !route || !position || routeFittedRef.current) return;
    routeFittedRef.current = true;
    map.fitBounds(
      [
        [Math.min(position.lng, station.lng), Math.min(position.lat, station.lat)],
        [Math.max(position.lng, station.lng), Math.max(position.lat, station.lat)],
      ],
      { padding: padding ?? 60, maxZoom: 16, duration: 0 },
    );
  }, [route, position, selectedId, stations, padding]);

  // Move to the selected station: a flight, or a jump with reduced motion.
  useEffect(() => {
    const map = mapRef.current;
    const station = stations.find((s) => s.id === selectedId);
    if (!map || !station) return;
    if (route && position) {
      const bounds: [[number, number], [number, number]] = [
        [Math.min(position.lng, station.lng), Math.min(position.lat, station.lat)],
        [Math.max(position.lng, station.lng), Math.max(position.lat, station.lat)],
      ];
      map.fitBounds(bounds, { padding: padding ?? 60, maxZoom: 16, duration: reduced ? 0 : 800 });
      return;
    }
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
    // With a route the map keeps the user and the station in view instead (above).
    if (map && position && !centredRef.current && !route) {
      centredRef.current = true;
      const view = { center: [position.lng, position.lat] as [number, number], zoom: 13 };
      if (reduced) map.jumpTo(view);
      else map.flyTo(view);
    }
  }, [position, reduced, route]);

  return <div ref={containerRef} className="h-full w-full" />;
}
