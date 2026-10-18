// Reorganises the backend's lists into "everything about one day".
// It does NOT calculate new balances: closing balances come straight from
// daily_balances; a day's beginning balance is simply the previous day's
// closing balance (or opening_balances for the first returned day).
import type { CalendarEvent, CalendarResponse } from "../api";
import { addDays } from "./dates";

/** What the calendar is previewing on top of the original numbers, if anything. */
export type PreviewKind = "purchase" | "invest" | null;

export interface DayInfo {
  date: string;
  events: CalendarEvent[];
  status: "past" | "projected"; // relative to the demo reference date
  isReferenceDate: boolean;
  isToday: boolean; // the viewer's real date
  closingChecking: string | null; // null = backend returned no balance for this day
  beginningChecking: string | null;
  savings: string | null;
  isShortfall: boolean;
  // Only when comparing with an original calendar: its closing balance, if different.
  originalChecking: string | null;
  // After the last date with known bills/pay: the balance is NOT a complete budget.
  beyondSchedule: boolean;
}

/** `original` (optional) is the calendar without the experiment, used only to spot changed days. */
export function buildDays(cal: CalendarResponse, today: string, original?: CalendarResponse): Map<string, DayInfo> {
  const originalByDay = new Map(original?.daily_balances.map((b) => [b.date, b.checking]));
  const eventsByDay = new Map<string, CalendarEvent[]>();
  for (const e of cal.events) {
    const list = eventsByDay.get(e.date) ?? [];
    list.push(e);
    eventsByDay.set(e.date, list);
  }
  const balanceByDay = new Map(cal.daily_balances.map((b) => [b.date, b]));
  const shortfalls = new Set(cal.shortfall_dates);

  const days = new Map<string, DayInfo>();
  for (const b of cal.daily_balances) {
    const previous = balanceByDay.get(addDays(b.date, -1));
    days.set(b.date, {
      date: b.date,
      events: eventsByDay.get(b.date) ?? [],
      // ISO dates compare correctly as strings: "2026-10-09" < "2026-10-17".
      status: b.date <= cal.demo_reference_date ? "past" : "projected",
      isReferenceDate: b.date === cal.demo_reference_date,
      isToday: b.date === today,
      closingChecking: b.checking,
      beginningChecking: b.date === cal.start_date ? cal.opening_balances.checking : (previous?.checking ?? null),
      savings: b.savings,
      isShortfall: shortfalls.has(b.date),
      // Plain string comparison: we only ask "is it different?", no arithmetic.
      originalChecking:
        originalByDay.has(b.date) && originalByDay.get(b.date) !== b.checking ? originalByDay.get(b.date)! : null,
      beyondSchedule: b.date > cal.scheduled_through,
    });
  }
  return days;
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "demo_history":
      return "App demo history (made-up past activity, not from Nessie)";
    case "demo_assumption":
      return "App estimate (made-up expected event, not from Nessie)";
    case "experiment":
      return "Your experiment (a preview only; no money moves)";
    default:
      return source;
  }
}

export function certaintyLabel(certainty: string): string {
  switch (certainty) {
    case "historical":
      return "Treated as already happened";
    case "estimated":
      return "Estimate, may change";
    case "hypothetical":
      return "Hypothetical";
    default:
      return certainty;
  }
}
