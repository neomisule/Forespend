import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { ApiError, postInvestment, type ContributionFrequency, type InvestmentRequest, type InvestmentResult } from "../api";
import type { ConceptId } from "../content/concepts";
import type { InvestingPreset } from "../learning/GameLearningApp";
import { addDays, formatShortDate } from "../lib/dates";
import { chartLines, investingSummary, yearlyRows } from "../lib/investing";
import { formatCents, formatMoney, normalizeAmountInput, toCents } from "../lib/money";
import { TermHelp } from "./TermHelp";

/** What the form holds (as typed); validated into an InvestmentRequest on submit. */
export interface InvestingDraft {
  contribution: string;
  frequency: ContributionFrequency;
  startDate: string;
  years: number;
  grossReturn: string;
  adverseReturn: string;
  feeA: string;
  feeB: string;
}

// Demo defaults: the first contribution lands on the demo's next pay day.
export const DEFAULT_INVESTING_DRAFT: InvestingDraft = {
  contribution: "25.00",
  frequency: "biweekly",
  startDate: "2026-10-23",
  years: 5,
  grossReturn: "6.00",
  adverseReturn: "-4.00",
  feeA: "0.15",
  feeB: "1.25",
};

type Load = { status: "idle" } | { status: "loading" } | { status: "ready"; request: InvestmentRequest; result: InvestmentResult } | { status: "error"; message: string };
type Field = keyof InvestingDraft;
type Errors = Partial<Record<Field, string>>;

