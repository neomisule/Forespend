"""Hypothetical purchases paid by cash, installments, or credit, compared with the original calendar.

Nothing here moves money or changes data. Each method turns the purchase into
temporary extra CHECKING events (what actually leaves checking, and when),
added to a copy of the event list. Every method is calculated from the same
fetched Nessie snapshot by the same engine (compute_calendar).

  cash          one outflow of the full price on the purchase date
  installments  one outflow per installment (see financing.py)
  credit        NO outflow on the purchase date (it becomes card debt);
                one outflow per card repayment (see financing.py)
"""
from datetime import date, timedelta
from decimal import Decimal

from .demo_fixtures import ALL_EVENTS, DEMO_AS_OF, UPCOMING_EVENTS, DemoEvent
from .financing import MAX_CREDIT_PAYMENTS, Payment, credit_plan, installment_schedule
from .money_calendar import (
    MAX_DAYS_AHEAD,
    SCHEDULED_THROUGH,
    CalendarRangeError,
    Snapshot,
    build_calendar,
    compute_calendar,
    fmt,
    snapshot_from,
)
from .schemas import (
    CalendarEvent,
    Coverage,
    LowestBalance,
    MethodOption,
    MissingItem,
    Profile,
    ScheduledPayment,
    SimulationComparison,
    SimulationRequest,
    SimulationResult,
)

EXPERIMENT_ID = "experiment-cash-purchase"
ZERO = Decimal("0")

SIMULATION_ASSUMPTIONS = [
    "The purchase is hypothetical: no payment is made and Nessie is not changed.",
    "Cash means the full amount leaves checking on the purchase date. Savings is not used.",
    "The lowest projected balance is checked from the purchase date through the last scheduled demo event "
    "(or the end of the period shown, if later). Estimates can change, so it is not a guaranteed safe amount.",
]
INSTALLMENT_ASSUMPTIONS = [
    "This is a made-up fixed-payment offer to compare with. Real installment plans set their own number of "
    "payments, dates, fees, interest, late fees and approval rules.",
    "Total = price + the fixed fee you entered, split into equal payments rounded down to the cent; "
    "the final payment includes any leftover cents.",
    "The first payment is on the purchase date; later payments follow the chosen frequency.",
]
CREDIT_ASSUMPTIONS = [
    "Educational illustration, not a card issuer's statement. Real cards differ (statement dates, minimum "
    "payments, grace periods, fees, penalty rates).",
    "The purchase becomes card debt on the purchase date; checking only changes when a repayment is made.",
    "Interest: APR / 365 per day on everything owed, starting the day after the purchase (no grace period is "
    "modeled). It is rounded to the cent and added on each payment date; payments cover interest first.",
    "Payments are monthly on the same day as the first payment; the last one is only what is still owed.",
    f"The schedule stops after {MAX_CREDIT_PAYMENTS} payments (10 years).",
    "Nothing here predicts approval or any effect on a credit score.",
]


def usd(value: Decimal) -> str:
    """For sentences shown to people: Decimal("1250.5") -> "$1,250.50"."""
    return f"${value.quantize(Decimal('0.01')):,}"


def nice(d: date) -> str:
    return f"{d:%b} {d.day}, {d.year}"


def missing_after(day: date) -> list[MissingItem]:
    """Every baseline item, with its last scheduled date, when the schedule stops before `day`."""
    last: dict[str, date] = {}
    for e in UPCOMING_EVENTS:
        last[e.label] = max(last.get(e.label, e.date), e.date)
    return [MissingItem(label=k, last_scheduled=v.isoformat()) for k, v in sorted(last.items(), key=lambda kv: kv[1])]


def _sum(payments: list[Payment], attr: str, until: date | None = None, start: date | None = None) -> Decimal:
    return sum(
        (getattr(p, attr) for p in payments if (until is None or p.date <= until) and (start is None or p.date >= start)),
        ZERO,
    )


