import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import {
  ApiError,
  fetchAiStatus,
  fetchCalendar,
  fetchProfile,
  postInvestment,
  postSimulation,
  type AiStatus,
  type CalendarResponse,
  type InvestmentRequest,
  type InvestmentResult,
  type PaymentMethod,
  type Profile,
  type SimulationRequest,
  type SimulationResult,
} from "./api";
import { InvestingApp } from "./components/InvestingApp";
import { AssistantDrawer } from "./components/AssistantDrawer";
import { DayDetails } from "./components/DayDetails";
import { EMPTY_DRAFT, ExperimentPanel, type Draft, type Experiment, type SimState } from "./components/ExperimentPanel";
import { ListView } from "./components/ListView";
import { MonthGrid } from "./components/MonthGrid";
import { MonthTotals } from "./components/MonthTotals";
import GameLearningApp, { type InvestingPreset, type LessonPreset } from "./learning/GameLearningApp";
import { NO_CONTEXT, scenarioTag, type AssistantContext } from "./lib/assistant";
import { buildDays, type PreviewKind } from "./lib/calendarModel";
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
import { balancesFitGrid } from "./lib/layout";
import { formatMoney } from "./lib/money";

type Load<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: ApiError };

// Space kept under the calendar grid (month totals + card and page padding), in px.
const RESERVE_BELOW_GRID = 92;

function toApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError("invalid", "Something unexpected went wrong.");
}

type MainView = "calendar" | "learn" | "investing";
const SECTIONS: { id: MainView; label: string; ready: boolean }[] = [
  { id: "calendar", label: "Calendar", ready: true },
  { id: "learn", label: "Learn", ready: true },
  { id: "investing", label: "Investing", ready: true },
];

/**
 * One app, one header. The sections stay mounted (the inactive ones are hidden)
 * so switching never loses your experiment, loaded months, or lesson progress.
 * The assistant drawer is shared by every section.
 */
