"use client";

import type { Availability } from "@/lib/availability";
import { useI18n } from "./i18n-provider";

// Status colours from the design rules: green available, orange low, red closed.
export const AVAILABILITY_COLORS: Record<Availability, string> = {
  available: "#1DB954",
  limited: "#F59E0B",
  full: "#5B6B63",
  closed: "#D93B3B",
};

/** Text colour with enough contrast on each status colour. */
const TEXT_COLORS: Record<Availability, string> = {
  available: "#0B3B2E",
  limited: "#0B3B2E",
  full: "#FFFFFF",
  closed: "#FFFFFF",
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
