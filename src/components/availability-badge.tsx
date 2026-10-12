"use client";

import type { Availability } from "@/lib/availability";
import { useI18n } from "./i18n-provider";

export const AVAILABILITY_COLORS: Record<Availability, string> = {
  available: "#16a34a",
  limited: "#d97706",
  full: "#dc2626",
  closed: "#71717a",
};

export function AvailabilityBadge({ value }: { value: Availability }) {
  const { t } = useI18n();
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium text-white"
      style={{ backgroundColor: AVAILABILITY_COLORS[value] }}
    >
      {t.availability[value]}
    </span>
  );
}