export default function App() {
  const [view, setView] = useState<MainView>("calendar");
  const [lessonPreset, setLessonPreset] = useState<LessonPreset | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [calendarContext, setCalendarContext] = useState<AssistantContext>(NO_CONTEXT);
  const [investingContext, setInvestingContext] = useState<AssistantContext>(NO_CONTEXT);
  const [investingPreset, setInvestingPreset] = useState<InvestingPreset | null>(null);
  // The demo day, learned by the calendar on its first load; the investing form uses it for date limits.
  const [referenceDate, setReferenceDate] = useState<string | null>(null);
  // An investing plan the calendar previews as transfers (set by "Preview on calendar").
  const [investmentPlan, setInvestmentPlan] = useState<InvestmentRequest | null>(null);
  const onInvestingResult = useCallback((request: InvestmentRequest | null, result: InvestmentResult | null) => {
    setInvestingContext(request && result ? { kind: "investment", request, result, tag: `invest-${result.plan_key}` } : NO_CONTEXT);
  }, []);
  // The assistant talks about the section you are in; Learn borrows the calendar's context.
  const assistantContext = view === "investing" ? investingContext : calendarContext;

  // Which optional AI features the server has keys for (never the keys themselves).
  const [aiStatus, setAiStatus] = useState<AiStatus | null>(null);
  useEffect(() => {
    const ac = new AbortController();
    fetchAiStatus(ac.signal)
      .then(setAiStatus)
      .catch(() => !ac.signal.aborted && setAiStatus({ explanations: false, speech: false, transcription: false, provider: null, model: null, missing: [] }));
    return () => ac.abort();
  }, []);

  const openAssistant = useCallback(() => setAssistantOpen(true), []);
  // The calendar renders its balances + "Try a purchase" into this header slot (portal), so the
  // header stays one bar for every section without the calendar needing a second strip.
  const [headerSlot, setHeaderSlot] = useState<HTMLDivElement | null>(null);

  return (
    <div className="min-h-dvh font-sans text-navy">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 sm:px-6">
        <p className="flex items-center gap-2.5 font-display text-lg font-bold">
          <span aria-hidden="true" className="lab-brand-tile">
            F
          </span>
          Forespend
        </p>
        <nav aria-label="Main sections" className="flex rounded-full border-2 border-line bg-white p-1 shadow-soft">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-current={view === s.id ? "page" : undefined}
              disabled={!s.ready}
              title={s.ready ? undefined : "Coming soon"}
              onClick={() => setView(s.id)}
              className={`rounded-full px-4 py-1.5 text-sm font-bold motion-safe:transition disabled:opacity-40 ${
                view === s.id ? "bg-accent-bright text-white" : "text-navy-soft hover:bg-accent-soft hover:text-navy"
              }`}
            >
              {s.label}
              {!s.ready && <span className="sr-only"> (coming soon)</span>}
            </button>
          ))}
        </nav>
        <div ref={setHeaderSlot} hidden={view !== "calendar"} className="flex flex-wrap items-center gap-x-3 gap-y-2" />
        <button type="button" onClick={openAssistant} aria-haspopup="dialog" className="lab-button ml-auto !py-2">
          <span aria-hidden="true">🎤</span> Ask about my money
        </button>
      </header>

      <div hidden={view !== "calendar"}>
        <CalendarApp
          headerSlot={headerSlot}
          lessonPreset={lessonPreset}
          onPresetUsed={() => setLessonPreset(null)}
          onAssistantContext={setCalendarContext}
          onExplain={openAssistant}
          investmentPlan={investmentPlan}
          onReferenceDate={setReferenceDate}
        />
      </div>
      <div hidden={view !== "learn"}>
        <GameLearningApp
          onTryInCalendar={(preset) => {
            setLessonPreset(preset);
            setView("calendar");
            window.scrollTo({ top: 0 });
          }}
          onTryInvesting={(preset) => {
            setInvestingPreset(preset);
            setView("investing");
            window.scrollTo({ top: 0 });
          }}
        />
      </div>
      <div hidden={view !== "investing"}>
        <InvestingApp
          referenceDate={referenceDate}
          preset={investingPreset}
          onPresetUsed={() => setInvestingPreset(null)}
          onResult={onInvestingResult}
          onExplain={openAssistant}
          onPreviewOnCalendar={(request) => {
            setInvestmentPlan(request);
            setView("calendar");
            window.scrollTo({ top: 0 });
          }}
        />
      </div>

      <AssistantDrawer open={assistantOpen} onClose={() => setAssistantOpen(false)} context={assistantContext} aiStatus={aiStatus} />
    </div>
  );
}

