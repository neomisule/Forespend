import type { CalendarEvent } from "../api";
import { compactLabel } from "../lib/calendarModel";
import { formatMoney, formatMoneyCompact } from "../lib/money";

/**
 * One money movement: the name first, the signed amount at the end so it is never
 * cut off. Meaning is carried by words and signs, not just colour: "+" / "−", a
 * dashed border for projected estimates, pink for a planned (hypothetical) payment.
 * In the grid the name is shortened; day details and the list carry the full label.
 */
export function EventChip({ event, compact = false }: { event: CalendarEvent; compact?: boolean }) {
  const incoming = event.direction === "in";
  const experiment = event.source === "experiment";
  const projected = event.period === "projected";
  const tone = experiment ? "bg-lilac-soft text-lilac border-lilac/40" : incoming ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-900";
  const border = experiment ? "border" : projected ? "border border-dashed border-current/35" : "border border-transparent";
  return (
    // In a very narrow grid cell (large text, zoom) the name takes its own line instead of shrinking to one letter.
    <span className={`flex min-w-0 flex-wrap items-baseline gap-x-1 rounded-md px-1 py-0.5 text-xs leading-snug ${tone} ${border}`}>
      <span className="sr-only">{experiment ? "Planned payment" : incoming ? "Money in" : "Money out"}: </span>
      <span className={compact ? "min-w-0 flex-1 truncate @max-[5.25rem]:basis-full" : "min-w-0 flex-1"}>{compact ? compactLabel(event.label) : event.label}</span>
      {!compact && projected && !experiment && <span className="shrink-0 italic opacity-80">estimate</span>}
      <span className="ml-auto shrink-0 font-semibold tabular-nums">
        <span aria-hidden="true">{incoming ? "+" : "−"}</span>
        {compact ? formatMoneyCompact(event.amount) : formatMoney(event.amount)}
      </span>
    </span>
  );
}

