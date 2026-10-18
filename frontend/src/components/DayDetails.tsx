import { certaintyLabel, sourceLabel, type DayInfo } from "../lib/calendarModel";
import { formatFullDate, formatShortDate } from "../lib/dates";
import { differenceCents, formatMoney, formatSignedCents } from "../lib/money";
import { Dialog } from "./Dialog";

interface Props {
  day: DayInfo;
  referenceDate: string;
  showingExperiment: boolean;
  onClose: () => void;
}

/** Everything about one date. All balances come from the backend's schedule. */
export function DayDetails({ day, referenceDate, showingExperiment, onClose }: Props) {
  const change =
    day.beginningChecking !== null && day.closingChecking !== null
      ? differenceCents(day.closingChecking, day.beginningChecking)
      : null;
  const ref = formatShortDate(referenceDate);

  return (
    <Dialog
      title={formatFullDate(day.date)}
      subtitle={
        <p>
          <strong className="text-navy">{day.status === "past" ? "Past day" : "Projected day"}</strong>{" "}
          {day.status === "past" ? `(on or before the demo day, ${ref})` : `(after the demo day, ${ref})`}
          {day.isToday && " · Today"}
          {showingExperiment && " · Showing: with your purchase"}
        </p>
      }
      onClose={onClose}
    >
      <section aria-labelledby="day-activity">
        <h3 id="day-activity" className="text-sm font-bold text-navy-soft">
          Activity
        </h3>
        {day.events.length === 0 ? (
          <p className="mt-2 text-sm">
            {day.beyondSchedule
              ? "No bills or pay are known for this day. The demo’s schedule has ended, so this is not a full budget."
              : "No scheduled activity"}
          </p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {day.events.map((e) => (
              <li
                key={e.id}
                className={`rounded-2xl p-3 ${e.source === "experiment" ? "bg-lilac-soft" : "bg-surface-soft"}`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{e.label}</span>
                  <span className={`font-bold tabular-nums ${e.direction === "in" ? "text-emerald-800" : "text-rose-800"}`}>
                    {e.direction === "in" ? "+" : "−"}
                    {formatMoney(e.amount)}
                  </span>
                </div>
                <p className="mt-0.5 text-sm font-medium">{e.direction === "in" ? "Money in" : "Money out"} · Checking</p>
                <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 text-xs text-navy-soft">
                  <dt className="font-semibold">Source</dt>
                  <dd>{sourceLabel(e.source)}</dd>
                  <dt className="font-semibold">Certainty</dt>
                  <dd>{certaintyLabel(e.certainty)}</dd>
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="day-balances" className="mt-5">
        <h3 id="day-balances" className="text-sm font-bold text-navy-soft">
          Balances
        </h3>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
          <dt>Checking at start of day</dt>
          <dd className="text-right font-semibold tabular-nums">
            {day.beginningChecking !== null ? formatMoney(day.beginningChecking) : "Not available"}
          </dd>
          {change !== null && (
            <>
              <dt>Change during the day</dt>
              <dd className="text-right font-semibold tabular-nums">{formatSignedCents(change)}</dd>
            </>
          )}
          <dt>Checking at end of day{day.status === "projected" ? " (projected)" : ""}</dt>
          <dd className={`text-right font-bold tabular-nums ${day.isShortfall ? "text-red-700" : ""}`}>
            {day.closingChecking !== null ? formatMoney(day.closingChecking) : "Not available"}
          </dd>
          {day.originalChecking !== null && (
            <>
              <dt className="text-navy-soft">Without your purchase</dt>
              <dd className="text-right tabular-nums text-navy-soft">{formatMoney(day.originalChecking)}</dd>
            </>
          )}
          <dt>Savings (kept separate)</dt>
          <dd className="text-right font-semibold tabular-nums">
            {day.savings !== null ? formatMoney(day.savings) : "Not available"}
          </dd>
        </dl>
        {day.isShortfall && (
          <p className="mt-2 rounded-lg bg-red-50 p-2 text-sm font-semibold text-red-800">
            ⚠ Checking is projected to be below $0.00 at the end of this day. Savings is not moved to cover it.
          </p>
        )}
      </section>
    </Dialog>
  );
}
