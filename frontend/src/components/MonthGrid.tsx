import { useLayoutEffect, useRef, useState } from "react";
import type { DayInfo } from "../lib/calendarModel";
import { dayNumber, formatFullDate, monthGrid, WEEKDAYS, type YearMonth } from "../lib/dates";
import { fitRowHeight } from "../lib/layout";
import { BalanceValue, TodayLabel } from "./DayBadges";
import { EventChip } from "./EventChip";

const MAX_VISIBLE_EVENTS = 2;
const ROW_SPACING = 4; // matches border-spacing-1
const MIN_ROW_REM = 4;
const WIDE = 1024; // matches Tailwind's lg breakpoint

interface Props {
  month: YearMonth;
  days: Map<string, DayInfo>;
  selectedDate: string | null; // the date whose details the user last opened
  onOpenDay: (date: string) => void;
  reserveBelow: number;
}

/**
 * A real table, so screen readers announce weekday columns.
 * Each day in the month is ONE button containing its visible text, so keyboard
 * users can Tab to it and press Enter/Space to open the details.
 * On wide screens the rows stretch or shrink so the full month fits the window.
 */
export function MonthGrid({ month, days, selectedDate, onOpenDay, reserveBelow }: Props) {
  const weeks = monthGrid(month);
  const table = useRef<HTMLTableElement>(null);
  const [rowHeight, setRowHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const update = () => {
      const t = table.current;
      if (!t) return;
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next =
        window.innerWidth < WIDE
          ? null
          : fitRowHeight({
              viewport: window.innerHeight,
              tableTop: t.getBoundingClientRect().top + window.scrollY,
              head: t.tHead?.offsetHeight ?? 0,
              reserveBelow,
              weeks: weeks.length,
              spacing: ROW_SPACING,
              minRow: MIN_ROW_REM * rem,
            });
      setRowHeight((prev) => (prev === next ? prev : next));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  });

  return (
    <table ref={table} className="-mx-1 w-[calc(100%+0.5rem)] table-fixed border-separate border-spacing-1">
      <thead>
        <tr>
          {WEEKDAYS.map((w) => (
            <th key={w.short} scope="col" className="px-1.5 text-left text-xs font-semibold text-navy-soft">
              <abbr title={w.long} className="no-underline">
                {w.short}
              </abbr>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {weeks.map((week) => (
          <tr key={week[0].date}>
            {week.map(({ date, inMonth }) => {
              const day = inMonth ? days.get(date) : undefined;
              return (
                // A td's height acts as a minimum: bigger text makes the row taller instead of clipping it.
                <td key={date} className="h-[4.5rem] p-0 align-top" style={rowHeight ? { height: rowHeight } : undefined}>
                  {day ? (
                    <DayCell day={day} selected={day.date === selectedDate} onOpen={onOpenDay} />
                  ) : (
                    // Outside this month: a subdued number, never an invented balance.
                    <div className="h-full rounded-xl px-1.5 py-1 text-xs text-slate-400" aria-hidden={!inMonth}>
                      {dayNumber(date)}
                    </div>
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Today (the viewer's real date) is the one strongly marked cell: a periwinkle outline,
 * a tinted background and a "Today" pill. The day whose details were last opened gets a
 * quieter grey outline. Keyboard focus keeps the app-wide focus ring on top of both.
 */
function DayCell({ day, selected, onOpen }: { day: DayInfo; selected: boolean; onOpen: (date: string) => void }) {
  const hidden = day.events.length - MAX_VISIBLE_EVENTS;
  const background = day.isShortfall
    ? "bg-red-50"
    : day.isToday
      ? "bg-accent-soft"
      : day.status === "projected"
        ? "bg-surface-soft"
        : "bg-[#eef0fa]";
  return (
    <button
      type="button"
      onClick={() => onOpen(day.date)}
      aria-current={day.isToday ? "date" : undefined}
      className={[
        "@container flex h-full w-full flex-col gap-1 rounded-xl px-1.5 py-1 text-left",
        "motion-safe:transition-colors hover:bg-accent-soft",
        background,
        day.isToday
          ? "shadow-[inset_0_0_0_2px_var(--color-accent-bright)]"
          : selected
            ? "shadow-[inset_0_0_0_2px_var(--color-navy-soft)]"
            : "",
        // Striped = after the known schedule (pattern, not just colour).
        day.beyondSchedule
          ? "bg-[repeating-linear-gradient(135deg,transparent_0_6px,rgb(20_26_58/0.05)_6px_8px)]"
          : "",
      ].join(" ")}
    >
      <span className="sr-only">
        {formatFullDate(day.date)}
        {day.isToday ? ", today" : ""}
        {selected ? ", selected" : ""}, {day.status},{" "}
        {day.events.length === 0 ? "no scheduled activity" : `${day.events.length} events`}
        {day.beyondSchedule ? ", no bills or pay known for this day" : ""}.
      </span>
      {/* Date and end-of-day balance share the top line to save height; on today's cell the
          balance may wrap under the "Today" pill when the column is narrow, never overflow. */}
      <span className="flex flex-wrap items-baseline justify-between gap-x-1">
        <span aria-hidden="true" className="flex items-baseline gap-1 text-sm font-semibold text-navy">
          {dayNumber(day.date)}
          {day.isToday && <TodayLabel />}
        </span>
        <span className="ml-auto">
          <BalanceValue day={day} />
        </span>
      </span>
      <span className="flex min-h-0 flex-col gap-1">
        {day.events.slice(0, MAX_VISIBLE_EVENTS).map((e) => (
          <EventChip key={e.id} event={e} compact />
        ))}
        {hidden > 0 && <span className="text-xs font-semibold text-accent underline">+{hidden} more</span>}
      </span>
    </button>
  );
}
