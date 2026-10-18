// The ONE place the frontend talks to the backend.
// Types mirror backend/app/schemas.py exactly. Responses are checked at runtime
// too, so a backend change shows a clear error instead of a broken page.
import { isISODate } from "./lib/dates";
import { isMoney } from "./lib/money";

export interface Account {
  id: string;
  nickname: string | null;
  type: string; // "checking" | "savings" | "credit_card" | "other"
  balance: string;
}

export interface Profile {
  profile_id: string;
  customer_id: string;
  display_name: string;
  currency: string;
  snapshot_date: string; // the real date the balances were fetched
  accounts: Account[];
  upcoming_events: unknown[]; // not used on this page; the calendar has richer events
  assumptions: string;
}

export interface CalendarEvent {
  id: string;
  date: string;
  label: string;
  amount: string; // always positive
  direction: "in" | "out";
  account_id: string;
  source: string; // "demo_history" | "demo_assumption"
  certainty: string; // "historical" | "estimated"
  period: "past" | "projected";
}

export interface DailyBalance {
  date: string;
  checking: string; // end of day
  savings: string;
}

export interface CalendarResponse {
  start_date: string;
  end_date: string;
  currency: string;
  demo_reference_date: string;
  retrieval_date: string;
  scheduled_through: string; // bills/pay are only known up to here; later days are not a full budget
  opening_balances: { checking: string; savings: string }; // start of start_date
  events: CalendarEvent[];
  daily_balances: DailyBalance[];
  lowest_checking: { date: string; balance: string };
  shortfall_dates: string[];
  summary: {
    spent_so_far: string;
    income_so_far: string;
    projected_spending: string;
    projected_income: string;
  };
  assumptions: string[];
}

// ---- POST /api/simulations (mirrors SimulationRequest / SimulationResult) ----

export type PaymentMethod = "cash" | "installments" | "credit";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["cash", "installments", "credit"];

export interface SimulationRequest {
  label: string;
  amount: string; // "600.00"; sent as text so no float rounding happens
  purchase_date: string;
  payment: PaymentMethod;
  start_date: string; // the month being shown
  end_date: string;
  installments?: { count: number; frequency: "weekly" | "biweekly" | "monthly"; fee: string };
  credit?: { apr: string; monthly_payment: string; first_payment_date: string };
  compare?: boolean;
}

export interface Comparison {
  period_start: string;
  period_end: string;
  ending_checking_before: string;
  ending_checking_after: string;
  difference: string;
  window_start: string; // purchase date
  window_end: string; // last day checked for the lowest balance (same for every method)
  lowest_before: { date: string; balance: string };
  lowest_after: { date: string; balance: string };
  outcome: "cushion" | "shortfall";
  shortfall_dates_after: string[];
}

export interface ScheduledPayment {
  number: number;
  date: string;
  amount: string;
  financing_part: string; // fee or interest inside amount
  principal_part: string;
  owed_after: string;
  in_window: boolean;
}

export interface MethodOption {
  method: PaymentMethod;
  title: string;
  terms: string;
  scenario: CalendarResponse;
  comparison: Comparison;
  paid_on_purchase_date: string; // leaves checking ON the purchase date (not later repayments)
  last_payment_date: string | null;
  payments_after_scheduled_through: boolean;
  paid_from_checking_in_period: string;
  paid_from_checking_in_window: string;
  financing_cost_paid_in_window: string;
  financing_cost_full_schedule: string;
  total_paid_full_schedule: string;
  full_schedule_complete: boolean;
  owed_at_window_end: string;
  interest_or_fees_owed_at_window_end: string;
  payoff_date: string | null;
  schedule: ScheduledPayment[];
  warnings: string[];
  assumptions: string[];
}

export interface Coverage {
  scheduled_through: string;
  window_start: string;
  window_end: string;
  window_beyond_coverage: boolean;
  not_scheduled_after: { label: string; last_scheduled: string }[];
}

export interface SimulationResult {
  purchase: CalendarEvent; // the purchase being tested (source "experiment")
  payment: string;
  baseline: CalendarResponse; // original, same Nessie snapshot
  scenario: CalendarResponse; // the selected method
  comparison: Comparison;
  assumptions: string[];
  coverage: Coverage;
  options: MethodOption[];
}

// ---- optional AI features --------------------------------------------------------

export interface AiStatus {
  explanations: boolean;
  speech: boolean;
  transcription: boolean;
  provider: string | null;
  model: string | null;
  missing: string[];
}

export interface ExplainRequest {
  simulation: SimulationRequest; // the server recalculates everything from these inputs
  selected_method: PaymentMethod;
  question: string;
  cushion: string | null;
  history: { question: string; answer: string }[]; // at most 3, oldest first
  client_tag: string; // echoed back; lets the browser ignore replies for an old scenario
}

