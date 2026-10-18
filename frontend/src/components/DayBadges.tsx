import type { DayInfo } from "../lib/calendarModel";
import { formatMoney } from "../lib/money";

/** "Today" is the viewer's real date (their own clock), shown as a small periwinkle pill. */
export function TodayLabel() {
  return (
    <span className="rounded-full bg-accent px-1.5 py-px text-[0.625rem] font-bold tracking-wide text-white uppercase">Today</span>
  );
}

/**
 * End-of-day checking balance. "≈" marks a projected day; a balance below $0 is a red
 * negative number; a balance changed by the preview is pink (the details say by how much).
 */
export function BalanceValue({ day }: { day: DayInfo }) {
  if (day.closingChecking === null) return null;
  const changed = day.originalChecking !== null;
  return (
    <span
      className={`block text-right text-xs font-semibold whitespace-nowrap tabular-nums ${
        day.isShortfall ? "text-red-700" : changed ? "text-lilac" : "text-navy"
      }`}
    >
      {day.status === "projected" && <span aria-hidden="true">≈</span>}
      {formatMoney(day.closingChecking)}
      <span className="sr-only">
        {" "}
        {day.status === "projected" ? "projected " : ""}checking at end of day
        {day.isShortfall ? ", below zero" : ""}
        {changed ? `, was ${formatMoney(day.originalChecking!)} without the test run` : ""}
      </span>
    </span>
  );
}
