"use client";

import { useReportWebVitals } from "next/web-vitals";
import { Capacitor } from "@capacitor/core";
import { VITAL_NAMES, type VitalName, type VitalsReport } from "@shared/vitals";

/**
 * Measures how fast the app really is on people's phones (Core Web Vitals) and sends it once,
 * when the page is left or put in the background, to POST /api/vitals (worker/vitals.ts).
 * Only with the real server; nothing about the person is sent.
 */
const measured: Partial<Record<VitalName, number>> = {};
let page: string | null = null;
let sent = false;

function send() {
  if (sent || !page || !Object.keys(measured).length) return;
  sent = true;
  const nav = navigator as Navigator & { connection?: { effectiveType?: string }; deviceMemory?: number };
  const platform = Capacitor.getPlatform();
  const report: VitalsReport = {
    page,
    platform: platform === "android" || platform === "ios" ? platform : "web",
    net: nav.connection?.effectiveType ?? null,
    memory: nav.deviceMemory ?? null,
    version: process.env.NEXT_PUBLIC_APP_VERSION ?? null,
    metrics: measured,
  };
  const url = `${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/vitals`;
  // text/plain: no CORS preflight from the app; sendBeacon still goes out while the page closes.
  const body = new Blob([JSON.stringify(report)], { type: "text/plain" });
  try {
    if (!navigator.sendBeacon?.(url, body)) void fetch(url, { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // measuring must never disturb the app
  }
}

function record(metric: { name: string; value: number }) {
  if (!(VITAL_NAMES as readonly string[]).includes(metric.name)) return;
  if (!page) {
    page = window.location.pathname;
    const onHide = () => document.visibilityState === "hidden" && send();
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", send);
  }
  measured[metric.name as VitalName] = metric.value;
}

/** The same function on every render, as useReportWebVitals asks. */
const report = process.env.NEXT_PUBLIC_BACKEND === "cloudflare" ? record : () => {};

export function WebVitals() {
  useReportWebVitals(report);
  return null;
}
