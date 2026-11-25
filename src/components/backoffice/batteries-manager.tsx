"use client";

import { BatteryRegistry } from "@/components/batteries/battery-registry";
import { useI18n } from "@/components/i18n-provider";

/** Backoffice page of the battery register: every battery per brand, with its history. */
export function BatteriesManager() {
  const { t } = useI18n();
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t.batteries.title}</h1>
      <BatteryRegistry />
    </div>
  );
}
