// Turns verified backend results into plain sentences, using fixed templates.
// No new money calculations happen here: every amount and date is a value the
// backend returned. The only maths is comparing two exact cent amounts (for
// the optional cushion), done with BigInt cents, never floats.
import type { MethodOption, SimulationResult } from "../api";
import { formatShortDate } from "./dates";
import { formatMoney, toCents } from "./money";

const day = (iso: string) => formatShortDate(iso).replace(/, \d{4}$/, ""); // "Nov 1"
const fullDay = (iso: string) => formatShortDate(iso); // "Nov 1, 2026"

export interface Answer {
  question: string;
  answer: string;
  detail?: string;
  tone?: "warning";
}

export type CushionStatus = { kind: "at_or_above"; through: string } | { kind: "below"; lowest: string; on: string };

/** Compare the lowest projected balance with the person's cushion. Equal counts as staying at it. */
export function cushionStatus(option: MethodOption, cushion: string): CushionStatus {
  const low = option.comparison.lowest_after;
  return toCents(low.balance) >= toCents(cushion)
    ? { kind: "at_or_above", through: option.comparison.window_end }
    : { kind: "below", lowest: low.balance, on: low.date };
}

export function cushionLabel(status: CushionStatus, cushion: string): string {
  return status.kind === "at_or_above"
    ? `Stays at or above your ${formatMoney(cushion)} cushion through ${day(status.through)}`
    : `Below your ${formatMoney(cushion)} cushion: lowest ${formatMoney(status.lowest)} on ${day(status.on)}`;
}

/** The same four questions, answered for one payment method. */
export function answers(o: MethodOption, data: SimulationResult): Answer[] {
  const purchaseDay = day(data.purchase.date);
  const end = day(o.comparison.window_end);
  const window = `${day(o.comparison.window_start)}–${end}`;
  const later = o.schedule.filter((p) => p.date > data.purchase.date);
  const low = o.comparison.lowest_after;
  const below0 = o.comparison.outcome === "shortfall";

  let now: Answer;
  if (o.method === "credit") {
    const first = o.schedule[0];
    now = {
      question: "What leaves my account now?",
      answer: `${formatMoney(o.paid_on_purchase_date)} on ${purchaseDay}`,
      detail: first
        ? `The ${formatMoney(data.purchase.amount)} becomes card debt. First repayment: ${formatMoney(first.amount)} on ${day(first.date)}, then monthly.`
        : `The ${formatMoney(data.purchase.amount)} becomes card debt.`,
    };
  } else if (o.method === "installments") {
    now = {
      question: "What leaves my account now?",
      answer: `${formatMoney(o.paid_on_purchase_date)} on ${purchaseDay}`,
      detail: later.length
        ? `Then ${later.length} more payment${later.length === 1 ? "" : "s"}, the last on ${day(later[later.length - 1].date)}.`
        : undefined,
    };
  } else {
    now = {
      question: "What leaves my account now?",
      answer: `${formatMoney(o.paid_on_purchase_date)} on ${purchaseDay}`,
      detail: "The full price, all at once.",
    };
  }

  const extraWord = o.method === "credit" ? "interest" : o.method === "installments" ? "fees" : "";
  const extra: Answer = {
    question: "How much extra will I pay?",
    answer:
      o.method === "cash"
        ? "$0.00"
        : `${o.full_schedule_complete ? "" : "At least "}${formatMoney(o.financing_cost_full_schedule)} in ${extraWord} over the full plan`,
    detail:
      o.method === "cash"
        ? "No interest or fees."
        : `${formatMoney(o.financing_cost_paid_in_window)} of it paid by ${end}.${
            o.full_schedule_complete && o.payoff_date ? ` Plan ends ${fullDay(o.payoff_date)}.` : " This plan doesn’t finish."
          }`,
  };

  const owedFinancing = o.interest_or_fees_owed_at_window_end;
  const owe: Answer = {
    question: "What will I still owe?",
    answer: `${formatMoney(o.owed_at_window_end)} on ${end}`,
    detail:
      o.owed_at_window_end === "0.00"
        ? "Nothing left to pay."
        : owedFinancing !== "0.00"
          ? `Includes ${formatMoney(owedFinancing)} ${extraWord} added so far.`
          : undefined,
  };

  return [
    now,
    {
      question: "What’s the least cash I’ll have?",
      answer: `${formatMoney(low.balance)} on ${day(low.date)}`,
      detail: below0 ? `Below $0 in checking (between ${window}).` : `Lowest checking between ${window}.`,
      tone: below0 ? "warning" : undefined,
    },
    extra,
    owe,
  ];
}

export interface Interpretation {
  points: string[]; // one per method, in the order the backend returned them
  tradeoff: string;
  limitation: string | null;
}

/** "What this means for you": fixed templates over backend values. Never picks a winner. */
export function interpret(data: SimulationResult, cushion: string | null): Interpretation {
  const points = data.options.map((o) => {
    const low = o.comparison.lowest_after;
    const lowText = `lowest checking ${formatMoney(low.balance)} on ${day(low.date)}`;
    const end = day(o.comparison.window_end);
    let s: string;
    if (o.method === "cash") {
      s = `Cash takes ${formatMoney(o.paid_on_purchase_date)} now and costs nothing extra; you owe nothing afterward (${lowText}).`;
    } else if (o.method === "installments") {
      s = `Installments take ${formatMoney(o.paid_on_purchase_date)} now and add ${formatMoney(o.financing_cost_full_schedule)} in fees; you still owe ${formatMoney(o.owed_at_window_end)} on ${end} (${lowText}).`;
    } else if (!o.full_schedule_complete && o.warnings.some((w) => w.includes("does not cover the interest"))) {
      s = `Credit takes ${formatMoney(o.paid_on_purchase_date)} now, but the planned repayment is smaller than the interest added, so the debt doesn’t go down; you still owe ${formatMoney(o.owed_at_window_end)} on ${end} (${lowText}).`;
    } else {
      s = `Credit takes ${formatMoney(o.paid_on_purchase_date)} now but adds ${o.full_schedule_complete ? "" : "at least "}${formatMoney(o.financing_cost_full_schedule)} in interest${
        o.payoff_date ? `, finishing ${fullDay(o.payoff_date)}` : ""
      }; you still owe ${formatMoney(o.owed_at_window_end)} on ${end} (${lowText}).`;
    }
    if (o.comparison.outcome === "shortfall") s += ` Checking goes below $0.`;
    if (cushion !== null) s += ` ${cushionLabel(cushionStatus(o, cushion), cushion)}.`;
    return s;
  });

  const anyExtra = data.options.some((o) => o.financing_cost_full_schedule !== "0.00");
  const tradeoff =
    "Paying sooner lowers your cash now but leaves nothing owed. Paying later keeps more cash now, but you still owe the rest" +
    (anyExtra ? " and may pay extra for it." : ".") +
    " Which matters more depends on your situation; none of these is automatically the right choice.";

  const late = data.options.some((o) => o.payments_after_scheduled_through);
  const limitation = late
    ? `Some payments continue after ${fullDay(data.coverage.scheduled_through)}, when this demo has no scheduled pay or bills, so affordability after that hasn’t been assessed.`
    : null;

  return { points, tradeoff, limitation };
}
