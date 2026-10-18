// Dates in this app are plain calendar days ("2026-10-17"), not moments in time.
// `new Date("2026-10-17")` means midnight UTC, which is still Oct 16 in New York,
// so a naive approach shows the wrong day. We keep dates as strings, and when we
// need weekday or month names we do all maths and formatting in UTC.

export interface YearMonth {
  year: number;
  month: number; // 1-12
}

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isISODate(value: unknown): value is string {
  return typeof value === "string" && ISO.test(value);
}

export function parseISO(iso: string): { year: number; month: number; day: number } {
  const m = ISO.exec(iso);
  if (!m) throw new Error(`Not a YYYY-MM-DD date: ${iso}`);
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

export function toISO(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function utc(iso: string): Date {
  const { year, month, day } = parseISO(iso);
  return new Date(Date.UTC(year, month - 1, day));
}

export function monthOf(iso: string): YearMonth {
  const { year, month } = parseISO(iso);
  return { year, month };
}

export function sameMonth(a: YearMonth, b: YearMonth): boolean {
  return a.year === b.year && a.month === b.month;
}

export function addMonths({ year, month }: YearMonth, delta: number): YearMonth {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function daysInMonth({ year, month }: YearMonth): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function firstDay(ym: YearMonth): string {
  return toISO(ym.year, ym.month, 1);
}

export function lastDay(ym: YearMonth): string {
  return toISO(ym.year, ym.month, daysInMonth(ym));
}

export function monthKey(ym: YearMonth): string {
  return toISO(ym.year, ym.month, 1).slice(0, 7);
}

/** Every date of the month, in order. */
export function datesInMonth(ym: YearMonth): string[] {
  return Array.from({ length: daysInMonth(ym) }, (_, i) => toISO(ym.year, ym.month, i + 1));
}

export function addDays(iso: string, delta: number): string {
  const d = utc(iso);
  d.setUTCDate(d.getUTCDate() + delta);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Sunday-first weeks covering the month. Cells outside the month are flagged. */
export function monthGrid(ym: YearMonth): { date: string; inMonth: boolean }[][] {
  const start = addDays(firstDay(ym), -utc(firstDay(ym)).getUTCDay());
  const weeks: { date: string; inMonth: boolean }[][] = [];
  let cursor = start;
  do {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: cursor, inMonth: monthKey(monthOf(cursor)) === monthKey(ym) });
      cursor = addDays(cursor, 1);
    }
    weeks.push(week);
  } while (monthKey(monthOf(cursor)) === monthKey(ym));
  return weeks;
}

function format(iso: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(utc(iso));
}

export const formatFullDate = (iso: string) =>
  format(iso, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
export const formatShortDate = (iso: string) => format(iso, { month: "short", day: "numeric", year: "numeric" });
export const formatWeekdayShort = (iso: string) => format(iso, { weekday: "short" });
export const formatMonthTitle = (ym: YearMonth) => format(firstDay(ym), { month: "long", year: "numeric" });
export const dayNumber = (iso: string) => parseISO(iso).day;

/** The viewer's real calendar date, from their own computer clock. */
export function todayISO(now: Date = new Date()): string {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

export const WEEKDAYS = [
  { short: "Sun", long: "Sunday" },
  { short: "Mon", long: "Monday" },
  { short: "Tue", long: "Tuesday" },
  { short: "Wed", long: "Wednesday" },
  { short: "Thu", long: "Thursday" },
  { short: "Fri", long: "Friday" },
  { short: "Sat", long: "Saturday" },
];