function CalendarApp({
  headerSlot,
  lessonPreset,
  onPresetUsed,
  onAssistantContext,
  onExplain,
  investmentPlan,
  onReferenceDate,
}: {
  headerSlot: HTMLDivElement | null; // where the balances + "Try a purchase" go (inside the shared header)
  lessonPreset: LessonPreset | null; // set by a Learn lesson's "Try this in your calendar"
  onPresetUsed: () => void;
  onAssistantContext: (ctx: AssistantContext) => void; // what the shared assistant may talk about
  onExplain: () => void; // opens the shared assistant
  investmentPlan: InvestmentRequest | null; // contributions to preview as transfers out of checking
  onReferenceDate: (d: string) => void; // reports the demo day once known
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
        onReferenceDate(first.demo_reference_date);
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
  // Which scenario the calendar shows. A purchase and an investing plan are never combined:
  // the user switches between them explicitly in the toolbar.
  const [scenarioView, setScenarioView] = useState<ScenarioView>("with");

  // ---- the investing plan on the calendar (one request per plan + month) ------------------
  const investCache = useRef(new Map<string, InvestmentResult>());
  const [invest, setInvest] = useState<{ key: string; state: Load<InvestmentResult> } | null>(null);
  const investKey = investmentPlan && month ? JSON.stringify([investmentPlan, monthKey(month)]) : null;
  useEffect(() => {
    if (!investmentPlan || !month || !investKey || calendar.status === "error") return;
    const cached = investCache.current.get(investKey);
    if (cached) {
      setInvest({ key: investKey, state: { status: "ready", data: cached } });
      return;
    }
    const ac = new AbortController();
    setInvest({ key: investKey, state: { status: "loading" } });
    postInvestment({ ...investmentPlan, calendar_start: firstDay(month), calendar_end: lastDay(month) }, ac.signal)
      .then((data) => {
        investCache.current.set(investKey, data);
        setInvest({ key: investKey, state: { status: "ready", data } });
      })
      .catch((err) => !ac.signal.aborted && setInvest({ key: investKey, state: { status: "error", error: toApiError(err) } }));
    return () => ac.abort();
  }, [investKey, calendar.status === "error"]); // eslint-disable-line react-hooks/exhaustive-deps
  const investResult = invest && invest.key === investKey && invest.state.status === "ready" ? invest.state.data : null;
  // A newly previewed plan is shown right away (explicit choice from the Investing screen).
  useEffect(() => {
    if (investmentPlan) setScenarioView("invest");
  }, [investmentPlan]);
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
  const selectMethod = useCallback((m: PaymentMethod) => {
    setSelectedMethod(m);
    setScenarioView("with"); // the panel promises to show the picked option on the calendar
  }, []);
  const editExperiment = useCallback(() => setExperiment(null), []); // draft still holds the values
  const clearExperiment = useCallback(() => {
    setExperiment(null);
    setDraft(EMPTY_DRAFT);
  }, []);

  // ---- what the calendar shows -----------------------------------------------------------
  const selectedOption = simResult?.options.find((o) => o.method === selectedMethod) ?? simResult?.options[0];
  const showingExperiment = !!selectedOption && scenarioView === "with";
  const showingInvest = scenarioView === "invest" && !!investResult?.scenario;
  const shown: CalendarResponse | null = showingInvest
    ? investResult!.scenario
    : simResult
      ? showingExperiment
        ? selectedOption!.scenario
        : simResult.baseline
      : originalForMonth;
  const shownOriginal = showingInvest ? investResult!.baseline! : showingExperiment ? simResult!.baseline : undefined;
  const shownLabel = showingInvest ? "with investing" : showingExperiment ? `with ${selectedOption!.title.toLowerCase()}` : "original";
  // Changes whenever different numbers are shown, so the calendar can play a short "updated" fade.
  const shownKey = `${simKey ?? "original"}|${investKey ?? "-"}|${shownLabel}`;
  const scenarioOptions: { value: ScenarioView; text: string }[] = [
    { value: "original", text: "Original" },
    ...(selectedOption ? [{ value: "with" as const, text: `With ${selectedOption.title.toLowerCase()}` }] : []),
    ...(investResult?.scenario ? [{ value: "invest" as const, text: "With investing" }] : []),
  ];

  const today = todayISO();
  const days = useMemo(() => (shown ? buildDays(shown, today, shownOriginal) : new Map()), [shown, today, shownOriginal]);
  const monthBeyondSchedule = !!shown && shown.end_date > shown.scheduled_through;

  const [view, setView] = useState<"calendar" | "list">("calendar");
  // The grid is only used when every balance fits its cell whole (measured, so large text or a
  // narrow window falls back to the list instead of overflowing). Nothing is shrunk or hidden.
  const gridArea = useRef<HTMLDivElement>(null);
  const widestBalance = useMemo(() => {
    let widest = "";
    for (const d of days.values()) {
      if (d.closingChecking === null) continue;
      const text = `${d.status === "projected" ? "≈" : ""}${formatMoney(d.closingChecking)}`;
      if (text.length > widest.length) widest = text;
    }
    return widest;
  }, [days]);
  const { fits: gridFits, probe } = useGridFits(gridArea, widestBalance);
  const showGrid = view === "calendar" && gridFits;
  // The date whose details were last opened. It stays marked after the dialog closes.
  const [selected, setSelected] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const openDay = useCallback((date: string) => {
    setSelected(date);
    setDetailsOpen(true);
  }, []);
  const [focusRequest, setFocusRequest] = useState(0);
  // Optional "keep at least $X in checking"; lives here so the assistant can see it too.
  const [cushion, setCushion] = useState<string | null>(null);

  // Tell the shared assistant what it may talk about (the exact inputs; the server recalculates).
  // It follows what the calendar shows: the investing preview when that is on screen, otherwise
  // the purchase comparison, so a purchase answer is never presented as an investing one.
  useEffect(() => {
    if (showingInvest && investmentPlan && investResult) {
      onAssistantContext({ kind: "investment", request: investmentPlan, result: investResult, tag: `invest-${investResult.plan_key}` });
    } else if (experiment && simRequest && simKey && simResult && selectedOption) {
      onAssistantContext({
        kind: "purchase",
        label: experiment.label,
        amount: experiment.amount,
        simRequest,
        selectedMethod: selectedOption.method,
        cushion,
        data: simResult,
        tag: scenarioTag(simKey, selectedOption.method, cushion),
      });
    } else {
      onAssistantContext(NO_CONTEXT);
    }
  }, [experiment, simRequest, simKey, simResult, selectedOption, cushion, showingInvest, investmentPlan, investResult, onAssistantContext]);

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
  const selectedDay = detailsOpen && selected ? days.get(selected) : undefined;
  const preview: PreviewKind = showingInvest ? "invest" : showingExperiment ? "purchase" : null;
  const monthTitle = month ? formatMonthTitle(month) : null;

  return (
    <div>
      <h1 className="sr-only">Money calendar</h1>
      {headerSlot &&
        createPortal(
          <>
            <AccountStrip profile={profile} onRetry={retryAll} />
            <button type="button" onClick={() => setFocusRequest((n) => n + 1)} className="lab-button-quiet !py-1.5">
              Try a purchase
            </button>
          </>,
          headerSlot,
        )}

      <main className="mx-auto max-w-7xl px-4 pt-1 pb-2 sm:px-6">
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
              onSelectMethod={selectMethod}
              cushion={cushion}
              onCushion={setCushion}
              onExplain={onExplain}
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
            className="lab-card relative min-w-0 p-3 sm:p-4 lg:col-start-1 lg:row-start-1"
          >
            {/* Measures how wide this month's longest balance is at the current text size. */}
            <span ref={probe} aria-hidden="true" className="invisible absolute top-0 left-0 text-xs font-semibold whitespace-nowrap tabular-nums">
              {widestBalance}
            </span>
            <Toolbar
              month={month}
              referenceMonth={referenceMonth}
              view={view}
              onView={setView}
              onMonth={setMonth}
              scenarioOptions={scenarioOptions}
              scenarioView={scenarioOptions.some((o) => o.value === scenarioView) ? scenarioView : "original"}
              onScenarioView={setScenarioView}
            />
            {experiment && !simResult && calendar.status !== "error" && (
              <p role="status" className="mt-2 text-xs text-navy-soft">
                {simState?.status === "error"
                  ? "Showing the original calendar: the comparison for this month couldn’t be calculated."
                  : "Running the numbers… showing the original calendar for now."}
              </p>
            )}
            <Legend preview={preview} scheduledThrough={monthBeyondSchedule && shown ? shown.scheduled_through : null} />

            {view === "calendar" && !gridFits && shown && (
              <p role="status" className="mt-2 text-xs text-navy-soft">
                Showing the list: the month grid doesn’t have room for whole balances at this size.
              </p>
            )}
            {/* The measured area is this stable wrapper; the keyed child remounts when the numbers change. */}
            <div ref={gridArea}>
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
                  {showGrid ? (
                    <>
                      {/* Seven columns don't fit a phone, so small screens get the list. */}
                      <div className="hidden md:block">
                        <MonthGrid month={month} days={days} selectedDate={selected} onOpenDay={openDay} reserveBelow={RESERVE_BELOW_GRID} />
                      </div>
                      <div className="md:hidden">
                        <ListView dates={datesInMonth(month)} days={days} selectedDate={selected} preview={preview} onOpenDay={openDay} />
                      </div>
                    </>
                  ) : (
                    <ListView dates={datesInMonth(month)} days={days} selectedDate={selected} preview={preview} onOpenDay={openDay} />
                  )}
                  <MonthTotals
                    calendar={shown}
                    label={`${monthTitle}${simResult || investResult ? `, ${shownLabel}` : ""}`}
                  />
                </>
              )}
            </div>
            </div>
          </section>
        </div>
      </main>

      {selectedDay && referenceDate && (
        <DayDetails day={selectedDay} referenceDate={referenceDate} preview={preview} onClose={() => setDetailsOpen(false)} />
      )}
    </div>
  );
}

