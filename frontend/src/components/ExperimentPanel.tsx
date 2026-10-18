import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { ApiError, MethodOption, PaymentMethod, SimulationResult } from "../api";
import type { ConceptId } from "../content/concepts";
import { addDays, formatShortDate } from "../lib/dates";
import { answers, cushionLabel, cushionStatus, interpret } from "../lib/interpretation";
import { formatMoney, normalizeAmountInput, toCents } from "../lib/money";
import { TermHelp } from "./TermHelp";

type Frequency = "weekly" | "biweekly" | "monthly";

export interface Draft {
  label: string;
  amount: string; // exactly what was typed
  purchaseDate: string;
  method: PaymentMethod;
  count: string;
  frequency: Frequency;
  fee: string;
  apr: string;
  monthlyPayment: string;
  firstPaymentDate: string; // "" = automatic (3 weeks after the purchase)
}

/** A submitted, validated experiment. Money is normalised to "600.00". */
export interface Experiment {
  label: string;
  amount: string;
  purchaseDate: string;
  method: PaymentMethod;
  installments: { count: number; frequency: Frequency; fee: string };
  credit: { apr: string; monthly_payment: string; first_payment_date: string };
}

export type SimState =
  | { status: "loading" }
  | { status: "ready"; data: SimulationResult }
  | { status: "error"; error: ApiError };

// Fixed demo: the example purchase happens a week after the demo day.
export const DEMO_PURCHASE_DATE = "2026-10-24";
const FIRST_CARD_PAYMENT_GAP_DAYS = 22;
export const EMPTY_DRAFT: Draft = {
  label: "",
  amount: "",
  purchaseDate: DEMO_PURCHASE_DATE,
  method: "cash",
  count: "4",
  frequency: "biweekly",
  fee: "0.00",
  apr: "24.99",
  monthlyPayment: "100.00",
  firstPaymentDate: "",
};
export const LAPTOP_EXAMPLE: Partial<Draft> = { label: "Laptop", amount: "600.00", purchaseDate: DEMO_PURCHASE_DATE };

const METHODS: { id: PaymentMethod; title: string; blurb: string }[] = [
  { id: "cash", title: "Cash", blurb: "Pay it all now from checking" },
  { id: "installments", title: "Installments", blurb: "Split into fixed payments" },
  { id: "credit", title: "Credit card", blurb: "Borrow now, repay monthly with interest" },
];
const FREQUENCIES: { id: Frequency; text: string }[] = [
  { id: "weekly", text: "Every week" },
  { id: "biweekly", text: "Every 2 weeks" },
  { id: "monthly", text: "Every month" },
];

type Field = "label" | "amount" | "purchaseDate" | "count" | "fee" | "apr" | "monthlyPayment" | "firstPaymentDate";
type Errors = Partial<Record<Field, string>>;
const FIELD_METHOD: Partial<Record<Field, PaymentMethod>> = {
  count: "installments",
  fee: "installments",
  apr: "credit",
  monthlyPayment: "credit",
  firstPaymentDate: "credit",
};
const FIELD_ORDER: Field[] = ["label", "amount", "purchaseDate", "count", "fee", "apr", "monthlyPayment", "firstPaymentDate"];

export const firstPaymentFor = (d: Pick<Draft, "firstPaymentDate" | "purchaseDate">) =>
  d.firstPaymentDate || (d.purchaseDate ? addDays(d.purchaseDate, FIRST_CARD_PAYMENT_GAP_DAYS) : "");

