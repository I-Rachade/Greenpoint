"use client";

import { SunIcon } from "./icons";
import { useI18n } from "./i18n-provider";

/**
 * Marks a station that charges with solar power: only there do swaps and charges
 * earn greenpoints. `compact` shows just the sun, for tight rows.
 */
export function SolarBadge({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <span
      title={t.station.solarHint}
      aria-label={compact ? t.station.solar : undefined}
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-400/20 dark:text-amber-300"
    >
      <SunIcon size={13} />
      {!compact && t.station.solar}
    </span>
  );
}