function pct(raw: string, min: number, max: number): string | null {
  const t = raw.trim().replace(/%$/, "");
  if (!/^-?\d{1,2}(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  if (n < min || n > max) return null;
  const [whole, frac = ""] = t.replace("-", "").split(".");
  return `${t.startsWith("-") ? "-" : ""}${whole}.${frac.padEnd(2, "0")}`;
}

function validate(d: InvestingDraft, referenceDate: string | null): { errors: Errors; request: InvestmentRequest | null } {
  const e: Errors = {};
  const contribution = normalizeAmountInput(d.contribution);
  if (!contribution) e.contribution = "Enter an amount above $0, like 25.";
  else if (toCents(contribution) > 10_000_000n) e.contribution = "Use an amount up to $100,000.";
  if (!d.startDate) e.startDate = "Choose a date.";
  else if (referenceDate && d.startDate <= referenceDate) e.startDate = `Choose a date after ${formatShortDate(referenceDate)} (the demo day).`;
  else if (referenceDate && d.startDate > addDays(referenceDate, 365)) e.startDate = "Choose a date within a year of the demo day.";
  if (!Number.isInteger(d.years) || d.years < 1 || d.years > 10) e.years = "Choose 1 to 10 years.";
  const gross = pct(d.grossReturn, -30, 30);
  if (gross === null) e.grossReturn = "Enter a yearly return between −30 and 30, like 6.";
  const adverse = pct(d.adverseReturn, -30, 30);
  if (adverse === null) e.adverseReturn = "Enter a yearly return between −30 and 30, like -4.";
  const feeA = pct(d.feeA, 0, 5);
  if (feeA === null) e.feeA = "Enter a yearly fee from 0 to 5, like 0.15.";
  const feeB = pct(d.feeB, 0, 5);
  if (feeB === null) e.feeB = "Enter a yearly fee from 0 to 5, like 1.25.";
  if (Object.keys(e).length) return { errors: e, request: null };
  return {
    errors: e,
    request: {
      contribution: contribution!,
      frequency: d.frequency,
      start_date: d.startDate,
      years: d.years,
      gross_return_pct: gross!,
      adverse_return_pct: adverse!,
      fee_a_pct: feeA!,
      fee_b_pct: feeB!,
    },
  };
}

interface Props {
  referenceDate: string | null;
  preset: InvestingPreset | null; // from a Learn lesson
  onPresetUsed: () => void;
  onResult: (request: InvestmentRequest | null, result: InvestmentResult | null) => void; // for the assistant + calendar
  onExplain: () => void;
  onPreviewOnCalendar: (request: InvestmentRequest) => void;
}

/**
 * Investing illustration: a regular contribution into two hypothetical funds that
 * differ only in fees. All numbers come from the backend; this file only shows them.
 */
export function InvestingApp({ referenceDate, preset, onPresetUsed, onResult, onExplain, onPreviewOnCalendar }: Props) {
  const [draft, setDraft] = useState<InvestingDraft>(DEFAULT_INVESTING_DRAFT);
  const [errors, setErrors] = useState<Errors>({});
  const [load, setLoad] = useState<Load>({ status: "idle" });
  const abort = useRef<AbortController | null>(null);
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;

  const run = useCallback(
    async (request: InvestmentRequest) => {
      abort.current?.abort();
      const ac = new AbortController();
      abort.current = ac;
      setLoad({ status: "loading" });
      try {
        const result = await postInvestment(request, ac.signal);
        if (ac.signal.aborted) return;
        setLoad({ status: "ready", request, result });
      } catch (err) {
        if (ac.signal.aborted) return;
        setLoad({ status: "error", message: err instanceof ApiError ? err.message : "Something unexpected went wrong." });
      }
    },
    [],
  );

  // A lesson handed us a plan: prefill and run it (a free, local calculation).
  useEffect(() => {
    if (!preset) return;
    const next = { ...DEFAULT_INVESTING_DRAFT, contribution: preset.contribution, frequency: preset.frequency, years: preset.years };
    setDraft(next);
    setErrors({});
    const { request } = validate(next, referenceDate);
    if (request) void run(request);
    onPresetUsed();
  }, [preset, referenceDate, run, onPresetUsed]);

  // Tell the app (assistant, calendar) about the current result; clear it while inputs are being edited.
  useEffect(() => {
    if (load.status === "ready") onResult(load.request, load.result);
    else onResult(null, null);
  }, [load, onResult]);

  useEffect(() => () => abort.current?.abort(), []);

  const set = (patch: Partial<InvestingDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[k as Field];
      return next;
    });
    // Any input change invalidates the shown result (stale numbers are never kept on screen).
    setLoad((l) => (l.status === "ready" ? { status: "idle" } : l));
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const { errors, request } = validate(draft, referenceDate);
    setErrors(errors);
    if (!request) {
      const first = (Object.keys(errors) as Field[])[0];
      document.getElementById(id(first))?.focus();
      return;
    }
    void run(request).then(() => resultsRef.current?.focus());
  };

  const input =
    "mt-1 w-full rounded-xl border-2 border-line bg-white px-3 py-2 text-base text-navy outline-none focus-visible:border-accent aria-[invalid=true]:border-red-600";
  const field = (f: Field, label: string, props: Record<string, unknown>, opts: { prefix?: string; suffix?: string; help?: ConceptId; hint?: string } = {}) => (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id(f)} className="text-sm font-bold">
          {label}
        </label>
        {opts.help && <TermHelp concept={opts.help} />}
      </div>
      <div className="relative">
        {opts.prefix && (
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 mt-0.5 -translate-y-1/2 text-navy-soft">
            {opts.prefix}
          </span>
        )}
        <input
          id={id(f)}
          className={`${input} ${opts.prefix ? "pl-6" : ""} ${opts.suffix ? "pr-8" : ""} tabular-nums`}
          aria-invalid={!!errors[f]}
          aria-describedby={[errors[f] ? id(`${f}-err`) : "", opts.hint ? id(`${f}-hint`) : ""].join(" ").trim() || undefined}
          {...props}
        />
        {opts.suffix && (
          <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 mt-0.5 -translate-y-1/2 text-navy-soft">
            {opts.suffix}
          </span>
        )}
      </div>
      {opts.hint && (
        <p id={id(`${f}-hint`)} className="mt-1 text-xs text-navy-soft">
          {opts.hint}
        </p>
      )}
      {errors[f] && (
        <p id={id(`${f}-err`)} className="mt-1 text-xs font-semibold text-red-700">
          {errors[f]}
        </p>
      )}
    </div>
  );
  const onText = (k: Field) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value } as Partial<InvestingDraft>);

  return (
    <main className="mx-auto max-w-7xl px-4 pt-1 pb-6 sm:px-6">
      <h1 className="sr-only">Investing illustration</h1>
      <div className="grid gap-5 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start">
        {/* ---- the plan ---- */}
        <section aria-labelledby={id("plan")} className="lab-card p-5">
          <p className="lab-overline">Investing · illustration</p>
          <h2 id={id("plan")} className="font-display text-xl font-bold">
            Set aside a little, regularly.
          </h2>
          <p className="mt-1 text-sm text-navy-soft">
            Compare two hypothetical funds with the same investments and the same return before fees. Only the yearly fee differs.
          </p>
          <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              {field("contribution", "Contribution", { value: draft.contribution, inputMode: "decimal", onChange: onText("contribution") }, { prefix: "$" })}
              <div>
                <label htmlFor={id("frequency")} className="text-sm font-bold">
                  How often?
                </label>
                <select id={id("frequency")} value={draft.frequency} onChange={(e) => set({ frequency: e.target.value as ContributionFrequency })} className={`${input} !px-2 !text-sm`}>
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every 2 weeks</option>
                  <option value="monthly">Every month</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {field("startDate", "First contribution", {
                type: "date",
                value: draft.startDate,
                min: referenceDate ? addDays(referenceDate, 1) : undefined,
                onChange: onText("startDate"),
              })}
              <div>
                <label htmlFor={id("years")} className="text-sm font-bold">
                  For how long? <span className="font-normal text-navy-soft">({draft.years} {draft.years === 1 ? "year" : "years"})</span>
                </label>
                <input
                  id={id("years")}
                  type="range"
                  min={1}
                  max={10}
                  step={1}
                  value={draft.years}
                  onChange={(e) => set({ years: Number(e.target.value) })}
                  aria-valuetext={`${draft.years} years`}
                  className="mt-3 w-full accent-[var(--color-accent)]"
                />
                {errors.years && <p className="mt-1 text-xs font-semibold text-red-700">{errors.years}</p>}
              </div>
            </div>

            <fieldset className="rounded-2xl bg-surface-soft/70 p-3">
              <legend className="px-1 text-sm font-bold">Assumptions you can change</legend>
              <div className="mt-1 grid grid-cols-2 gap-3">
                {field("grossReturn", "Yearly return before fees", { value: draft.grossReturn, inputMode: "decimal", onChange: onText("grossReturn") }, { suffix: "%", help: "return_assumption" })}
                {field("adverseReturn", "Adverse yearly return", { value: draft.adverseReturn, inputMode: "decimal", onChange: onText("adverseReturn") }, { suffix: "%", help: "adverse_scenario" })}
                {field("feeA", "Fund A yearly fee", { value: draft.feeA, inputMode: "decimal", onChange: onText("feeA") }, { suffix: "%", help: "expense_ratio" })}
                {field("feeB", "Fund B yearly fee", { value: draft.feeB, inputMode: "decimal", onChange: onText("feeB") }, { suffix: "%" })}
              </div>
              <p className="mt-2 text-xs text-navy-soft">Hypothetical numbers for learning. They are not a forecast, and no return is guaranteed.</p>
            </fieldset>

            <button type="submit" className="lab-button">
              Illustrate
            </button>
          </form>
        </section>

        {/* ---- results ---- */}
        <section aria-labelledby={id("results")} className="lab-card min-w-0 p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="lab-overline">Results</p>
              <h2 id={id("results")} ref={resultsRef} tabIndex={-1} className="font-display text-xl font-bold">
                What fees do over time
              </h2>
            </div>
            {load.status === "ready" && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={onExplain} aria-haspopup="dialog" className="lab-button-quiet !py-1.5 text-sm">
                  <span aria-hidden="true">💬</span> Explain this
                </button>
                <button type="button" onClick={() => onPreviewOnCalendar(load.request)} className="lab-button-quiet !py-1.5 text-sm">
                  <span aria-hidden="true">📅</span> Preview on calendar
                </button>
              </div>
            )}
          </div>

          <div aria-live="polite" className="mt-3">
            {load.status === "idle" && (
              <p className="rounded-2xl bg-surface-soft p-4 text-sm text-navy-soft">
                Press <strong className="text-navy">Illustrate</strong> to see both funds year by year. Changing any input clears the old result.
              </p>
            )}
            {load.status === "loading" && (
              <p role="status" className="rounded-2xl bg-surface-soft p-4 text-sm">
                Calculating…
              </p>
            )}
            {load.status === "error" && (
              <div role="alert" className="rounded-2xl bg-red-50 p-4 text-sm text-red-900">
                <p className="font-semibold">The illustration couldn’t be calculated.</p>
                <p className="mt-1">{load.message}</p>
              </div>
            )}
            {load.status === "ready" && <Results request={load.request} result={load.result} />}
          </div>
        </section>
      </div>
    </main>
  );
}

