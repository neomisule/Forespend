import type { DayInfo } from "../lib/calendarModel";
import { formatFullDate } from "../lib/dates";
import { formatMoney } from "../lib/money";
import { DayMarkers } from "./DayBadges";
import { EventChip } from "./EventChip";

interface Props {
  dates: string[];
  days: Map<string, DayInfo>;
  onOpenDay: (date: string) => void;
}

/** Same data as the grid, one row per date, in order. Words instead of symbols. */
export function ListView({ dates, days, onOpenDay }: Props) {
  return (
    <ol className="divide-y divide-sky-page overflow-hidden rounded-2xl bg-surface-soft">
      {dates.map((date) => {
        const day = days.get(date);
        if (!day) return null;
        return (
          <li
            key={date}
            className={`flex flex-wrap items-start gap-x-4 gap-y-1.5 px-3 py-2.5 ${day.isShortfall ? "bg-red-50" : ""}`}
          >
            <div className="w-full sm:w-52 sm:shrink-0">
              <h3 className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-navy">
                {formatFullDate(date)}
                <DayMarkers day={day} />
              </h3>
              <p className="text-xs text-navy-soft">{day.status === "past" ? "Past" : "Projected"}</p>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              {day.events.length === 0 ? (
                <p className="text-sm text-navy-soft">
                  {day.beyondSchedule ? "No bills or pay known for this day (not a full budget)" : "No scheduled activity"}
                </p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {day.events.map((e) => (
                    <li key={e.id}>
                      <EventChip event={e} />
                    </li>
                  ))}
                </ul>
              )}
              {day.closingChecking !== null && (
                <p className={`text-xs ${day.isShortfall ? "font-semibold text-red-700" : "text-navy-soft"}`}>
                  {day.isShortfall && "⚠ Below $0.00 · "}
                  {day.status === "projected" ? "Projected checking" : "Checking"} at end of day:{" "}
                  <span className="font-semibold text-navy tabular-nums">{formatMoney(day.closingChecking)}</span>
                  {day.originalChecking !== null && (
                    <span> (without the purchase: {formatMoney(day.originalChecking)})</span>
                  )}
                </p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onOpenDay(date)}
              className="rounded-full bg-white px-3 py-1 text-sm font-semibold text-accent shadow-soft hover:bg-accent-soft"
            >
              Details<span className="sr-only"> for {formatFullDate(date)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