function validate(d: Draft, referenceDate: string | null): { errors: Errors; experiment: Experiment | null } {
  const e: Errors = {};
  const label = d.label.trim();
  if (!label) e.label = "Give the purchase a name.";
  else if (label.length > 60) e.label = "Use 60 characters or fewer.";
  const amount = normalizeAmountInput(d.amount);
  if (!amount) e.amount = "Enter a price above $0, like 600 or 600.00.";
  else if (toCents(amount) > 10_000_000n) e.amount = "Use a price up to $100,000.";
  if (!d.purchaseDate) e.purchaseDate = "Choose a date.";
  else if (referenceDate && d.purchaseDate <= referenceDate)
    e.purchaseDate = `Choose a date after ${formatShortDate(referenceDate)} (the demo day).`;

  const count = Number(d.count);
  if (!/^\d+$/.test(d.count.trim()) || count < 2 || count > 24) e.count = "Use 2 to 24 payments.";
  const fee = d.fee.trim() === "" || /^\$?0*(\.0*)?$/.test(d.fee.trim()) ? "0.00" : normalizeAmountInput(d.fee);
  if (!fee) e.fee = "Enter a fee of $0 or more, like 0 or 15.00.";
  else if (toCents(fee) > 1_000_000n) e.fee = "Use a fee up to $10,000.";

  const apr = d.apr.trim().replace(/%$/, "");
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(apr)) e.apr = "Enter a rate from 0 to 99.99, like 24.99.";
  const monthly = normalizeAmountInput(d.monthlyPayment);
  if (!monthly) e.monthlyPayment = "Enter an amount above $0.";
  const first = firstPaymentFor(d);
  if (!first) e.firstPaymentDate = "Choose a date.";
  else if (d.purchaseDate && first <= d.purchaseDate) e.firstPaymentDate = "Choose a date after the purchase date.";
  else if (d.purchaseDate && first > addDays(d.purchaseDate, 62)) e.firstPaymentDate = "Choose a date within 62 days of the purchase.";

  if (Object.keys(e).length) return { errors: e, experiment: null };
  return {
    errors: e,
    experiment: {
      label,
      amount: amount!,
      purchaseDate: d.purchaseDate,
      method: d.method,
      installments: { count, frequency: d.frequency, fee: fee! },
      credit: { apr, monthly_payment: monthly!, first_payment_date: first },
    },
  };
}

interface Props {
  referenceDate: string | null;
  monthTitle: string | null;
  draft: Draft;
  onDraftChange: (d: Draft) => void;
  experiment: Experiment | null;
  sim: SimState | null;
  selectedMethod: PaymentMethod;
  onSelectMethod: (m: PaymentMethod) => void;
  calendarUnavailable: boolean;
  focusRequest: number;
  onPreview: (e: Experiment) => void;
  onEdit: () => void;
  onClear: () => void;
  onRetry: () => void;
}

