"use client";

import { useId } from "react";
import { ALL_DAY, formatOpeningHours, parseOpeningHours, WEEKDAYS, type OpeningHours, type Weekday } from "@/lib/opening-hours";
import { useI18n } from "./i18n-provider";

const DEFAULT_HOURS: OpeningHours = { days: WEEKDAYS, open: "07:00", close: "21:00" };

/** The hours a stored line holds; older free text and empty lines start from 07:00–21:00 every day. */
export function hoursOf(text: string | null | undefined): OpeningHours {
  return parseOpeningHours(text) ?? DEFAULT_HOURS;
}

/**
 * Opening hours as day toggles and two times (plan phase 8): never free text, never empty.
 * `onChange` gets the canonical line (src/lib/opening-hours.ts), or "" while no day is chosen,
 * which the server refuses (opening_hours_invalid).
 */
export function OpeningHoursInput({ value, onChange, disabled = false }: { value: OpeningHours; onChange: (hours: OpeningHours) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const h = t.hoursInput;
  const allDay = value.open === "00:00" && value.close === "24:00";
  const overnight = !allDay && value.close < value.open;

  const toggle = (day: Weekday) => {
    const days = value.days.includes(day) ? value.days.filter((d) => d !== day) : [...value.days, day].sort((a, b) => a - b);
    onChange({ ...value, days });
  };

  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">{h.legend}</legend>
      <div role="group" aria-label={h.days} className="flex flex-wrap gap-1.5">
        {WEEKDAYS.map((d) => {
          const on = value.days.includes(d);
          return (
            <button
              key={d}
              type="button"
              aria-pressed={on}
              aria-label={t.stationLook.weekdaysLong[d - 1]}
              onClick={() => toggle(d)}
              className={`min-h-11 min-w-11 rounded-full border px-2 text-sm font-semibold transition-colors duration-160 ${
                on ? "border-gp-green-dark bg-gp-green-dark text-white" : "border-gp-border bg-gp-surface text-zinc-600 dark:text-zinc-300"
              }`}
            >
              {t.stationLook.weekdays[d - 1]}
            </button>
          );
        })}
      </div>
      {value.days.length === 0 && (
        <p role="alert" className="text-sm text-red-600">
          {h.noDay}
        </p>
      )}
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          className="h-5 w-5 accent-gp-green-dark"
          checked={allDay}
          onChange={(e) => onChange(e.target.checked ? { ...value, open: ALL_DAY.open, close: ALL_DAY.close } : { ...value, open: DEFAULT_HOURS.open, close: DEFAULT_HOURS.close })}
        />
        {h.allDay}
      </label>
      {!allDay && (
        <div className="flex flex-wrap gap-3">
          <label htmlFor={`${id}-open`} className="space-y-1 text-sm">
            <span className="block">{h.open}</span>
            <input
              id={`${id}-open`}
              type="time"
              required
              className="min-h-11 rounded-xl border border-gp-border bg-gp-surface px-3 text-base"
              value={value.open}
              onChange={(e) => e.target.value && onChange({ ...value, open: e.target.value })}
            />
          </label>
          <label htmlFor={`${id}-close`} className="space-y-1 text-sm">
            <span className="block">{h.close}</span>
            <input
              id={`${id}-close`}
              type="time"
              required
              className="min-h-11 rounded-xl border border-gp-border bg-gp-surface px-3 text-base"
              value={value.close === "24:00" ? "00:00" : value.close}
              onChange={(e) => e.target.value && onChange({ ...value, close: e.target.value })}
            />
          </label>
        </div>
      )}
      {overnight && <p className="text-xs text-zinc-500">{h.overnight}</p>}
    </fieldset>
  );
}

/** The line to save: canonical, or "" without a day (refused by the server). */
export function openingHoursLine(hours: OpeningHours): string {
  return hours.days.length ? formatOpeningHours(hours) : "";
}
