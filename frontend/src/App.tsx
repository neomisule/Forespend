import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ApiError,
  fetchAiStatus,
  fetchCalendar,
  fetchProfile,
  postSimulation,
  type AiStatus,
  type CalendarResponse,
  type PaymentMethod,
  type Profile,
  type SimulationRequest,
  type SimulationResult,
} from "./api";
import { DayDetails } from "./components/DayDetails";
import { EMPTY_DRAFT, ExperimentPanel, type Draft, type Experiment, type SimState } from "./components/ExperimentPanel";
import { ListView } from "./components/ListView";
import { MonthGrid } from "./components/MonthGrid";
import { MonthTotals } from "./components/MonthTotals";
import GameLearningApp, { type LessonPreset } from "./learning/GameLearningApp";
import { buildDays } from "./lib/calendarModel";
import {
  addMonths,
  datesInMonth,
  firstDay,
  formatMonthTitle,
  formatShortDate,
  lastDay,
  monthKey,
  monthOf,
  sameMonth,
  todayISO,
  type YearMonth,
} from "./lib/dates";
import { formatMoney } from "./lib/money";

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiError };

// Space kept under the calendar grid (month totals + card and page padding), in px.
const RESERVE_BELOW_GRID = 84;

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError("invalid", "Something unexpected went wrong.");
}

type MainView = "calendar" | "learn";

/**
 * Two sections: the money calendar and the Learn lessons. Both stay mounted
 * (the inactive one is hidden) so switching never loses your experiment,
 * loaded months, or lesson progress.
 */