def _events(req: SimulationRequest, payments: list[Payment], method: str, name: str) -> tuple[DemoEvent, ...]:
    if method == "cash":  # keep the original id/label for cash
        return (DemoEvent(EXPERIMENT_ID, req.purchase_date, req.label, req.amount, "out", "experiment", "hypothetical"),)
    return tuple(
        DemoEvent(f"experiment-{method}-{p.number}", p.date, f"{req.label} · {name} {p.number}", p.amount, "out",
                  "experiment", "hypothetical")
        for p in payments
    )


def _comparison(req: SimulationRequest, snap: Snapshot, baseline_end: Decimal, scenario_end: Decimal,
                extra: tuple[DemoEvent, ...], window_end: date) -> SimulationComparison:
    before = compute_calendar(snap.checking, snap.savings, ALL_EVENTS, req.purchase_date, window_end)
    after = compute_calendar(snap.checking, snap.savings, ALL_EVENTS + extra, req.purchase_date, window_end)
    return SimulationComparison(
        period_start=req.start_date.isoformat(),
        period_end=req.end_date.isoformat(),
        ending_checking_before=fmt(baseline_end),
        ending_checking_after=fmt(scenario_end),
        difference=fmt(scenario_end - baseline_end),
        window_start=req.purchase_date.isoformat(),
        window_end=window_end.isoformat(),
        lowest_before=LowestBalance(date=before.lowest_day.isoformat(), balance=fmt(before.lowest_balance)),
        lowest_after=LowestBalance(date=after.lowest_day.isoformat(), balance=fmt(after.lowest_balance)),
        outcome="shortfall" if after.shortfall_dates else "cushion",
        shortfall_dates_after=[d.isoformat() for d in after.shortfall_dates],
    )


def _option(req, profile, snap, baseline, window_end, method) -> MethodOption:
    warnings: list[str] = []
    price = req.amount
    if method == "cash":
        payments = [Payment(1, req.purchase_date, price, ZERO, price, ZERO)]
        title, terms, name, complete, payoff = "Cash", f"Pay {usd(price)} from checking on {nice(req.purchase_date)}", "", True, req.purchase_date
        owed = owed_fin = ZERO
        assumptions = SIMULATION_ASSUMPTIONS[:2]
    elif method == "installments":
        t = req.installments
        payments = installment_schedule(price, req.purchase_date, t.count, t.frequency, t.fee)
        freq = {"weekly": "every week", "biweekly": "every 2 weeks", "monthly": "every month"}[t.frequency]
        title, name = "Installments", "payment"
        terms = f"{t.count} payments {freq} from {nice(req.purchase_date)}, fixed fee {usd(t.fee)} (hypothetical offer)"
        complete, payoff = True, payments[-1].date
        later = [p for p in payments if p.date > window_end]
        owed = _sum(later, "amount")
        owed_fin = _sum(later, "financing_part")
        assumptions = INSTALLMENT_ASSUMPTIONS
    else:
        t = req.credit
        plan = credit_plan(price, req.purchase_date, t.apr, t.monthly_payment, t.first_payment_date, window_end)
        payments = plan.payments
        title, name = "Credit card", "card payment"
        terms = f"{fmt(t.apr)}% APR, {usd(t.monthly_payment)} a month from {nice(t.first_payment_date)} (illustration)"
        complete, payoff = plan.complete, plan.payoff_date
        owed, owed_fin = plan.owed_at_horizon, plan.interest_owed_at_horizon
        assumptions = CREDIT_ASSUMPTIONS
        if plan.payment_too_small:
            warnings.append(
                f"A {usd(t.monthly_payment)} payment does not cover the interest being added, so this debt would "
                "not go down. The schedule shown stops early. Try a larger monthly payment.")
        elif not plan.complete:
            warnings.append(f"At {usd(t.monthly_payment)} a month the debt is not repaid within "
                            f"{MAX_CREDIT_PAYMENTS} payments; totals cover only those payments.")

    extra = _events(req, payments, method, name)
    scenario = build_calendar(profile, req.start_date, req.end_date, extra_events=extra)
    comparison = _comparison(req, snap, Decimal(baseline.daily_balances[-1].checking),
                             Decimal(scenario.daily_balances[-1].checking), extra, window_end)
    if owed > 0 and method != "cash":
        warnings.append(f"{usd(owed)} is still owed on {nice(window_end)}. Paying later is not the same as paying less.")

    return MethodOption(
        method=method,
        title=title,
        terms=terms,
        scenario=scenario,
        comparison=comparison,
        paid_on_purchase_date=fmt(_sum(payments, "amount", req.purchase_date, req.purchase_date)),
        last_payment_date=payments[-1].date.isoformat() if payments else None,
        payments_after_scheduled_through=any(p.date > SCHEDULED_THROUGH for p in payments),
        paid_from_checking_in_period=fmt(_sum(payments, "amount", req.end_date, req.start_date)),
        paid_from_checking_in_window=fmt(_sum(payments, "amount", window_end)),
        financing_cost_paid_in_window=fmt(_sum(payments, "financing_part", window_end)),
        financing_cost_full_schedule=fmt(_sum(payments, "financing_part")),
        total_paid_full_schedule=fmt(_sum(payments, "amount")),
        full_schedule_complete=complete,
        owed_at_window_end=fmt(owed),
        interest_or_fees_owed_at_window_end=fmt(owed_fin),
        payoff_date=payoff.isoformat() if payoff else None,
        schedule=[
            ScheduledPayment(number=p.number, date=p.date.isoformat(), amount=fmt(p.amount),
                             financing_part=fmt(p.financing_part), principal_part=fmt(p.principal_part),
                             owed_after=fmt(p.owed_after), in_window=p.date <= window_end)
            for p in payments
        ],
        warnings=warnings,
        assumptions=assumptions,
    )


