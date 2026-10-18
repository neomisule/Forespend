import { describe, expect, it } from "vitest";
import type { SeriesPoint } from "../api";
import { chartLines, yearlyRows } from "./investing";

const point = (i: number, v: number): SeriesPoint => ({
  month: `${2026 + Math.floor((10 + i) / 12)}-${String(((10 + i) % 12) + 1).padStart(2, "0")}`,
  contributed: `${(i + 1) * 25}.00`,
  no_fee_value: `${v + 10}.00`,
  fund_a_value: `${v}.00`,
  fund_b_value: `${v - 5}.00`,
  adverse_fund_a_value: `${Math.max(0, v - 30)}.00`,
  adverse_fund_b_value: `${Math.max(0, v - 35)}.00`,
});

describe("investing helpers", () => {
  it("picks one row per completed year, ending with the last month", () => {
    const rows = yearlyRows(Array.from({ length: 24 }, (_, i) => point(i, 100 + i)));
    expect(rows.map((r) => r.year)).toEqual([1, 2]);
    expect(rows[1].month).toBe("2028-10");
    expect(rows[1].gap).toBe(500n); // $5.00 in cents, exact
    const odd = yearlyRows(Array.from({ length: 15 }, (_, i) => point(i, 100)));
    expect(odd.map((r) => r.year)).toEqual([1, 2]); // partial second year still shown, once
  });

  it("scales lines into the box without exceeding it", () => {
    const series = Array.from({ length: 13 }, (_, i) => point(i, 100 + i * 10));
    const { lines, maxCents } = chartLines(series, 300, 100);
    expect(maxCents).toBe(toCentsOf(series[12].contributed)); // $325.00 is the tallest line in this fixture
    expect(lines).toHaveLength(5);
    for (const l of lines) {
      const ys = l.points.split(" ").map((p) => Number(p.split(",")[1]));
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    }
    expect(lines.find((l) => l.key === "fund_a_value")!.points.endsWith(`300.0,${(100 - (220 / 325) * 100).toFixed(1)}`)).toBe(true);
  });
});

function toCentsOf(v: string): bigint {
  return BigInt(v.replace(".", ""));
}