export interface ExplainResponse {
  answer: string;
  scenario_key: string;
  client_tag: string;
  provider: string;
  model: string;
  window_start: string;
  window_end: string;
  scheduled_through: string;
}

export type ApiErrorKind = "network" | "range" | "http" | "invalid" | "unavailable";

export class ApiError extends Error {
  kind: ApiErrorKind;
  status?: number;
  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

/** GET (no body), POST JSON (plain object), or POST a FormData. Returns the raw Response after error checks. */
async function request(path: string, signal?: AbortSignal, body?: unknown, accept = "application/json"): Promise<Response> {
  const isForm = body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(path, {
      signal,
      method: body === undefined ? "GET" : "POST",
      headers: { Accept: accept, ...(body === undefined || isForm ? {} : { "Content-Type": "application/json" }) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new ApiError("network", "Could not reach the app server. Check that the frontend dev server is running.");
  }
  if (res.ok) return res;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  // Our FastAPI handlers (including request validation) reply {"error": "..."}.
  const message =
    json && typeof json === "object" && "error" in json && typeof json.error === "string" ? json.error : null;
  if (res.status === 503 && message) throw new ApiError("unavailable", message, 503);
  if (res.status === 422) {
    throw new ApiError("range", message ?? "Those dates are not supported by the backend.", 422);
  }
  if (message) throw new ApiError("http", message, res.status);
  if (res.status >= 500) {
    // No JSON body: the Vite proxy itself failed, i.e. FastAPI is not running.
    throw new ApiError(
      "network",
      "The backend is not responding. In backend/, run: .\\.venv\\Scripts\\python.exe -m uvicorn app.main:app --reload — then press Retry.",
      res.status,
    );
  }
  throw new ApiError("http", `The backend returned HTTP ${res.status} for ${path}.`, res.status);
}

async function requestJson(path: string, signal?: AbortSignal, body?: unknown): Promise<unknown> {
  const res = await request(path, signal, body);
  try {
    return await res.json();
  } catch {
    throw new ApiError("invalid", `The backend sent a response that was not JSON (${path}).`);
  }
}

// ---- tiny runtime checks ----------------------------------------------------

type Obj = Record<string, unknown>;

function fail(what: string): never {
  throw new ApiError("invalid", `Unexpected response from the backend: ${what}.`);
}
function obj(v: unknown, what: string): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : fail(`${what} should be an object`);
}
function arr(v: unknown, what: string): unknown[] {
  return Array.isArray(v) ? v : fail(`${what} should be a list`);
}
function str(o: Obj, key: string, what: string): string {
  return typeof o[key] === "string" ? (o[key] as string) : fail(`${what}.${key} should be text`);
}
function money(o: Obj, key: string, what: string): string {
  return isMoney(o[key]) ? (o[key] as string) : fail(`${what}.${key} should be a money string`);
}
function date(o: Obj, key: string, what: string): string {
  return isISODate(o[key]) ? (o[key] as string) : fail(`${what}.${key} should be YYYY-MM-DD`);
}
function oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], what: string): T {
  const v = o[key];
  return allowed.includes(v as T) ? (v as T) : fail(`${what}.${key} should be one of ${allowed.join(", ")}`);
}

export function parseProfile(raw: unknown): Profile {
  const p = obj(raw, "profile");
  return {
    profile_id: str(p, "profile_id", "profile"),
    customer_id: str(p, "customer_id", "profile"),
    display_name: str(p, "display_name", "profile"),
    currency: str(p, "currency", "profile"),
    snapshot_date: date(p, "snapshot_date", "profile"),
    accounts: arr(p.accounts, "profile.accounts").map((a, i) => {
      const o = obj(a, `account ${i}`);
      return {
        id: str(o, "id", "account"),
        nickname: typeof o.nickname === "string" ? o.nickname : null,
        type: str(o, "type", "account"),
        balance: money(o, "balance", "account"),
      };
    }),
    upcoming_events: arr(p.upcoming_events, "profile.upcoming_events"),
    assumptions: str(p, "assumptions", "profile"),
  };
}

function parseEvent(raw: unknown, what: string): CalendarEvent {
  const o = obj(raw, what);
  return {
    id: str(o, "id", "event"),
    date: date(o, "date", "event"),
    label: str(o, "label", "event"),
    amount: money(o, "amount", "event"),
    direction: oneOf(o, "direction", ["in", "out"] as const, "event"),
    account_id: str(o, "account_id", "event"),
    source: str(o, "source", "event"),
    certainty: str(o, "certainty", "event"),
    period: oneOf(o, "period", ["past", "projected"] as const, "event"),
  };
}

