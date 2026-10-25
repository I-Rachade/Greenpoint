// Opening hours as days and times (plan phase 8, Atlas finding: no free text, never empty).
// Stored in stations.opening_hours as one canonical line the Worker and the app both read:
//   "07:00-21:00"            every day
//   "Mo-Sa 07:00-21:00"      Monday to Saturday
//   "Mo,We,Fr 08:00-18:00"   some days
//   "Mo-Fr 08:00-19:00; Sa 08:00-15:00"   several times, joined by "; "
// Times are Lomé time (UTC). A closing time before the opening time runs past midnight;
// "00:00-24:00" is all day. Older free text keeps working as "open" (withinOpeningHours).

/** ISO weekdays: 1 = Monday … 7 = Sunday. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const WEEKDAYS: Weekday[] = [1, 2, 3, 4, 5, 6, 7];
const CODES = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"] as const;

export interface OpeningHours {
  /** Sorted, at least one. */
  days: Weekday[];
  /** "HH:MM" */
  open: string;
  /** "HH:MM", "24:00" for midnight at the end of the day. */
  close: string;
}

export const ALL_DAY: OpeningHours = { days: WEEKDAYS, open: "00:00", close: "24:00" };

const TIME = /^([01]?\d|2[0-4]):([0-5]\d)$/;

function cleanTime(raw: string, allow24: boolean): string | null {
  const m = TIME.exec(raw.trim());
  if (!m) return null;
  const h = Number(m[1]);
  if (h === 24 && (m[2] !== "00" || !allow24)) return null;
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}

function parseDays(spec: string): Weekday[] | null {
  const days = new Set<Weekday>();
  for (const part of spec.split(",")) {
    const [a, b] = part.split("-").map((x) => CODES.findIndex((c) => c.toLowerCase() === x.trim().toLowerCase()) + 1);
    if (!a || (part.includes("-") && !b)) return null;
    const end = b || a;
    // A range may wrap around the week ("Sa-Mo").
    for (let d = a, n = 0; n < 7; d = (d % 7) + 1, n++) {
      days.add(d as Weekday);
      if (d === end) break;
    }
  }
  return days.size ? [...days].sort() : null;
}

/** The hours in `text`, or null for free text (and empty text). "24h/24" reads as all day. */
export function parseOpeningHours(text: string | null | undefined): OpeningHours | null {
  const h = (text ?? "").trim();
  if (/^24\s*h(\s*\/\s*24)?$/i.test(h)) return ALL_DAY;
  const m = /^(?:([A-Za-z,\s-]+?)\s+)?(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/.exec(h);
  if (!m) return null;
  const days = m[1] ? parseDays(m[1].replace(/\s+/g, "")) : WEEKDAYS;
  const open = cleanTime(m[2], false);
  const close = cleanTime(m[3], true);
  if (!days || !open || !close) return null;
  return { days, open, close };
}

/** Day codes of a sorted day list, with runs as ranges ("Mo-Fr,Su"). */
function daySpec(days: Weekday[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < days.length) {
    let j = i;
    while (j + 1 < days.length && days[j + 1] === days[j] + 1) j++;
    out.push(j - i >= 2 ? `${CODES[days[i] - 1]}-${CODES[days[j] - 1]}` : days.slice(i, j + 1).map((d) => CODES[d - 1]).join(","));
    i = j + 1;
  }
  return out.join(",");
}

/** The canonical line stored in the database. */
export function formatOpeningHours(h: OpeningHours): string {
  const days = [...new Set(h.days)].sort() as Weekday[];
  const times = `${h.open}-${h.close}`;
  return days.length === 7 ? times : `${daySpec(days)} ${times}`;
}

/** Every part of `text` ("; " between them), or null when any part is free text (and for empty text). */
export function parseOpeningSchedule(text: string | null | undefined): OpeningHours[] | null {
  const parts = (text ?? "").split(";").map((p) => p.trim());
  const out: OpeningHours[] = [];
  for (const part of parts) {
    const h = parseOpeningHours(part);
    if (!h) return null;
    out.push(h);
  }
  return out;
}

/** The canonical line of several times. */
export function formatOpeningSchedule(schedule: OpeningHours[]): string {
  return schedule.map(formatOpeningHours).join("; ");
}

/** What a save sends, made canonical; null when it is not days and times (empty included). */
export function cleanOpeningHours(text: unknown): string | null {
  const schedule = parseOpeningSchedule(String(text ?? ""));
  return schedule && schedule.every((h) => h.days.length) ? formatOpeningSchedule(schedule) : null;
}

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** ISO weekday of a date in Lomé (UTC). */
export function weekdayOf(date: Date): Weekday {
  return (((date.getUTCDay() + 6) % 7) + 1) as Weekday;
}

/** Whether `now` is inside the hours; open-ended (any other text) counts as open. */
export function openAt(h: OpeningHours, now: Date): boolean {
  const open = minutes(h.open);
  const close = minutes(h.close);
  const t = now.getUTCHours() * 60 + now.getUTCMinutes();
  const today = weekdayOf(now);
  const yesterday = (((today + 5) % 7) + 1) as Weekday;
  if (open === close || (open === 0 && close === 24 * 60)) return h.days.includes(today);
  if (open < close) return h.days.includes(today) && t >= open && t < close;
  // Past midnight: the evening belongs to today, the night after midnight to yesterday.
  return (h.days.includes(today) && t >= open) || (h.days.includes(yesterday) && t < close);
}

/** What a station's day looks like on `now`'s date: open all day, closing at a time, or closed; null for free text. */
export type TodayHours = { kind: "allDay" } | { kind: "closes"; at: string } | { kind: "closed" };

export function todayHours(text: string | null | undefined, now: Date = new Date()): TodayHours | null {
  const schedule = parseOpeningSchedule(text);
  if (!schedule) return null;
  const today = schedule.filter((h) => h.days.includes(weekdayOf(now)));
  if (!today.length) return { kind: "closed" };
  if (today.some((h) => (h.open === "00:00" && h.close === "24:00") || h.open === h.close)) return { kind: "allDay" };
  // The latest closing of the day; a part running past midnight closes after every other one.
  const close = (h: OpeningHours) => (h.close <= h.open ? minutes(h.close) + 24 * 60 : minutes(h.close));
  const last = today.reduce((a, b) => (close(b) > close(a) ? b : a));
  return { kind: "closes", at: last.close === "24:00" ? "00:00" : last.close };
}