export function ExperimentPanel(props: Props) {
  const { referenceDate, monthTitle, draft, onDraftChange, experiment, sim } = props;
  const [errors, setErrors] = useState<Errors>({});
  // Optional personal priority; kept while you switch months or methods.
  const [cushion, setCushion] = useState<string | null>(null);
  const refs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const resultsRef = useRef<HTMLHeadingElement>(null);
  const exampleRef = useRef<HTMLButtonElement>(null);
  const [pendingFocus, setPendingFocus] = useState<Field | "results" | "example" | null>(null);
  const uid = useId();
  const id = (f: string) => `${uid}-${f}`;

  // Move focus after the panel switches mode or reveals a field.
  useEffect(() => {
    if (!pendingFocus) return;
    const el =
      pendingFocus === "results" ? resultsRef.current : pendingFocus === "example" ? exampleRef.current : refs.current[pendingFocus];
    el?.focus();
    setPendingFocus(null);
  }, [pendingFocus, experiment, draft.method]);

  // "Try a purchase" in the top bar brings you here.
  useEffect(() => {
    if (props.focusRequest === 0) return;
    const el = experiment ? resultsRef.current : refs.current.label;
    el?.scrollIntoView({ block: "nearest" });
    el?.focus();
  }, [props.focusRequest]);

  const set = (patch: Partial<Draft>) => {
    onDraftChange({ ...draft, ...patch });
    setErrors((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(patch)) delete next[k as Field];
      if ("purchaseDate" in patch) delete next.firstPaymentDate;
      return next;
    });
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    const { errors, experiment } = validate(draft, referenceDate);
    setErrors(errors);
    if (!experiment) {
      const first = FIELD_ORDER.find((f) => errors[f])!;
      const method = FIELD_METHOD[first];
      if (method && method !== draft.method) onDraftChange({ ...draft, method }); // reveal the field that needs fixing
      setPendingFocus(first);
      return;
    }
    props.onPreview(experiment);
    setPendingFocus("results");
  };

  // ---- results mode ------------------------------------------------------------------
  if (experiment) {
    return (
      <section aria-labelledby="exp-results" className="flex flex-col gap-3">
        <div>
          <h2 id="exp-results" ref={resultsRef} tabIndex={-1} className="font-display text-xl font-semibold">
            Compare ways to pay
          </h2>
          <p className="text-sm">
            <strong>{experiment.label}</strong> · {formatMoney(experiment.amount)} · bought {formatShortDate(experiment.purchaseDate)}
          </p>
        </div>

        <div aria-live="polite">
          {props.calendarUnavailable ? (
            <p className="rounded-2xl bg-surface-soft p-3 text-sm">
              Your test run is kept. Go back to a supported month to see it.
            </p>
          ) : sim === null || sim.status === "loading" ? (
            <p role="status" className="rounded-2xl bg-surface-soft p-3 text-sm">
              Running the numbers{monthTitle ? ` for ${monthTitle}` : ""}…
            </p>
          ) : sim.status === "error" ? (
            <div role="alert" className="rounded-2xl bg-red-50 p-3 text-sm">
              <p className="font-semibold text-red-900">The comparison couldn’t be calculated.</p>
              <p className="mt-1 text-red-900">{sim.error.message}</p>
              <button type="button" onClick={props.onRetry} className="mt-2 rounded-full bg-accent px-4 py-1.5 font-semibold text-white">
                Retry
              </button>
            </div>
          ) : (
            <Comparison
              data={sim.data}
              selected={props.selectedMethod}
              onSelect={props.onSelectMethod}
              cushion={cushion}
              onCushion={setCushion}
            />
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              props.onEdit();
              setPendingFocus("label");
            }}
            className="rounded-full bg-accent-soft px-4 py-2 text-sm font-semibold text-accent-strong hover:bg-accent/15"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => {
              props.onClear();
              setErrors({});
              setPendingFocus("example");
            }}
            className="rounded-full px-4 py-2 text-sm font-semibold text-navy-soft underline hover:bg-surface-soft"
          >
            Clear experiment
          </button>
        </div>
      </section>
    );
  }

  // ---- form mode -------------------------------------------------------------------
  const input =
    "mt-1 w-full rounded-xl border-0 bg-surface-soft px-3 py-2 text-navy ring-1 ring-transparent outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-600";
  const field = (
    f: Field,
    label: string,
    extra: Record<string, unknown> = {},
    opts: { prefix?: string; suffix?: string; help?: ConceptId; hint?: string } = {},
  ) => (
    <div>
      {/* The help button sits beside the label, never inside it. */}
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <label htmlFor={id(f)} className="text-sm font-semibold">
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
          ref={(el) => {
            refs.current[f] = el;
          }}
          className={`${input} ${opts.prefix ? "pl-6" : ""} ${opts.suffix ? "pr-8" : ""} tabular-nums`}
          aria-invalid={!!errors[f]}
          aria-describedby={[errors[f] ? id(`${f}-err`) : "", opts.hint ? id(`${f}-hint`) : ""].join(" ").trim() || undefined}
          {...extra}
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
  const onText = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => set({ [k]: e.target.value } as Partial<Draft>);

  return (
    <section aria-labelledby="exp-title" className="flex flex-col gap-3">
      <div>
        <h2 id="exp-title" className="font-display text-xl font-semibold">
          Try it before you spend it.
        </h2>
        <p className="text-sm text-navy-soft">See how a purchase changes the money left for upcoming bills.</p>
        <button
          type="button"
          ref={exampleRef}
          onClick={() => set(LAPTOP_EXAMPLE)}
          className="mt-2 rounded-full bg-lilac-soft px-3 py-1 text-sm font-semibold text-lilac hover:bg-lilac/15"
        >
          Try a $600 laptop
        </button>
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col gap-3">
        {field("label", "Purchase name", { value: draft.label, onChange: onText("label"), placeholder: "e.g. Laptop", maxLength: 80 })}
        <div className="grid grid-cols-2 gap-3">
          {field("amount", "Price", { value: draft.amount, onChange: onText("amount"), placeholder: "600.00", inputMode: "decimal", autoComplete: "off" }, { prefix: "$" })}
          {field("purchaseDate", "Purchase date", {
            type: "date",
            value: draft.purchaseDate,
            min: referenceDate ? addDays(referenceDate, 1) : undefined,
            onChange: onText("purchaseDate"),
          })}
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">How would you pay?</legend>
          <div className="mt-1.5 grid gap-2">
            {METHODS.map((m) => (
              <MethodChoice
                key={m.id}
                name={`${uid}-method`}
                method={m.id}
                checked={draft.method === m.id}
                onChange={() => set({ method: m.id })}
                title={m.title}
              >
                <span className="text-xs text-navy-soft">{m.blurb}</span>
              </MethodChoice>
            ))}
          </div>
        </fieldset>

        {draft.method === "installments" && (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface-soft/70 p-3">
            <p className="flex flex-wrap items-baseline justify-between gap-x-2 text-xs text-navy-soft">
              A made-up offer to compare with. The first payment is on the purchase date.
              <TermHelp concept="installments" />
            </p>
            <div className="grid grid-cols-2 gap-3">
              {field("count", "Number of payments", { value: draft.count, inputMode: "numeric", onChange: onText("count") })}
              <div>
                <label htmlFor={id("frequency")} className="text-sm font-semibold">
                  How often?
                </label>
                <select
                  id={id("frequency")}
                  value={draft.frequency}
                  onChange={(e) => set({ frequency: e.target.value as Frequency })}
                  className={`${input} bg-white`}
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.text}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {field("fee", "Extra fee", { value: draft.fee, inputMode: "decimal", onChange: onText("fee") }, {
              prefix: "$",
              help: "fees",
              hint: "A fixed amount added once to the total. Use 0 if there is none.",
            })}
          </div>
        )}

        {draft.method === "credit" && (
          <div className="flex flex-col gap-3 rounded-2xl bg-surface-soft/70 p-3">
            <p className="text-xs text-navy-soft">An illustration of repaying a card, not a real card’s terms.</p>
            {field("apr", "Yearly interest rate (APR)", { value: draft.apr, inputMode: "decimal", onChange: onText("apr") }, { suffix: "%", help: "apr" })}
            {field("monthlyPayment", "Amount you plan to repay each month", { value: draft.monthlyPayment, inputMode: "decimal", onChange: onText("monthlyPayment") }, {
              prefix: "$",
              help: "repayment",
              hint: "Your choice, not the card’s minimum required payment.",
            })}
            {field("firstPaymentDate", "First repayment date", {
              type: "date",
              value: firstPaymentFor(draft),
              min: draft.purchaseDate ? addDays(draft.purchaseDate, 1) : undefined,
              onChange: onText("firstPaymentDate"),
            }, { help: "first_repayment" })}
          </div>
        )}

        <button type="submit" className="rounded-full bg-accent px-5 py-3 font-semibold text-white shadow-soft hover:bg-accent-strong">
          Compare payment options
        </button>
      </form>
    </section>
  );
}

