import type { CalendarResponse } from "../api";
import { formatShortDate } from "../lib/dates";
import { formatMoney } from "../lib/money";

/** Optional, collapsed by default so it never competes with the experiment. */
export function MonthTotals({ calendar, label }: { calendar: CalendarResponse; label: string }) {
  const s = calendar.summary;
  return (
    <details className="mt-3 rounded-2xl bg-surface-soft px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">Month totals ({label})</summary>
      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-navy-soft">Spent so far (past)</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(s.spent_so_far)}</dd>
        </div>
        <div>
          <dt className="text-xs text-navy-soft">Income so far (past)</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(s.income_so_far)}</dd>
        </div>
        <div>
          <dt className="text-xs text-navy-soft">Expected spending (estimate)</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(s.projected_spending)}</dd>
        </div>
        <div>
          <dt className="text-xs text-navy-soft">Expected income (estimate)</dt>
          <dd className="font-semibold tabular-nums">{formatMoney(s.projected_income)}</dd>
        </div>
      </dl>
      <p className="mt-2 text-xs text-navy-soft">
        Lowest checking this month: {formatMoney(calendar.lowest_checking.balance)} on{" "}
        {formatShortDate(calendar.lowest_checking.date)}.{" "}
        {calendar.shortfall_dates.length === 0
          ? "No days below $0.00."
          : `⚠ Below $0.00 on ${calendar.shortfall_dates.map(formatShortDate).join(", ")}.`}
      </p>
    </details>
  );
}
