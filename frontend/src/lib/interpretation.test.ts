import { describe, expect, it } from "vitest";
import { parseSimulation, type SimulationResult } from "../api";
import { CONCEPTS } from "../content/concepts";
import { answers, cushionLabel, cushionStatus, interpret } from "./interpretation";
import { fitRowHeight } from "./layout";
import simSample from "./simulation-sample-november.json";

const sim = parseSimulation(simSample);
const opt = (data: SimulationResult, m: string) => data.options.find((o) => o.method === m)!;
const answerTo = (data: SimulationResult, m: string, q: string) =>
  answers(opt(data, m), data).find((a) => a.question.startsWith(q))!;

/** A copy of the real response with one option's lowest balance changed (for edge cases). */
function withLowest(m: string, balance: string, outcome: "cushion" | "shortfall" = "cushion"): SimulationResult {
  const copy = structuredClone(sim);
  const o = opt(copy, m);
  o.comparison.lowest_after = { ...o.comparison.lowest_after, balance };
  o.comparison.outcome = outcome;
  return copy;
}

describe("the four questions", () => {
  it("'now' is only what leaves checking on the purchase date", () => {
    expect(answerTo(sim, "cash", "What leaves").answer).toBe("$600.00 on Oct 24");
    expect(answerTo(sim, "installments", "What leaves").answer).toBe("$150.00 on Oct 24");
    expect(answerTo(sim, "installments", "What leaves").detail).toBe("Then 3 more payments, the last on Dec 5.");
    const credit = answerTo(sim, "credit", "What leaves");
    expect(credit.answer).toBe("$0.00 on Oct 24"); // not the $100 monthly repayment
    expect(credit.detail).toContain("First repayment: $100.00 on Nov 15, then monthly");
  });

  it("uses the same window and exact dates for every method", () => {
    for (const m of ["cash", "installments", "credit"]) {
      expect(answerTo(sim, m, "What’s the least").detail).toBe("Lowest checking between Oct 24–Nov 30.");
      expect(answerTo(sim, m, "What will I still owe").answer).toMatch(/ on Nov 30$/);
    }
    expect(answerTo(sim, "cash", "What’s the least").answer).toBe("$170.00 on Nov 1");
  });

  it("separates cost paid in the window from the full-plan cost", () => {
    const extra = answerTo(sim, "credit", "How much extra");
    expect(extra.answer).toBe("$43.73 in interest over the full plan");
    expect(extra.detail).toMatch(/^\$\d+\.\d\d of it paid by Nov 30\. Plan ends May 15, 2027\.$/);
    expect(answerTo(sim, "cash", "How much extra").answer).toBe("$0.00");
    expect(answerTo(sim, "installments", "What will I still owe").answer).toBe("$150.00 on Nov 30");
  });
});

describe("cushion", () => {
  it("counts an exactly equal lowest balance as staying at the cushion", () => {
    const s = cushionStatus(opt(sim, "cash"), "170.00");
    expect(s.kind).toBe("at_or_above");
    expect(cushionLabel(s, "170.00")).toBe("Stays at or above your $170.00 cushion through Nov 30");
  });
  it("one cent more is below", () => {
    const s = cushionStatus(opt(sim, "cash"), "170.01");
    expect(cushionLabel(s, "170.01")).toBe("Below your $170.01 cushion: lowest $170.00 on Nov 1");
  });
  it("handles balances below zero, and a $0 cushion", () => {
    const data = withLowest("cash", "-230.00", "shortfall");
    expect(cushionStatus(opt(data, "cash"), "0.00").kind).toBe("below");
    expect(cushionStatus(opt(sim, "cash"), "0.00").kind).toBe("at_or_above");
    const least = answerTo(data, "cash", "What’s the least");
    expect(least.tone).toBe("warning");
    expect(least.answer).toBe("−$230.00 on Nov 1");
    expect(interpret(data, null).points[0]).toContain("Checking goes below $0.");
  });
});

describe("what this means for you", () => {
  it("covers every method with backend numbers and never names a winner", () => {
    const m = interpret(sim, "500.00");
    expect(m.points).toHaveLength(3);
    expect(m.points[0]).toContain("Cash takes $600.00 now");
    expect(m.points[0]).toContain("Below your $500.00 cushion");
    expect(m.points[2]).toContain("Credit takes $0.00 now but adds $43.73 in interest");
    expect(m.points[2]).toContain("Stays at or above your $500.00 cushion");
    const all = [...m.points, m.tradeoff].join(" ");
    expect(all).not.toMatch(/\b(best|safe|affordable|recommend|winner|free)\b/i);
    expect(m.limitation).toContain("hasn’t been assessed");
  });

  it("changes when the terms change (no stale text)", () => {
    const changed = structuredClone(sim);
    opt(changed, "credit").financing_cost_full_schedule = "61.20";
    expect(interpret(sim, null).points[2]).toContain("$43.73");
    expect(interpret(changed, null).points[2]).toContain("$61.20");
    expect(interpret(changed, null).points[2]).not.toContain("$43.73");
  });

  it("only adds the limitation when payments run past the known schedule", () => {
    const onlyCash = structuredClone(sim);
    onlyCash.options = [opt(onlyCash, "cash")];
    expect(interpret(onlyCash, null).limitation).toBeNull();
  });
});

describe("term help content", () => {
  it("has stable ids matching their keys, with the APR model note", () => {
    for (const [key, c] of Object.entries(CONCEPTS)) expect(c.id).toBe(key);
    expect(CONCEPTS.apr.model).toContain("APR ÷ 365");
    expect(CONCEPTS.repayment.meaning).toContain("not the minimum payment");
    expect(Object.values(CONCEPTS).every((c) => c.learnPath === undefined)).toBe(true); // no fake links yet
  });
});

describe("calendar fit", () => {
  const base = { viewport: 768, tableTop: 130, head: 18, reserveBelow: 76, spacing: 4, minRow: 64 };
  it("fills the space for 5- and 6-week months", () => {
    expect(fitRowHeight({ ...base, weeks: 5 })).toBe(104);
    expect(fitRowHeight({ ...base, weeks: 6 })).toBe(86);
  });
  it("never shrinks rows below the readable minimum (page scrolls instead)", () => {
    expect(fitRowHeight({ ...base, viewport: 500, weeks: 6 })).toBe(64);
  });
});