/**
 * A big, tappable radio card. The real <input type="radio"> keeps keyboard and
 * screen reader support; its label is just the title, and the card's other
 * content is linked as a description so the name stays short.
 */
function MethodChoice(props: {
  name: string;
  method: PaymentMethod;
  checked: boolean;
  onChange: () => void;
  title: string;
  children: ReactNode;
}) {
  const uid = useId();
  return (
    // Clicking anywhere on the card is a mouse/touch shortcut; keyboard users use the radio itself.
    <div
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest("label, input, button, a, summary")) props.onChange();
      }}
      className={[
        "relative flex cursor-pointer gap-3 rounded-2xl p-3 motion-safe:transition",
        "has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        props.checked
          ? "bg-accent-soft shadow-[inset_0_0_0_2px_var(--color-accent)]"
          : "bg-surface-soft hover:bg-accent-soft/60 motion-safe:hover:-translate-y-px",
      ].join(" ")}
    >
      <input
        id={`${uid}-r`}
        type="radio"
        name={props.name}
        value={props.method}
        checked={props.checked}
        onChange={props.onChange}
        aria-describedby={`${uid}-d`}
        className="mt-1 size-4 shrink-0 accent-[var(--color-accent)]"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <label htmlFor={`${uid}-r`} className="cursor-pointer font-display text-base font-semibold">
          {props.title}
        </label>
        <div id={`${uid}-d`}>{props.children}</div>
      </div>
    </div>
  );
}

