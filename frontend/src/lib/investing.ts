// Pure helpers for showing an investing illustration. No money maths happens here:
// every value is a backend number; we only pick rows and scale lines for the chart.
import type { InvestmentResult, SeriesPoint } from "../api";
import { toCents } from "./money";

export interface YearRow {
  year: number; // 1-based
  month: string; // YYYY-MM of the row's last month
  contributed: string;
  fund_a_value: string;
  fund_b_value: string;
  gap: bigint; // cents: fund A minus fund B
  adverse_fund_a_value: string;
  adverse_fund_b_value: string;
}

/** One row per completed year (every 12th month), always ending with the final month. */
export function yearlyRows(series: SeriesPoint[]): YearRow[] {
  const rows: YearRow[] = [];
  series.forEach((p, i) => {
    const last = i === series.length - 1;
    if ((i + 1) % 12 === 0 || last) {
      rows.push({
        year: Math.ceil((i + 1) / 12),
        month: p.month,
        contributed: p.contributed,
        fund_a_value: p.fund_a_value,
        fund_b_value: p.fund_b_value,
        gap: toCents(p.fund_a_value) - toCents(p.fund_b_value),
        adverse_fund_a_value: p.adverse_fund_a_value,
        adverse_fund_b_value: p.adverse_fund_b_value,
      });
    }
  });
  // A series whose length is a multiple of 12 pushes the final month once only.
  return rows.filter((r, i, a) => i === 0 || r.month !== a[i - 1].month);
}

export interface ChartLine {
  key: keyof SeriesPoint;
  label: string;
  points: string; // SVG polyline points
  dashed: boolean;
}

/** Scales the series into an SVG box. `width`/`height` are the plotting area in px. */
export function chartLines(series: SeriesPoint[], width: number, height: number): { lines: ChartLine[]; maxCents: bigint } {
  const keys: { key: keyof SeriesPoint; label: string; dashed: boolean }[] = [
    { key: "contributed", label: "Contributed", dashed: false },
    { key: "fund_a_value", label: "Fund A (lower fee)", dashed: false },
    { key: "fund_b_value", label: "Fund B (higher fee)", dashed: false },
    { key: "adverse_fund_a_value", label: "Fund A, adverse", dashed: true },
    { key: "adverse_fund_b_value", label: "Fund B, adverse", dashed: true },
  ];
  let maxCents = 1n;
  for (const p of series) for (const k of keys) maxCents = toCents(p[k.key]) > maxCents ? toCents(p[k.key]) : maxCents;
  const n = Math.max(series.length - 1, 1);
  const x = (i: number) => (i / n) * width;
  const y = (v: string) => height - Number((toCents(v) * 10000n) / maxCents) / 10000 * height;
  return {
    maxCents,
    lines: keys.map((k) => ({
      key: k.key,
      label: k.label,
      dashed: k.dashed,
      points: series.map((p, i) => `${x(i).toFixed(1)},${y(p[k.key]).toFixed(1)}`).join(" "),
    })),
  };
}

/** Plain-language summary built only from backend values (deterministic templates). */
export function investingSummary(r: InvestmentResult, formatMoney: (v: string) => string): string[] {
  const [a, b] = r.funds;
  return [
    `You put in ${formatMoney(r.total_contributions)} over ${r.contributions_count} contributions.`,
    `With the return you assumed, ${a.label} ends at ${formatMoney(a.ending_value)} and ${b.label} at ${formatMoney(b.ending_value)}: a gap of ${formatMoney(r.fee_difference.ending_value_gap)} caused only by fees.`,
    `Of that gap, ${formatMoney(r.fee_difference.extra_fees_deducted)} is extra fees actually taken and ${formatMoney(r.fee_difference.extra_lost_growth)} is growth those fees never earned.`,
    `In the adverse scenario the funds end at ${formatMoney(a.adverse_ending_value)} and ${formatMoney(b.adverse_ending_value)}, ${
      toCents(b.adverse_ending_value) < toCents(r.total_contributions) ? "below what you put in" : "still above what you put in"
    }. Real results can be worse.`,
  ];
}
