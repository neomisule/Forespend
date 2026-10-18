import type { CalendarEvent } from "../api";
import { formatMoney, formatMoneyCompact } from "../lib/money";

/**
 * One compact money movement. Meaning is carried by signs and words, not just colour:
 * "+" / "−", a dashed border for projected estimates, and "Try:" for the experiment.
 */
export function EventChip({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  const incoming = event.direction === "in";
  const experiment = event.source === "experiment";
  const projected = event.period === "projected";
  const tone = experiment
    ? "bg-lilac-soft text-lilac border-lilac/40 border-solid"
    : incoming
      ? "bg-emerald-50 text-emerald-900"
      : "bg-rose-50 text-rose-900";
  const border = experiment ? "border" : projected ? "border border-dashed border-current/35" : "border border-transparent";
  return (
    <span
      className={`flex min-w-0 items-baseline gap-1 rounded-md px-1.5 py-px text-xs leading-snug ${tone} ${border}`}
    >
      <span aria-hidden="true" className="font-bold">
        {incoming ? "+" : "−"}
      </span>
      <span className="sr-only">{incoming ? "Money in" : "Money out"}</span>
      <span className="shrink-0 font-semibold tabular-nums">
        {compact ? formatMoneyCompact(event.amount) : formatMoney(event.amount)}
      </span>
      {/* Long names are shortened in the grid; the full name is in the list and day details. */}
      <span className={compact ? "min-w-0 truncate" : "min-w-0"}>
        {experiment && <span className="font-semibold">Try: </span>}
        {event.label}
      </span>
      {!compact && projected && !experiment && <span className="ml-auto shrink-0 italic opacity-80">estimate</span>}
    </span>
  );
}