// ---- the comparison --------------------------------------------------------------------

function Comparison({
  data,
  selected,
  onSelect,
  cushion,
  onCushion,
}: {
  data: SimulationResult;
  selected: PaymentMethod;
  onSelect: (m: PaymentMethod) => void;
  cushion: string | null;
  onCushion: (c: string | null) => void;
}) {
  const chosen = data.options.find((o) => o.method === selected) ?? data.options[0];
  const uid = useId();
  const meaning = interpret(data, cushion);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2 gap-y-1 text-xs text-navy-soft">
        <span>Pick one to show it on the calendar.</span>
        <span className="flex gap-1">
          <TermHelp concept="remaining_debt" label="“Still owe”?" />
          <TermHelp concept="interest_vs_fee" label="Interest vs. fee?" />
        </span>
      </div>

      <fieldset>
        <legend className="sr-only">Payment option shown on the calendar</legend>
        <div className="grid gap-2">
          {data.options.map((o) => (
            <MethodChoice
              key={o.method}
              name={`${uid}-shown`}
              method={o.method}
              checked={o.method === chosen.method}
              onChange={() => onSelect(o.method)}
              title={o.title}
            >
              <p className="text-xs text-navy-soft">{o.terms}</p>
              <OptionAnswers option={o} data={data} cushion={cushion} />
            </MethodChoice>
          ))}
        </div>
      </fieldset>

      <CushionControl value={cushion} onChange={onCushion} />

      <section aria-labelledby={`${uid}-meaning`} className="rounded-2xl bg-lilac-soft/70 p-3 text-sm">
        <h3 id={`${uid}-meaning`} className="font-display font-semibold">
          What this means for you
        </h3>
        <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
          {meaning.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
        <p className="mt-2">{meaning.tradeoff}</p>
        {meaning.limitation && <p className="mt-2 text-xs text-navy-soft">{meaning.limitation}</p>}
      </section>

      {chosen.warnings.some((w) => w.includes("does not cover") || w.includes("not repaid")) && (
        <ul className="flex flex-col gap-1 rounded-2xl bg-amber-50 p-3 text-sm text-amber-950">
          {chosen.warnings
            .filter((w) => w.includes("does not cover") || w.includes("not repaid"))
            .map((w) => (
              <li key={w}>
                <span aria-hidden="true">⚠ </span>
                {w}
              </li>
            ))}
        </ul>
      )}

      <Calculation option={chosen} data={data} />
    </div>
  );
}

