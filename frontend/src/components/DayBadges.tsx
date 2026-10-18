import type { DayInfo } from "../lib/calendarModel";
import { formatMoney } from "../lib/money";

/** Small text markers. "Demo day" is the day the demo treats as now; "Today" is your real date. */
export function DayMarkers({ day }: { day: Pick<DayInfo, "isReferenceDate" | "isToday"> }) {
  return (
    <>
      {day.isReferenceDate && <span className="text-[0.6875rem] font-semibold text-accent">Demo day</span>}
      {day.isToday && <span className="text-[0.6875rem] font-semibold text-navy-soft">Today</span>}
    </>
  );
}

/**
 * End-of-day checking balance. Symbols explained by the legend:
 * "≈" projected (after the demo day), "▼" lower because of the experiment, "⚠" below $0.
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
      {day.isShortfall && <span aria-hidden="true">⚠ </span>}
      {changed && <span aria-hidden="true">▼ </span>}
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