export default function App() {
  const [view, setView] = useState<MainView>("calendar");
  const [lessonPreset, setLessonPreset] = useState<LessonPreset | null>(null);

  return (
    <>
      <div hidden={view !== "calendar"}>
        <CalendarApp
          viewMenu={<ViewMenu view={view} onView={setView} />}
          lessonPreset={lessonPreset}
          onPresetUsed={() => setLessonPreset(null)}
        />
      </div>
      <div hidden={view !== "learn"} className="min-h-dvh bg-sky-page font-sans text-navy">
        <header className="relative z-30 mx-auto flex max-w-7xl flex-wrap items-center gap-3 px-4 py-2.5 sm:px-6">
          <p className="font-display text-xl font-semibold tracking-tight">
            Money <span className="text-accent">Calendar</span>
          </p>
          <div className="ml-auto">
            <ViewMenu view={view} onView={setView} />
          </div>
        </header>
        <GameLearningApp
          onTryInCalendar={(preset) => {
            setLessonPreset(preset);
            setView("calendar");
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
    </>
  );
}

function ViewMenu({ view, onView }: { view: MainView; onView: (view: MainView) => void }) {
  return (
    <nav aria-label="Main sections" className="flex rounded-full bg-white p-1 shadow-soft">
      {([
        ["calendar", "Calendar"],
        ["learn", "Learn"],
      ] as const).map(([value, label]) => (
        <button
          key={value}
          type="button"
          aria-current={view === value ? "page" : undefined}
          onClick={() => onView(value)}
          className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${
            view === value ? "bg-accent text-white" : "text-navy-soft hover:bg-accent-soft hover:text-navy"
          }`}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}

function CalendarApp({
  viewMenu,
  lessonPreset,
  onPresetUsed,
}: {
  viewMenu: ReactNode;
  lessonPreset: LessonPreset | null; // set by a Learn lesson's "Try this in your calendar"
  onPresetUsed: () => void;
}) {
  // ---- profile: name + fetched account balances (never changed by a preview) ----
  const [profile, setProfile] = useState<Load<Profile>>({ status: "loading" });
  const [profileAttempt, setProfileAttempt] = useState(0);
  useEffect(() => {
    const ac = new AbortController();
    setProfile({ status: "loading" });
    fetchProfile(ac.signal)
      .then((data) => setProfile({ status: "ready", data }))
      .catch((err) => !ac.signal.aborted && setProfile({ status: "error", error: toApiError(err) }));
    return () => ac.abort();
  }, [profileAttempt]);

  // ---- original calendar, one month at a time ------------------------------------
  const calendarCache = useRef(new Map<string, CalendarResponse>());
  const [referenceDate, setReferenceDate] = useState<string | null>(null);
  const [month, setMonth] = useState<YearMonth | null>(null);
  const [calendar, setCalendar] = useState<Load<CalendarResponse>>({ status: "loading" });
  const [calendarAttempt, setCalendarAttempt] = useState(0);

  useEffect(() => {
    const ac = new AbortController();
    setCalendar({ status: "loading" });
    const run = async () => {
      if (month === null) {
        // First load: ask with the backend's default range to learn the demo day, then open its month.
        const first = await fetchCalendar(undefined, ac.signal);
        const ym = monthOf(first.demo_reference_date);
        if (first.start_date === firstDay(ym) && first.end_date === lastDay(ym)) {
          calendarCache.current.set(monthKey(ym), first);
        }
        setReferenceDate(first.demo_reference_date);
        setMonth(ym);
        return;
      }
      const key = monthKey(month);
      const data =
        calendarCache.current.get(key) ?? (await fetchCalendar({ start: firstDay(month), end: lastDay(month) }, ac.signal));
      calendarCache.current.set(key, data);
      setCalendar({ status: "ready", data });
    };
    run().catch((err) => !ac.signal.aborted && setCalendar({ status: "error", error: toApiError(err) }));
    return () => ac.abort();
  }, [month, calendarAttempt]);

  // Only trust calendar data that belongs to the month on screen.
  const originalForMonth =
    calendar.status === "ready" && month && calendar.data.start_date === firstDay(month) ? calendar.data : null;

  // ---- the purchase experiment ------------------------------------------------------
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  // Which compared option the calendar shows. Switching needs no new request.
  const [selectedMethod, setSelectedMethod] = useState<PaymentMethod>("cash");
  const [scenarioView, setScenarioView] = useState<"with" | "original">("with");
  const simCache = useRef(new Map<string, SimulationResult>());
  const [sim, setSim] = useState<{ key: string; state: SimState } | null>(null);
  const [simAttempt, setSimAttempt] = useState(0);

  // One key per (experiment, month). Results are only shown when their key matches,
  // so an old or failed result can never be labelled as the current one.
  const simKey = experiment && month ? JSON.stringify([experiment, monthKey(month)]) : null;
  // The exact request for this experiment + month; also handed to the assistant so the
  // server can recalculate from the same inputs.
  const simRequest = useMemo<SimulationRequest | null>(
    () =>
      experiment && month
        ? {
            label: experiment.label,
            amount: experiment.amount,
            purchase_date: experiment.purchaseDate,
            payment: experiment.method,
            start_date: firstDay(month),
            end_date: lastDay(month),
            installments: experiment.installments,
            credit: experiment.credit,
            compare: true, // all three methods, one Nessie snapshot
          }
        : null,
    [experiment, month],
  );

  // Which optional AI features the server has keys for (never the keys themselves).
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchAiStatus(ac.signal)
      .then(setAiStatus)
      .catch(() => !ac.signal.aborted && setAiStatus({ explanations: false, speech: false, transcription: false, provider: null, model: null, missing: [] }));
    return () => ac.abort();
  }, []);

  useEffect(() => {
    if (!experiment || !month || !simKey || calendar.status === "error") return;
    const cached = simCache.current.get(simKey);
    if (cached) {
      setSim({ key: simKey, state: { status: "ready", data: cached } });
      return;
    }
    const ac = new AbortController();
    setSim({ key: simKey, state: { status: "loading" } });
    postSimulation(simRequest!, ac.signal)
      .then((data) => {
        simCache.current.set(simKey, data);
        setSim({ key: simKey, state: { status: "ready", data } });
      })
      .catch((err) => !ac.signal.aborted && setSim({ key: simKey, state: { status: "error", error: toApiError(err) } }));
    return () => ac.abort();
    // From the calendar we only need "can this month be shown at all?"
  }, [simKey, simAttempt, calendar.status === "error"]);

  const simState: SimState | null = experiment ? (sim && sim.key === simKey ? sim.state : { status: "loading" }) : null;
  const simResult = simState?.status === "ready" ? simState.data : null;

  const startExperiment = useCallback((e: Experiment) => {
    simCache.current.clear(); // a new preview always fetches fresh numbers
    setScenarioView("with");
    setSelectedMethod(e.method);
    setExperiment(e);
  }, []);
  const editExperiment = useCallback(() => setExperiment(null), []); // draft still holds the values
  const clearExperiment = useCallback(() => {
    setExperiment(null);
    setDraft(EMPTY_DRAFT);
  }, []);

  // ---- what the calendar shows -----------------------------------------------------------
  const selectedOption = simResult?.options.find((o) => o.method === selectedMethod) ?? simResult?.options[0];
  const showingExperiment = !!selectedOption && scenarioView === "with";
  const shown: CalendarResponse | null = simResult
    ? showingExperiment
      ? selectedOption!.scenario
      : simResult.baseline
    : originalForMonth;
  // Changes whenever different numbers are shown, so the calendar can play a short "updated" fade.
  const shownKey = `${simKey ?? "original"}|${showingExperiment ? selectedOption!.method : "original"}`;

  const today = todayISO();
  const days = useMemo(
    () => (shown ? buildDays(shown, today, showingExperiment ? simResult!.baseline : undefined) : new Map()),
    [shown, today, showingExperiment, simResult],
  );
  const monthBeyondSchedule = !!shown && shown.end_date > shown.scheduled_through;

  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [selected, setSelected] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);

  const retryAll = useCallback(() => {
    setProfileAttempt((n) => n + 1);
    setCalendarAttempt((n) => n + 1);
  }, []);

  // "Try this in your calendar" from a Learn lesson: prefill the form with the lesson's
  // purchase and card terms, then let the user press Compare (nothing runs automatically).
  useEffect(() => {
    if (!lessonPreset) return;
    setExperiment(null);
    setDraft({
      ...EMPTY_DRAFT,
      label: lessonPreset.label,
      amount: lessonPreset.amount,
      method: "credit",
      apr: lessonPreset.apr,
      monthlyPayment: lessonPreset.monthlyPayment,
    });
    setFocusRequest((n) => n + 1);
    onPresetUsed();
  }, [lessonPreset, onPresetUsed]);

  const referenceMonth = referenceDate ? monthOf(referenceDate) : null;
  const selectedDay = selected ? days.get(selected) : undefined;
  const monthTitle = month ? formatMonthTitle(month) : null;

  return (
    <div className="min-h-dvh bg-sky-page font-sans text-navy">
      {/* One compact top bar: name, balances, main action. */}
      <header className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Money <span className="text-accent">Calendar</span>
        </h1>
        <AccountStrip profile={profile} onRetry={retryAll} />
        <div className="ml-auto flex items-center gap-2">
          {viewMenu}
          <button
            type="button"
            onClick={() => setFocusRequest((n) => n + 1)}
            className="rounded-full bg-accent px-5 py-2 font-semibold text-white shadow-soft hover:bg-accent-strong"
          >
            Try a purchase
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 pb-4 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          {/* First in the page order, so on phones the experiment sits above the calendar.
              On wide screens it scrolls on its own so the calendar can stay fully in view. */}
          <ScrollPanel>
            <aside aria-label="Purchase experiment">
            <ExperimentPanel
              referenceDate={referenceDate}
              monthTitle={monthTitle}
              draft={draft}
              onDraftChange={setDraft}
              experiment={experiment}
              sim={simState}
              selectedMethod={selectedMethod}
              onSelectMethod={setSelectedMethod}
              simRequest={simRequest}
              simKey={simKey}
              aiStatus={aiStatus}
              calendarUnavailable={calendar.status === "error"}
              focusRequest={focusRequest}
              onPreview={startExperiment}
              onEdit={editExperiment}
              onClear={clearExperiment}
              onRetry={() => setSimAttempt((n) => n + 1)}
            />
            </aside>
          </ScrollPanel>

          <section
            aria-labelledby="month-title"
            className="min-w-0 rounded-3xl bg-white p-3 shadow-soft sm:p-4 lg:col-start-1 lg:row-start-1"
          >
            <Toolbar
              month={month}
              referenceMonth={referenceMonth}
              view={view}
              onView={setView}
              onMonth={setMonth}
              scenarioAvailable={!!selectedOption}
              scenarioLabel={selectedOption ? `With ${selectedOption.title.toLowerCase()}` : "With purchase"}
              scenarioView={scenarioView}
              onScenarioView={setScenarioView}
            />
            {experiment && !simResult && calendar.status !== "error" && (
              <p role="status" className="mt-2 text-xs text-navy-soft">
                {simState?.status === "error"
                  ? "Showing the original calendar: the comparison for this month couldn’t be calculated."
                  : "Running the numbers… showing the original calendar for now."}
              </p>
            )}
            <Legend
              referenceDate={referenceDate}
              showingExperiment={showingExperiment}
              scheduledThrough={monthBeyondSchedule && shown ? shown.scheduled_through : null}
            />

            <div key={shownKey} className="mt-2 motion-safe:animate-refresh" aria-busy={calendar.status === "loading"}>
              {calendar.status === "error" ? (
                <ErrorPanel
                  error={calendar.error}
                  monthTitle={monthTitle}
                  referenceMonth={referenceMonth}
                  onRetry={retryAll}
                  onBack={() => referenceMonth && setMonth(referenceMonth)}
                />
              ) : !shown || !month ? (
                <p role="status" className="rounded-xl bg-sky-page p-6 text-center text-sm font-medium">
                  Loading {monthTitle ?? "calendar"}…
                </p>
              ) : (
                <>
                  {view === "calendar" ? (
                    <>
                      {/* Seven columns don't fit a phone, so small screens get the list. */}
                      <div className="hidden md:block">
                        <MonthGrid month={month} days={days} onOpenDay={setSelected} reserveBelow={RESERVE_BELOW_GRID} />
                      </div>
                      <div className="md:hidden">
                        <ListView dates={datesInMonth(month)} days={days} onOpenDay={setSelected} />
                      </div>
                    </>
                  ) : (
                    <ListView dates={datesInMonth(month)} days={days} onOpenDay={setSelected} />
                  )}
                  <MonthTotals
                    calendar={shown}
                    label={`${monthTitle}${simResult ? (showingExperiment ? `, with ${selectedOption!.title.toLowerCase()}` : ", original") : ""}`}
                  />
                </>
              )}
            </div>
          </section>
        </div>
      </main>

      {selectedDay && referenceDate && (
        <DayDetails
          day={selectedDay}
          referenceDate={referenceDate}
          showingExperiment={showingExperiment}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ---- small page pieces -------------------------------------------------------------

/**
 * On wide screens: a sticky panel with its own scrollbar, plus a "More below"
 * cue while there is hidden content. Elsewhere it is an ordinary block, so the
 * page scrolls normally (small screens, zoomed-in text).
 */
function ScrollPanel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, []);
  return (
    <div className="relative lg:sticky lg:top-3 lg:col-start-2 lg:row-start-1">
      <div
        ref={ref}
        // `relative` keeps absolutely positioned bits (like screen-reader-only text) inside the
        // scroll box; otherwise they escape it and make the whole page taller.
        className="relative rounded-3xl bg-white p-5 shadow-soft lg:max-h-[calc(100dvh-5rem)] lg:overflow-y-auto lg:overscroll-contain"
      >
        {children}
      </div>
      {more && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-14 items-end justify-center rounded-b-3xl bg-gradient-to-t from-white via-white/90 to-transparent pb-1.5 lg:flex"
        >
          <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-semibold text-accent-strong">More below ↓</span>
        </div>
      )}
    </div>
  );
}

function AccountStrip({ profile, onRetry }: { profile: Load<Profile>; onRetry: () => void }) {
  if (profile.status === "error") {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
        <strong className="text-red-800">Couldn’t load balances.</strong>
        <span className="text-navy-soft">{profile.error.message}</span>
        <button type="button" onClick={onRetry} className="rounded-full bg-accent px-3 py-0.5 font-semibold text-white">
          Retry
        </button>
      </div>
    );
  }
  const checking = profile.status === "ready" ? profile.data.accounts.find((a) => a.type === "checking") : undefined;
  const savings = profile.status === "ready" ? profile.data.accounts.find((a) => a.type === "savings") : undefined;
  return (
    <section aria-label="Account balances">
      {profile.status === "loading" ? (
        <p role="status" className="text-sm text-navy-soft">
          Loading balances…
        </p>
      ) : (
        <dl className="flex flex-wrap gap-2">
          <div className="flex items-baseline gap-1.5 rounded-full bg-white px-3 py-1 shadow-soft">
            <dt className="text-sm text-navy-soft">Checking</dt>
            <dd className="font-display font-semibold tabular-nums">{checking ? formatMoney(checking.balance) : "None"}</dd>
          </div>
          <div className="flex items-baseline gap-1.5 rounded-full bg-white px-3 py-1 shadow-soft">
            <dt className="text-sm text-navy-soft">Savings</dt>
            <dd className="font-display font-semibold tabular-nums">{savings ? formatMoney(savings.balance) : "None"}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

interface ToolbarProps {
  month: YearMonth | null;
  referenceMonth: YearMonth | null;
  view: "calendar" | "list";
  onView: (v: "calendar" | "list") => void;
  onMonth: (m: YearMonth) => void;
  scenarioAvailable: boolean;
  scenarioLabel: string;
  scenarioView: "with" | "original";
  onScenarioView: (v: "with" | "original") => void;
}

function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { value: T; text: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-full bg-sky-page p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-full px-3 py-1 text-sm font-semibold motion-safe:transition ${
            value === o.value ? "bg-white text-navy shadow-soft" : "text-navy-soft hover:text-navy"
          }`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

function Toolbar(p: ToolbarProps) {
  const navButton =
    "grid size-9 place-items-center rounded-full bg-surface-soft text-lg font-bold hover:bg-accent-soft disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={navButton} aria-label="Previous month" disabled={!p.month} onClick={() => p.month && p.onMonth(addMonths(p.month, -1))}>
          ‹
        </button>
        <button type="button" className={navButton} aria-label="Next month" disabled={!p.month} onClick={() => p.month && p.onMonth(addMonths(p.month, 1))}>
          ›
        </button>
        <h2 id="month-title" className="ml-1 font-display text-xl font-semibold">
          {p.month ? formatMonthTitle(p.month) : "Money calendar"}
        </h2>
        {p.month && p.referenceMonth && !sameMonth(p.month, p.referenceMonth) && (
          <button
            type="button"
            onClick={() => p.onMonth(p.referenceMonth!)}
            className="rounded-lg px-2 py-1 text-sm font-semibold text-accent underline hover:bg-accent-soft"
          >
            Back to {formatMonthTitle(p.referenceMonth)}
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {p.scenarioAvailable && (
          <Segmented
            label="Show calendar"
            options={[
              { value: "original", text: "Original" },
              { value: "with", text: p.scenarioLabel },
            ]}
            value={p.scenarioView}
            onChange={p.onScenarioView}
          />
        )}
        <Segmented
          label="Layout"
          options={[
            { value: "calendar", text: "Calendar" },
            { value: "list", text: "List" },
          ]}
          value={p.view}
          onChange={p.onView}
        />
      </div>
    </div>
  );
}

function Legend({
  referenceDate,
  showingExperiment,
  scheduledThrough,
}: {
  referenceDate: string | null;
  showingExperiment: boolean;
  scheduledThrough: string | null;
}) {
  return (
    <ul aria-label="How to read the calendar" className="mt-1.5 flex flex-wrap gap-x-3.5 gap-y-0.5 text-xs text-navy-soft">
      <li>
        Amount = <strong className="text-navy">checking at end of day</strong>
      </li>
      <li>
        <strong className="text-navy">≈</strong> projected
      </li>
      {referenceDate && (
        <li>
          <span className="font-semibold text-accent underline decoration-2 underline-offset-2">Blue date</span> = demo day (
          {formatShortDate(referenceDate).replace(/, \d{4}$/, "")}) ·{" "}
          <span className="rounded-full px-1 ring-1 ring-navy-soft">circled</span> = today
        </li>
      )}
      {scheduledThrough && (
        <li>
          <span className="rounded bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(20_26_58/0.12)_4px_6px)] px-1">
            striped
          </span>{" "}
          = no bills or pay known after {formatShortDate(scheduledThrough).replace(/, \d{4}$/, "")} (not a full budget)
        </li>
      )}
      <li>
        <strong className="text-emerald-800">+</strong> in · <strong className="text-rose-800">−</strong> out ·{" "}
        <span className="rounded border border-dashed border-navy-soft px-0.5">dashed</span> = estimate
      </li>
      {showingExperiment && (
        <li>
          <strong className="text-lilac">Try:</strong> your purchase’s payments · <strong className="text-lilac">▼</strong>{" "}
          lower because of it
        </li>
      )}
      <li>⚠ below $0.00</li>
    </ul>
  );
}

function ErrorPanel({
  error,
  monthTitle,
  referenceMonth,
  onRetry,
  onBack,
}: {
  error: ApiError;
  monthTitle: string | null;
  referenceMonth: YearMonth | null;
  onRetry: () => void;
  onBack: () => void;
}) {
  if (error.kind === "range") {
    return (
      <div role="alert" className="rounded-2xl bg-surface-soft p-6 text-center">
        <p className="font-bold">{monthTitle ?? "This month"} isn’t available in the demo.</p>
        <p className="mt-1 text-sm text-navy-soft">The backend says: {error.message}</p>
        {referenceMonth && (
          <button type="button" onClick={onBack} className="mt-3 rounded-full bg-accent px-5 py-2 font-semibold text-white">
            Back to {formatMonthTitle(referenceMonth)}
          </button>
        )}
      </div>
    );
  }
  return (
    <div role="alert" className="rounded-2xl bg-red-50 p-6 text-center">
      <p className="font-bold text-red-900">
        {error.kind === "network" ? "Can’t connect to the backend." : "The calendar couldn’t be loaded."}
      </p>
      <p className="mt-1 text-sm text-red-900">{error.message}</p>
      <button type="button" onClick={onRetry} className="mt-3 rounded-full bg-accent px-5 py-2 font-semibold text-white">
        Retry
      </button>
    </div>
  );
}