function OptionAnswers({ option, data, cushion }: { option: MethodOption; data: SimulationResult; cushion: string | null }) {
  const status = cushion !== null ? cushionStatus(option, cushion) : null;
  return (
    <dl className="mt-1 flex flex-col gap-1.5 text-xs">
      {answers(option, data).map((a) => (
        <div key={a.question}>
          <dt className="text-navy-soft">{a.question}</dt>
          <dd className={`font-semibold tabular-nums ${a.tone === "warning" ? "text-red-700" : ""}`}>
            {a.tone === "warning" && <span aria-hidden="true">⚠ </span>}
            {a.answer}
          </dd>
          {a.detail && <dd className="text-navy-soft">{a.detail}</dd>}
        </div>
      ))}
      {status && cushion !== null && (
        <div>
          <dt className="sr-only">Your cushion</dt>
          <dd
            className={`mt-0.5 inline-block rounded-full px-2 py-0.5 font-semibold ${
              status.kind === "below" ? "bg-amber-100 text-amber-950" : "bg-white text-navy"
            }`}
          >
            {status.kind === "below" ? "⚠ " : ""}
            {cushionLabel(status, cushion)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** "Keep at least $___ in checking" — optional, compared with each option's lowest balance. */
function CushionControl({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  const uid = useId();
  const apply = (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (t === "") {
      setError(null);
      onChange(null);
      return;
    }
    const v = /^\$?0*(\.0*)?$/.test(t) ? "0.00" : normalizeAmountInput(t);
    if (!v) return setError("Enter an amount of $0 or more, like 200.");
    setError(null);
    onChange(v);
  };
  return (
    <details className="rounded-2xl bg-surface-soft px-3 py-2 text-sm" open={value !== null}>
      <summary className="cursor-pointer font-semibold">
        Keep at least {value !== null ? formatMoney(value) : "$___"} in checking
        <span className="font-normal text-navy-soft"> (optional)</span>
      </summary>
      <form onSubmit={apply} noValidate className="mt-2 flex flex-wrap items-end gap-2">
        <div>
          <div className="flex items-baseline gap-2">
            <label htmlFor={`${uid}-c`} className="text-xs font-semibold">
              Your cushion
            </label>
            <TermHelp concept="cushion" />
          </div>
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-navy-soft">
              $
            </span>
            <input
              id={`${uid}-c`}
              value={text}
              onChange={(e) => setText(e.target.value)}
              inputMode="decimal"
              className="mt-1 w-32 rounded-xl bg-white py-1.5 pr-2 pl-6 tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-accent aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-red-600"
              aria-invalid={!!error}
              aria-describedby={error ? `${uid}-ce` : undefined}
            />
          </div>
        </div>
        <button type="submit" className="rounded-full bg-accent px-4 py-1.5 font-semibold text-white">
          Check
        </button>
        {value !== null && (
          <button
            type="button"
            onClick={() => {
              setText("");
              onChange(null);
            }}
            className="rounded-full px-3 py-1.5 font-semibold text-navy-soft underline"
          >
            Remove
          </button>
        )}
        {error && (
          <p id={`${uid}-ce`} className="w-full text-xs font-semibold text-red-700">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}

/** "View calculation": the schedule and assumptions behind the selected option. */
function Calculation({ option: o, data }: { option: MethodOption; data: SimulationResult }) {
  const price = formatMoney(data.purchase.amount);
  const day = formatShortDate(data.purchase.date);
  const end = formatShortDate(data.coverage.window_end);
  const scheduled = data.coverage.scheduled_through;
  const summary =
    o.method === "cash"
      ? `The full ${price} leaves checking on ${day}. Nothing is owed afterward.`
      : o.method === "installments"
        ? `Each payment leaves checking on its date. Total paid: ${formatMoney(o.total_paid_full_schedule)}, including ${formatMoney(o.financing_cost_full_schedule)} in fees.`
        : `The ${price} becomes card debt on ${day}; checking doesn’t change that day. Each repayment leaves checking. ${
            o.full_schedule_complete
              ? `Modeled interest over the full plan: ${formatMoney(o.financing_cost_full_schedule)}, paid off ${formatShortDate(o.payoff_date!)}.`
              : "This plan doesn’t finish, so the full interest isn’t known."
          }`;
  return (
    <details className="rounded-2xl bg-surface-soft px-3 py-2 text-sm">
      <summary className="cursor-pointer font-semibold">View calculation · {o.title}</summary>
      <p className="mt-2">{summary}</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-xs tabular-nums">
          <caption className="sr-only">Payment schedule for {o.title}</caption>
          <thead>
            <tr className="text-left text-navy-soft">
              <th scope="col" className="py-1 font-semibold">Date</th>
              <th scope="col" className="py-1 text-right font-semibold">Payment</th>
              <th scope="col" className="py-1 text-right font-semibold">{o.method === "credit" ? "Interest" : "Fee"}</th>
              <th scope="col" className="py-1 text-right font-semibold">Owed after</th>
            </tr>
          </thead>
          <tbody>
            {o.schedule.map((p) => (
              <tr key={p.number} className={p.in_window ? "" : "text-navy-soft"}>
                <td className="py-0.5">
                  {formatShortDate(p.date)}
                  {!p.in_window && <span className="sr-only"> (after {end})</span>}
                  {p.date > scheduled && <span aria-hidden="true">*</span>}
                </td>
                <td className="py-0.5 text-right">{formatMoney(p.amount)}</td>
                <td className="py-0.5 text-right">{formatMoney(p.financing_part)}</td>
                <td className="py-0.5 text-right">{formatMoney(p.owed_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {o.schedule.some((p) => p.date > scheduled) && (
        <p className="mt-1 text-xs text-navy-soft">
          * After {formatShortDate(scheduled)}, when this demo has no rent, pay or other bills scheduled. Grey rows are
          after the comparison window ({end}).
        </p>
      )}
      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-navy-soft">
        {o.assumptions.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </details>
  );
}
