"use client";

import { useId } from "react";
import { ALL_DAY, formatOpeningSchedule, parseOpeningSchedule, WEEKDAYS, type OpeningHours, type Weekday } from "@shared/opening-hours";
import { useI18n } from "./i18n-provider";

const DEFAULT_HOURS: OpeningHours = { days: WEEKDAYS, open: "07:00", close: "21:00" };

/** The hours a stored line holds; older free text and empty lines start from 07:00–21:00 every day. */
export function hoursOf(text: string | null | undefined): OpeningHours[] {
  return parseOpeningSchedule(text) ?? [DEFAULT_HOURS];
}

/**
 * Opening hours as one or more rows of day toggles and two times (plan phase 8): never free text,
 * never empty. A second row gives some days other times ("Mo-Fr 08:00-19:00; Sa 08:00-15:00").
 */
export function OpeningHoursInput({ value, onChange, disabled = false }: { value: OpeningHours[]; onChange: (hours: OpeningHours[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const h = t.hoursInput;
  const set = (i: number, hours: OpeningHours) => onChange(value.map((v, j) => (j === i ? hours : v)));
  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">{h.legend}</legend>
      {value.map((hours, i) => (
        <div key={i} className={value.length > 1 ? "space-y-2 rounded-xl border border-gp-border p-3" : undefined}>
          <HoursRow value={hours} onChange={(next) => set(i, next)} />
          {value.length > 1 && (
            <button type="button" className="min-h-11 text-sm font-semibold text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))}>
              {h.remove}
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="min-h-11 text-sm font-semibold text-gp-green-dark dark:text-gp-green"
        onClick={() => onChange([...value, { days: [], open: DEFAULT_HOURS.open, close: DEFAULT_HOURS.close }])}
      >
        {h.add}
      </button>
    </fieldset>
  );
}

/** One row: day toggles and two times. */
function HoursRow({ value, onChange }: { value: OpeningHours; onChange: (hours: OpeningHours) => void }) {
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
    <div className="space-y-2">
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
    </div>
  );
}

/** The line to save: canonical, or "" while a row has no day (refused by the server). */
export function openingHoursLine(hours: OpeningHours[]): string {
  return hours.length && hours.every((x) => x.days.length) ? formatOpeningSchedule(hours) : "";
}