export function parseCalendar(raw: unknown): CalendarResponse {
  const c = obj(raw, "calendar");
  const opening = obj(c.opening_balances, "calendar.opening_balances");
  const lowest = obj(c.lowest_checking, "calendar.lowest_checking");
  const summary = obj(c.summary, "calendar.summary");
  return {
    start_date: date(c, "start_date", "calendar"),
    end_date: date(c, "end_date", "calendar"),
    currency: str(c, "currency", "calendar"),
    demo_reference_date: date(c, "demo_reference_date", "calendar"),
    retrieval_date: date(c, "retrieval_date", "calendar"),
    scheduled_through: date(c, "scheduled_through", "calendar"),
    opening_balances: {
      checking: money(opening, "checking", "opening_balances"),
      savings: money(opening, "savings", "opening_balances"),
    },
    events: arr(c.events, "calendar.events").map((e, i) => parseEvent(e, `event ${i}`)),
    daily_balances: arr(c.daily_balances, "calendar.daily_balances").map((d, i) => {
      const o = obj(d, `daily balance ${i}`);
      return {
        date: date(o, "date", "daily balance"),
        checking: money(o, "checking", "daily balance"),
        savings: money(o, "savings", "daily balance"),
      };
    }),
    lowest_checking: { date: date(lowest, "date", "lowest_checking"), balance: money(lowest, "balance", "lowest_checking") },
    shortfall_dates: arr(c.shortfall_dates, "calendar.shortfall_dates").map((d) =>
      isISODate(d) ? d : fail("shortfall_dates should contain YYYY-MM-DD dates"),
    ),
    summary: {
      spent_so_far: money(summary, "spent_so_far", "summary"),
      income_so_far: money(summary, "income_so_far", "summary"),
      projected_spending: money(summary, "projected_spending", "summary"),
      projected_income: money(summary, "projected_income", "summary"),
    },
    assumptions: arr(c.assumptions, "calendar.assumptions").map((a) =>
      typeof a === "string" ? a : fail("assumptions should be text"),
    ),
  };
}

function lowest(raw: unknown, what: string) {
  const o = obj(raw, what);
  return { date: date(o, "date", what), balance: money(o, "balance", what) };
}

function dates(v: unknown, what: string): string[] {
  return arr(v, what).map((d) => (isISODate(d) ? d : fail(`${what} should contain YYYY-MM-DD dates`)));
}
function texts(v: unknown, what: string): string[] {
  return arr(v, what).map((a) => (typeof a === "string" ? a : fail(`${what} should be text`)));
}

function parseComparison(raw: unknown): Comparison {
  const c = obj(raw, "comparison");
  return {
    period_start: date(c, "period_start", "comparison"),
    period_end: date(c, "period_end", "comparison"),
    ending_checking_before: money(c, "ending_checking_before", "comparison"),
    ending_checking_after: money(c, "ending_checking_after", "comparison"),
    difference: money(c, "difference", "comparison"),
    window_start: date(c, "window_start", "comparison"),
    window_end: date(c, "window_end", "comparison"),
    lowest_before: lowest(c.lowest_before, "comparison.lowest_before"),
    lowest_after: lowest(c.lowest_after, "comparison.lowest_after"),
    outcome: oneOf(c, "outcome", ["cushion", "shortfall"] as const, "comparison"),
    shortfall_dates_after: dates(c.shortfall_dates_after, "comparison.shortfall_dates_after"),
  };
}

function parseOption(raw: unknown, i: number): MethodOption {
  const o = obj(raw, `option ${i}`);
  const what = "option";
  return {
    method: oneOf(o, "method", PAYMENT_METHODS, what),
    title: str(o, "title", what),
    terms: str(o, "terms", what),
    scenario: parseCalendar(o.scenario),
    comparison: parseComparison(o.comparison),
    paid_on_purchase_date: money(o, "paid_on_purchase_date", what),
    last_payment_date: o.last_payment_date === null ? null : date(o, "last_payment_date", what),
    payments_after_scheduled_through:
      typeof o.payments_after_scheduled_through === "boolean"
        ? o.payments_after_scheduled_through
        : fail("option.payments_after_scheduled_through should be true/false"),
    paid_from_checking_in_period: money(o, "paid_from_checking_in_period", what),
    paid_from_checking_in_window: money(o, "paid_from_checking_in_window", what),
    financing_cost_paid_in_window: money(o, "financing_cost_paid_in_window", what),
    financing_cost_full_schedule: money(o, "financing_cost_full_schedule", what),
    total_paid_full_schedule: money(o, "total_paid_full_schedule", what),
    full_schedule_complete: typeof o.full_schedule_complete === "boolean" ? o.full_schedule_complete : fail("option.full_schedule_complete should be true/false"),
    owed_at_window_end: money(o, "owed_at_window_end", what),
    interest_or_fees_owed_at_window_end: money(o, "interest_or_fees_owed_at_window_end", what),
    payoff_date: o.payoff_date === null ? null : date(o, "payoff_date", what),
    schedule: arr(o.schedule, "option.schedule").map((p, j) => {
      const s = obj(p, `payment ${j}`);
      return {
        number: typeof s.number === "number" ? s.number : fail("payment.number should be a number"),
        date: date(s, "date", "payment"),
        amount: money(s, "amount", "payment"),
        financing_part: money(s, "financing_part", "payment"),
        principal_part: money(s, "principal_part", "payment"),
        owed_after: money(s, "owed_after", "payment"),
        in_window: s.in_window === true,
      };
    }),
    warnings: texts(o.warnings, "option.warnings"),
    assumptions: texts(o.assumptions, "option.assumptions"),
  };
}

