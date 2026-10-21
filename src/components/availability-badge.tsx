"use client";

import type { Availability } from "@/lib/availability";
import { useI18n } from "./i18n-provider";

// Status colours from the design rules (tokens in globals.css): green available, orange low,
// red closed. Light grey: nobody has reported for a while, so the numbers may be out of date.
// CSS variables, so they also work in inline styles such as the map markers.
export const AVAILABILITY_COLORS: Record<Availability, string> = {
  available: "var(--gp-green)",
  limited: "var(--gp-low)",
  full: "var(--gp-full)",
  closed: "var(--gp-closed)",
  unknown: "var(--gp-unknown)",
};

/** Text colour with enough contrast on each status colour. */
const TEXT_COLORS: Record<Availability, string> = {
  available: "var(--gp-forest)",
  limited: "var(--gp-forest)",
  full: "#FFFFFF",
  closed: "#FFFFFF",
  unknown: "#27272A",
};

export function AvailabilityBadge({ value }: { value: Availability }) {
  const { t } = useI18n();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
      style={{ backgroundColor: AVAILABILITY_COLORS[value], color: TEXT_COLORS[value] }}
    >
      {t.availability[value]}
    </span>
  );
}
