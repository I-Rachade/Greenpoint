"use client";

import "maplibre-gl/dist/maplibre-gl.css";
import { Map as MapLibreMap, Marker, NavigationControl } from "maplibre-gl";
import { useEffect, useRef } from "react";
import { LOME_CENTER, type LatLng } from "@shared/geo";
import { MAP_STYLE } from "../station-map";

/** A small map: tapping it (or dragging the pin) sets the customer's home. */
export function HomePicker({ value, onChange, flyTo }: { value: LatLng | null; onChange: (p: LatLng) => void; flyTo: number }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

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
    map.on("click", (e) => onChangeRef.current({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!value) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new Marker({ color: "#1f7a3a", draggable: true }).setLngLat([value.lng, value.lat]).addTo(map);
      markerRef.current.on("dragend", () => {
        const p = markerRef.current!.getLngLat();
        onChangeRef.current({ lat: p.lat, lng: p.lng });
      });
    } else {
      markerRef.current.setLngLat([value.lng, value.lat]);
    }
  }, [value]);

  // "My position" was pressed: centre on the pin.
  useEffect(() => {
    const map = mapRef.current;
    if (map && value && flyTo > 0) map.flyTo({ center: [value.lng, value.lat], zoom: 16 });
    // Only when asked, not on every tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyTo]);

  return <div ref={containerRef} className="h-64 w-full overflow-hidden rounded-lg" />;
}