function Results({ request, result: r }: { request: InvestmentRequest; result: InvestmentResult }) {
  const [a, b] = r.funds;
  const uid = useId();
  const W = 640, H = 220, PAD = 8;
  const { lines, maxCents } = chartLines(r.series, W - 2 * PAD, H - 2 * PAD);
  const colors: Record<string, string> = {
    contributed: "#6b6e89",
    fund_a_value: "#536caf",
    fund_b_value: "#df8db7",
    adverse_fund_a_value: "#536caf",
    adverse_fund_b_value: "#df8db7",
  };
  const rows = yearlyRows(r.series);
  const cf = r.cash_flow;
  const summary = investingSummary(r, formatMoney);
  const below = toCents(b.adverse_ending_value) < toCents(r.total_contributions);

  return (
    <div className="flex flex-col gap-4 motion-safe:animate-refresh">
      {/* headline numbers */}
      <dl className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-2xl bg-surface-soft p-3">
          <dt className="text-xs font-bold text-navy-soft">You put in</dt>
          <dd className="font-display text-xl font-bold tabular-nums">{formatMoney(r.total_contributions)}</dd>
          <dd className="text-xs text-navy-soft">
            {r.contributions_count} × {formatMoney(request.contribution)}, {formatShortDate(r.first_contribution)} – {formatShortDate(r.horizon_end)}
          </dd>
        </div>
        <div className="rounded-2xl bg-accent-soft p-3">
          <dt className="text-xs font-bold text-navy-soft">{a.label} · {a.fee_pct}% fee</dt>
          <dd className="font-display text-xl font-bold tabular-nums">{formatMoney(a.ending_value)}</dd>
          <dd className="text-xs text-navy-soft">fees deducted {formatMoney(a.fees_deducted)}</dd>
        </div>
        <div className="rounded-2xl bg-lilac-soft p-3">
          <dt className="text-xs font-bold text-navy-soft">{b.label} · {b.fee_pct}% fee</dt>
          <dd className="font-display text-xl font-bold tabular-nums">{formatMoney(b.ending_value)}</dd>
          <dd className="text-xs text-navy-soft">fees deducted {formatMoney(b.fees_deducted)}</dd>
        </div>
      </dl>

      <div className="rounded-2xl border-2 border-line p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <p>
            <strong>Gap caused by fees: {formatMoney(r.fee_difference.ending_value_gap)}</strong> ={" "}
            {formatMoney(r.fee_difference.extra_fees_deducted)} extra fees taken + {formatMoney(r.fee_difference.extra_lost_growth)} growth those fees never earned
          </p>
          <TermHelp concept="compounding" />
        </div>
        <p className="mt-1 text-xs text-navy-soft">
          With no fee at all: {formatMoney(r.no_fee_ending_value)}. Adverse scenario ({request.adverse_return_pct}%/yr): {a.label} {formatMoney(a.adverse_ending_value)},{" "}
          {b.label} {formatMoney(b.adverse_ending_value)}{below ? ", below what you put in" : ""}.
        </p>
      </div>

      {/* chart + equivalent table */}
      <figure aria-labelledby={`${uid}-cap`} className="min-w-0">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-labelledby={`${uid}-cap`} className="h-auto w-full rounded-2xl bg-surface-soft">
          <g transform={`translate(${PAD} ${PAD})`}>
            {lines.map((l) => (
              <polyline
                key={l.key}
                points={l.points}
                fill="none"
                stroke={colors[l.key]}
                strokeWidth={l.key === "contributed" ? 2 : 2.5}
                strokeDasharray={l.dashed ? "6 5" : l.key === "contributed" ? "2 4" : undefined}
                strokeLinejoin="round"
              />
            ))}
          </g>
          <text x={PAD + 4} y={PAD + 12} textAnchor="start" fontSize="11" fill="#6b6e89">
            top of chart = {formatCents(maxCents)}
          </text>
        </svg>
        <figcaption id={`${uid}-cap`} className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-navy-soft">
          <span>Value month by month, {formatShortDate(r.first_contribution)} – {formatShortDate(r.horizon_end)}.</span>
          <span><span aria-hidden="true" className="inline-block h-0.5 w-5 bg-[#536caf] align-middle" /> Fund A</span>
          <span><span aria-hidden="true" className="inline-block h-0.5 w-5 bg-[#df8db7] align-middle" /> Fund B</span>
          <span><span aria-hidden="true" className="inline-block h-0.5 w-5 border-t-2 border-dotted border-[#6b6e89] align-middle" /> contributed</span>
          <span><span aria-hidden="true" className="inline-block h-0.5 w-5 border-t-2 border-dashed border-[#536caf] align-middle" /> dashed = adverse scenario</span>
        </figcaption>
      </figure>

      <div className="overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <caption className="sr-only">Year by year values, the same numbers as the chart</caption>
          <thead>
            <tr className="text-left text-navy-soft">
              <th scope="col" className="py-1 font-semibold">Year</th>
              <th scope="col" className="py-1 text-right font-semibold">Put in</th>
              <th scope="col" className="py-1 text-right font-semibold">Fund A</th>
              <th scope="col" className="py-1 text-right font-semibold">Fund B</th>
              <th scope="col" className="py-1 text-right font-semibold">Gap</th>
              <th scope="col" className="py-1 text-right font-semibold">A adverse</th>
              <th scope="col" className="py-1 text-right font-semibold">B adverse</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.month}>
                <td className="py-0.5">{row.year}{row.month !== r.series[row.year * 12 - 1]?.month ? " (partial)" : ""}</td>
                <td className="py-0.5 text-right">{formatMoney(row.contributed)}</td>
                <td className="py-0.5 text-right">{formatMoney(row.fund_a_value)}</td>
                <td className="py-0.5 text-right">{formatMoney(row.fund_b_value)}</td>
                <td className="py-0.5 text-right">{formatCents(row.gap)}</td>
                <td className="py-0.5 text-right">{formatMoney(row.adverse_fund_a_value)}</td>
                <td className="py-0.5 text-right">{formatMoney(row.adverse_fund_b_value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section aria-labelledby={`${uid}-sum`} className="rounded-2xl bg-lilac-soft/70 p-3 text-sm">
        <h3 id={`${uid}-sum`} className="font-display font-semibold">
          In plain words
        </h3>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          {summary.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </section>

      <section aria-labelledby={`${uid}-cash`} className="rounded-2xl border-2 border-line p-3 text-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-x-2">
          <h3 id={`${uid}-cash`} className="font-display font-semibold">
            Can checking cover it? (only through {formatShortDate(cf.assessed_through)})
          </h3>
          <TermHelp concept="transfer" />
        </div>
        <p className="mt-1">
          {cf.contributions_in_window} contribution{cf.contributions_in_window === 1 ? "" : "s"} ({formatMoney(cf.amount_in_window)}) fall while bills and pay are known. Lowest checking goes from{" "}
          {formatMoney(cf.lowest_checking_before.balance)} to{" "}
          <strong className={cf.shortfall_dates_after.length ? "text-red-700" : ""}>{formatMoney(cf.lowest_checking_after.balance)}</strong> on {formatShortDate(cf.lowest_checking_after.date)}
          {cf.shortfall_dates_after.length ? " (below $0)" : ""}.
        </p>
        <p className="mt-1 text-xs text-navy-soft">
          The other {cf.contributions_after_coverage} contributions come after {formatShortDate(cf.assessed_through)}, when this demo has no rent, groceries or pay scheduled, so
          whether they fit a budget hasn’t been assessed. Contributions are transfers to a separate investment account, not spending; the invested value is not spendable cash.
        </p>
      </section>

      <details className="rounded-2xl bg-surface-soft px-3 py-2 text-sm">
        <summary className="cursor-pointer font-semibold">View calculation</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-navy-soft">
          {r.convention.map((c) => (
            <li key={c}>{c}</li>
          ))}
          {r.assumptions.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}
