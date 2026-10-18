import { describe, expect, it } from "vitest";
import sample from "../../../backend/docs/calendar-sample-october.json";
import { ApiError, parseCalendar, parseSimulation } from "../api";
import simSample from "./simulation-sample-november.json";
import { buildDays } from "./calendarModel";
import { addMonths, datesInMonth, firstDay, formatFullDate, lastDay, monthGrid, todayISO } from "./dates";
import { differenceCents, formatMoney, formatMoneyCompact, normalizeAmountInput, toCents } from "./money";

const october = { year: 2026, month: 10 };
const formatPlain = (c: bigint) => `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;

describe("money (no floating point)", () => {
  it("formats decimal strings", () => {
    expect(formatMoney("1200.00")).toBe("$1,200.00");
    expect(formatMoney("-300.00")).toBe("−$300.00");
    expect(formatMoney("0.10")).toBe("$0.10");
  });
  it("subtracts exactly", () => {
    expect(toCents("0.30") - toCents("0.10")).toBe(20n); // floats would give 0.19999…
    expect(differenceCents("1155.00", "1200.00")).toBe(-4500n);
  });
  it("rejects non-money", () => {
    expect(() => toCents("12.5.0")).toThrow();
  });
  it("shortens only whole-dollar amounts for tight cells", () => {
    expect(formatMoneyCompact("850.00")).toBe("$850");
    expect(formatMoneyCompact("45.50")).toBe("$45.50");
  });
  it("normalises typed purchase amounts exactly", () => {
    expect(normalizeAmountInput("600")).toBe("600.00");
    expect(normalizeAmountInput("$1,250.5")).toBe("1250.50");
    expect(normalizeAmountInput(" 0.10 ")).toBe("0.10");
    for (const bad of ["", "0", "0.00", "-5", "12.345", "abc", "1e3"]) expect(normalizeAmountInput(bad)).toBeNull();
  });
});

describe("dates (no timezone shift)", () => {
  it("keeps YYYY-MM-DD on the same day", () => {
    expect(formatFullDate("2026-10-17")).toBe("Saturday, October 17, 2026");
    expect(formatFullDate("2026-10-01")).toBe("Thursday, October 1, 2026");
  });
  it("requests the visible month's real first and last day", () => {
    expect([firstDay(october), lastDay(october)]).toEqual(["2026-10-01", "2026-10-31"]);
    expect(lastDay({ year: 2027, month: 2 })).toBe("2027-02-28");
    expect(addMonths({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
    expect(addMonths({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
  });
  it("builds a Sunday-first seven-column grid", () => {
    const weeks = monthGrid(october);
    expect(weeks).toHaveLength(5);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
    expect(weeks[0][0]).toEqual({ date: "2026-09-27", inMonth: false });
    expect(weeks[0][4]).toEqual({ date: "2026-10-01", inMonth: true });
    expect(weeks[4][6]).toEqual({ date: "2026-10-31", inMonth: true });
  });
  it("uses the local calendar date for 'today'", () => {
    expect(todayISO(new Date(2026, 9, 18, 23, 30))).toBe("2026-10-18");
  });
});

describe("October sample from the backend", () => {
  const cal = parseCalendar(sample);
  const days = buildDays(cal, "2026-10-18");

  it("parses the real schema", () => {
    expect(cal.demo_reference_date).toBe("2026-10-17");
    expect(cal.events).toHaveLength(14);
    expect(cal.daily_balances).toHaveLength(31);
  });

  it("uses backend balances exactly, day by day", () => {
    for (const b of cal.daily_balances) {
      expect(days.get(b.date)?.closingChecking).toBe(b.checking);
      expect(days.get(b.date)?.savings).toBe("400.00");
    }
    expect(datesInMonth(october).every((d) => days.has(d))).toBe(true);
  });

  it("derives beginning balances from the schedule", () => {
    expect(days.get("2026-10-01")?.beginningChecking).toBe("1670.00"); // opening_balances
    expect(days.get("2026-10-01")?.closingChecking).toBe("820.00");
    expect(days.get("2026-10-20")?.beginningChecking).toBe("1200.00"); // Oct 19 close
    expect(days.get("2026-10-20")?.closingChecking).toBe("1155.00");
  });

  it("marks past vs projected around the demo date, separately from today", () => {
    expect(days.get("2026-10-17")).toMatchObject({ status: "past", isReferenceDate: true, isToday: false });
    expect(days.get("2026-10-18")).toMatchObject({ status: "projected", isReferenceDate: false, isToday: true });
    expect(days.get("2026-10-23")?.events.map((e) => e.label)).toEqual(["Part-time pay"]);
    expect(days.get("2026-10-02")?.events).toEqual([]);
  });

  it("marks only days whose backend balance differs from the original", () => {
    // A pretend scenario: the same sample, but Oct 24 onward is $600 lower (as the backend would return).
    const scenario = parseCalendar({
      ...sample,
      daily_balances: sample.daily_balances.map((b) =>
        b.date >= "2026-10-24" ? { ...b, checking: formatPlain(toCents(b.checking) - 60000n) } : b,
      ),
    });
    const withOriginal = buildDays(scenario, "2026-10-18", cal);
    expect(withOriginal.get("2026-10-23")?.originalChecking).toBeNull();
    expect(withOriginal.get("2026-10-24")).toMatchObject({ closingChecking: "1135.00", originalChecking: "1735.00" });
    expect(buildDays(cal, "2026-10-18").get("2026-10-24")?.originalChecking).toBeNull();
  });

  it("flags days after the known schedule", () => {
    expect(cal.scheduled_through).toBe("2026-11-06");
    expect(days.get("2026-10-31")?.beyondSchedule).toBe(false);
  });

  it("refuses a response with a missing field instead of guessing", () => {
    const broken = { ...sample, daily_balances: undefined };
    expect(() => parseCalendar(broken)).toThrow(ApiError);
  });
});

describe("payment comparison (real backend response for November)", () => {
  const sim = parseSimulation(simSample);
  const byMethod = Object.fromEntries(sim.options.map((o) => [o.method, o]));
  const nov1 = (m: string) => byMethod[m].scenario.daily_balances.find((b) => b.date === "2026-11-01")?.checking;

  it("parses all three options with one shared window", () => {
    expect(sim.options.map((o) => o.method)).toEqual(["cash", "installments", "credit"]);
    expect(new Set(sim.options.map((o) => `${o.comparison.window_start}..${o.comparison.window_end}`)).size).toBe(1);
  });

  it("shows each method's effect on Nov 1 checking", () => {
    expect([nov1("cash"), nov1("installments"), nov1("credit")]).toEqual(["170.00", "620.00", "770.00"]);
  });

  it("keeps money still owed visible for deferred methods", () => {
    expect(byMethod.cash.owed_at_window_end).toBe("0.00");
    expect(byMethod.installments.owed_at_window_end).toBe("150.00");
    expect(toCents(byMethod.credit.owed_at_window_end)).toBeGreaterThan(0n);
    expect(toCents(byMethod.credit.financing_cost_full_schedule)).toBeGreaterThan(0n);
  });

  it("reports what is missing after the known schedule", () => {
    expect(sim.coverage.window_beyond_coverage).toBe(true);
    expect(sim.coverage.not_scheduled_after.map((m) => m.label)).toContain("Rent/utilities");
    const days = buildDays(byMethod.credit.scenario, "2026-10-18", sim.baseline);
    expect(days.get("2026-11-06")?.beyondSchedule).toBe(false);
    expect(days.get("2026-11-07")?.beyondSchedule).toBe(true);
    expect(days.get("2026-11-15")?.originalChecking).toBe("1420.00"); // first card payment lowers checking
  });
});