// ---- small page pieces -------------------------------------------------------------

/**
 * Measures the calendar area and a hidden copy of the month's widest balance, and
 * says whether the grid can show that balance whole. Re-measured whenever the area
 * or the text size changes (both are observed), so zooming in switches to the list
 * and zooming out brings the grid back.
 */
function useGridFits(area: RefObject<HTMLDivElement | null>, widestBalance: string) {
  const probe = useRef<HTMLSpanElement>(null);
  const [fits, setFits] = useState(true);
  useLayoutEffect(() => {
    const el = area.current;
    const p = probe.current;
    if (!el || !p) return;
    const update = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const next = !widestBalance || balancesFitGrid(p.offsetWidth, el.clientWidth, rem);
      setFits((prev) => (prev === next ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    ro.observe(p);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [area, widestBalance]);
  return { fits, probe };
}

/**
 * On wide screens: a sticky panel with its own scrollbar, plus a "More below"
 * cue while there is hidden content. Elsewhere it is an ordinary block, so the
 * page scrolls normally (small screens, zoomed-in text).
 */
function ScrollPanel({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  const [maxHeight, setMaxHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setMore(el.scrollHeight - el.scrollTop - el.clientHeight > 8);
    // Wide screens: the panel scrolls on its own, sized to the space below the header.
    // Measured, so a taller header can't push the whole page into scrolling.
    const size = () => {
      if (window.innerWidth < 1024) return setMaxHeight(undefined);
      const top = el.getBoundingClientRect().top + window.scrollY;
      setMaxHeight(Math.max(240, window.innerHeight - top - 16));
    };
    size();
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", size);
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", size);
      ro.disconnect();
    };
  }, []);
  return (
    <div className="relative lg:sticky lg:top-3 lg:col-start-2 lg:row-start-1">
      <div
        ref={ref}
        style={{ maxHeight }}
        // `relative` keeps absolutely positioned bits (like screen-reader-only text) inside the
        // scroll box; otherwise they escape it and make the whole page taller.
        className="lab-card relative p-5 lg:overflow-y-auto lg:overscroll-contain"
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
  scenarioOptions: { value: ScenarioView; text: string }[];
  scenarioView: ScenarioView;
  onScenarioView: (v: ScenarioView) => void;
}

type ScenarioView = "original" | "with" | "invest";

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
        {p.scenarioOptions.length > 1 && (
          <Segmented label="Show calendar" options={p.scenarioOptions} value={p.scenarioView} onChange={p.onScenarioView} />
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

/**
 * One short line. Each cell's amount is checking at the end of that day; "≈" marks a
 * projected (estimated) day; the pink chip is the planned payment being previewed. The
 * day details explain sources, certainty and the reference date in full.
 */
function Legend({ preview, scheduledThrough }: { preview: PreviewKind; scheduledThrough: string | null }) {
  return (
    <p className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs text-navy-soft">
      <span className="sr-only">How to read the calendar: </span>
      <span>
        Daily <span className="font-semibold text-navy">balance</span>
      </span>
      <span aria-hidden="true">·</span>
      <span>
        <span className="font-semibold text-navy">≈</span> projected
      </span>
      {preview && (
        <>
          <span aria-hidden="true">·</span>
          <span className="flex items-baseline gap-1.5">
            <span aria-hidden="true" className="inline-block h-2.5 w-4 rounded-sm border border-lilac/40 bg-lilac-soft align-middle" />
            planned {preview === "invest" ? "contribution" : "payment"}
          </span>
        </>
      )}
      {scheduledThrough && (
        <>
          <span aria-hidden="true">·</span>
          <span>
            <span className="rounded bg-[repeating-linear-gradient(135deg,transparent_0_4px,rgb(20_26_58/0.12)_4px_6px)] px-1">striped</span>{" "}
            no bills or pay known after {formatShortDate(scheduledThrough).replace(/, \d{4}$/, "")}
          </span>
        </>
      )}
    </p>
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
