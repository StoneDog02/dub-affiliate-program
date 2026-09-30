const TIME_ZONE = "America/Denver";

const WEEKDAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export type CalendarDate = {
  year: number;
  month: number;
  day: number;
};

export type WeekWindow = {
  startDate: string;
  endDate: string;
};

export type WeekPair = {
  current: WeekWindow;
  previous: WeekWindow;
  /** "Sep 21 – Sep 27" */
  label: string;
};

type ZonedNow = CalendarDate & {
  hour: number;
  weekDay: number;
};

export function denverNow(date: Date): ZonedNow {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);

  const value: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== "literal") value[part.type] = part.value;
  }

  let hour = Number(value.hour);
  if (hour === 24) hour = 0;

  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour,
    weekDay: WEEKDAYS[value.weekday] ?? 0,
  };
}

export function denverHour(date: Date): number {
  return denverNow(date).hour;
}

function addDays(date: CalendarDate, days: number): CalendarDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

function iso(date: CalendarDate): string {
  const month = String(date.month).padStart(2, "0");
  const day = String(date.day).padStart(2, "0");
  return `${date.year}-${month}-${day}`;
}

export function formatMonthDay(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${MONTHS[(month ?? 1) - 1]} ${day}`;
}

/**
 * The last Monday–Sunday that has fully ended in America/Denver,
 * plus the Monday–Sunday before it.
 * A Sunday still in progress belongs to the current, incomplete week.
 */
export function completedWeeks(now: Date): WeekPair {
  const today = denverNow(now);
  const daysSinceLastSunday = today.weekDay === 0 ? 7 : today.weekDay;
  const end = addDays(today, -daysSinceLastSunday);
  const start = addDays(end, -6);
  const previousEnd = addDays(end, -7);
  const previousStart = addDays(start, -7);
  const current = { startDate: iso(start), endDate: iso(end) };
  const previous = { startDate: iso(previousStart), endDate: iso(previousEnd) };

  return {
    current,
    previous,
    label: `${formatMonthDay(current.startDate)} – ${formatMonthDay(current.endDate)}`,
  };
}
