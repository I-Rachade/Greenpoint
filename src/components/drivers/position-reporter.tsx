"use client";

import { useEffect, useRef } from "react";
import { POSITION_REPORT_SECONDS } from "@shared/drivers";
import { usePosition } from "@/lib/use-position";
import { useApp } from "../app-provider";

/**
 * Driver phase 2 (planung/fahrer.md): while mounted, sends the driver's position to the
 * server at most every POSITION_REPORT_SECONDS, so the customer, the shop and the fleet
 * manager see where the driver is. Mounted only while the driver is on duty (in a queue,
 * on a trip or checked in at a shop). Renders nothing.
 */
export function PositionReporter() {
  const { backend } = useApp();
  const { position } = usePosition();
  const last = useRef(0);
  const latest = useRef(position);

  useEffect(() => {
    latest.current = position;
    if (!position || Date.now() - last.current < POSITION_REPORT_SECONDS * 1000)
      return;
    last.current = Date.now();
    backend.reportDriverPosition(position).catch(() => {
      // A lost report is fine: the next one follows.
    });
  }, [backend, position]);

  // Standing still gives no new fix: report the last one again so it does not look stale.
  useEffect(() => {
    const id = window.setInterval(() => {
      const p = latest.current;
      if (!p || Date.now() - last.current < POSITION_REPORT_SECONDS * 1000)
        return;
      last.current = Date.now();
      backend.reportDriverPosition(p).catch(() => {});
    }, POSITION_REPORT_SECONDS * 1000);
    return () => window.clearInterval(id);
  }, [backend]);

  return null;
}