def run_simulation(profile: Profile, req: SimulationRequest) -> SimulationResult:
    latest = DEMO_AS_OF + timedelta(days=MAX_DAYS_AHEAD)
    if req.purchase_date <= DEMO_AS_OF:
        raise CalendarRangeError(f"purchase_date must be after {DEMO_AS_OF} (purchases can only be in the future).")
    if req.purchase_date > latest:
        raise CalendarRangeError(f"purchase_date cannot be after {latest} (projections stop {MAX_DAYS_AHEAD} days out).")

    snap = snapshot_from(profile)  # one snapshot for every method
    baseline = build_calendar(profile, req.start_date, req.end_date)

    # One window for every method: from the purchase through the known schedule (or the period shown, if later).
    window_end = min(max(req.end_date, SCHEDULED_THROUGH, req.purchase_date), latest)

    methods = [req.payment]
    if req.compare:
        methods = ["cash"] + [m for m, terms in (("installments", req.installments), ("credit", req.credit)) if terms]
    options = [_option(req, profile, snap, baseline, window_end, m) for m in methods]
    selected = next(o for o in options if o.method == req.payment)

    return SimulationResult(
        purchase=CalendarEvent(
            id=EXPERIMENT_ID, date=req.purchase_date.isoformat(), label=req.label, amount=fmt(req.amount),
            direction="out", account_id=snap.checking_id, source="experiment", certainty="hypothetical",
            period="projected",
        ),
        payment=req.payment,
        baseline=baseline,
        scenario=selected.scenario,
        comparison=selected.comparison,
        assumptions=SIMULATION_ASSUMPTIONS,
        coverage=Coverage(
            scheduled_through=SCHEDULED_THROUGH.isoformat(),
            window_start=req.purchase_date.isoformat(),
            window_end=window_end.isoformat(),
            window_beyond_coverage=window_end > SCHEDULED_THROUGH,
            not_scheduled_after=missing_after(window_end) if window_end > SCHEDULED_THROUGH else [],
        ),
        options=options,
    )