export function parseSimulation(raw: unknown): SimulationResult {
  const s = obj(raw, "simulation");
  const cov = obj(s.coverage, "simulation.coverage");
  return {
    purchase: parseEvent(s.purchase, "simulation.purchase"),
    payment: str(s, "payment", "simulation"),
    baseline: parseCalendar(s.baseline),
    scenario: parseCalendar(s.scenario),
    comparison: parseComparison(s.comparison),
    assumptions: texts(s.assumptions, "simulation.assumptions"),
    coverage: {
      scheduled_through: date(cov, "scheduled_through", "coverage"),
      window_start: date(cov, "window_start", "coverage"),
      window_end: date(cov, "window_end", "coverage"),
      window_beyond_coverage: cov.window_beyond_coverage === true,
      not_scheduled_after: arr(cov.not_scheduled_after, "coverage.not_scheduled_after").map((m, i) => {
        const o = obj(m, `missing item ${i}`);
        return { label: str(o, "label", "missing item"), last_scheduled: date(o, "last_scheduled", "missing item") };
      }),
    },
    options: arr(s.options, "simulation.options").map(parseOption),
  };
}

export async function fetchProfile(signal?: AbortSignal): Promise<Profile> {
  return parseProfile(await requestJson("/api/profile", signal));
}

/** With no dates, the backend uses its default range (which tells us the demo reference date). */
export async function fetchCalendar(
  range?: { start: string; end: string },
  signal?: AbortSignal,
): Promise<CalendarResponse> {
  const query = range ? `?${new URLSearchParams({ start_date: range.start, end_date: range.end })}` : "";
  return parseCalendar(await requestJson(`/api/calendar${query}`, signal));
}

/** Preview one hypothetical purchase. Nothing is saved and no money moves. */
export async function postSimulation(req: SimulationRequest, signal?: AbortSignal): Promise<SimulationResult> {
  return parseSimulation(await requestJson("/api/simulations", signal, req));
}

export async function fetchAiStatus(signal?: AbortSignal): Promise<AiStatus> {
  const s = obj(await requestJson("/api/ai/status", signal), "ai status");
  return {
    explanations: s.explanations === true,
    speech: s.speech === true,
    transcription: s.transcription === true,
    provider: typeof s.provider === "string" ? s.provider : null,
    model: typeof s.model === "string" ? s.model : null,
    missing: texts(s.missing, "ai status.missing"),
  };
}

export async function postExplain(req: ExplainRequest, signal?: AbortSignal): Promise<ExplainResponse> {
  const r = obj(await requestJson("/api/explain", signal, req), "explanation");
  return {
    answer: str(r, "answer", "explanation"),
    scenario_key: str(r, "scenario_key", "explanation"),
    client_tag: str(r, "client_tag", "explanation"),
    provider: str(r, "provider", "explanation"),
    model: str(r, "model", "explanation"),
    window_start: date(r, "window_start", "explanation"),
    window_end: date(r, "window_end", "explanation"),
    scheduled_through: date(r, "scheduled_through", "explanation"),
  };
}

/** Audio (MP3) for exactly the text shown on screen. */
export async function postSpeech(text: string, clientTag: string, signal?: AbortSignal): Promise<Blob> {
  const res = await request("/api/speech", signal, { text, client_tag: clientTag }, "audio/mpeg");
  if ((res.headers.get("X-Client-Tag") ?? "") !== clientTag) throw new ApiError("invalid", "Audio arrived for a different answer.");
  return res.blob();
}

export async function postTranscribe(audio: Blob, filename: string, clientTag: string, signal?: AbortSignal): Promise<string> {
  const form = new FormData();
  form.append("file", audio, filename);
  form.append("client_tag", clientTag);
  const r = obj(await requestJson("/api/transcribe", signal, form), "transcript");
  if (str(r, "client_tag", "transcript") !== clientTag) throw new ApiError("invalid", "Transcript arrived for a different request.");
  return str(r, "text", "transcript");
}
