"""Turns an InvestmentRequest into an InvestmentResult (and, optionally, the money calendar with transfers)."""
import hashlib
import json
from datetime import timedelta
from decimal import Decimal

from .demo_fixtures import ALL_EVENTS, DEMO_AS_OF, DemoEvent
from .investing import CONVENTION, MAX_YEARS, ZERO, contribution_dates, project
from .money_calendar import MAX_DAYS_AHEAD, SCHEDULED_THROUGH, CalendarRangeError, build_calendar, compute_calendar, fmt, snapshot_from
from .schemas import (
    CashFlowCheck,
    FeeDifference,
    FundResult,
    InvestmentRequest,
    InvestmentResult,
    LowestBalance,
    Profile,
    SeriesPoint,
)

ASSUMPTIONS = [
    "This is an illustration with returns you chose, not a forecast. Real investments can lose money, and no return "
    "is guaranteed.",
    "Both funds are assumed to hold the same investments and earn the same return before fees; only the yearly fee "
    "differs, so the gap between them is the effect of fees alone.",
    "Contributions are transfers out of checking into a hypothetical investment account; they are not spending. "
    "The invested value is kept separate from spendable cash and is never added to checking.",
    f"Bills and pay are only scheduled through {SCHEDULED_THROUGH:%b %d, %Y}. Cash flow is assessed only up to that "
    "date; later months are not a complete budget, and the long-term illustration does not claim they are.",
    "Nothing here moves money or changes Nessie.",
]


def plan_key(req: InvestmentRequest) -> str:
    core = req.model_dump(mode="json", exclude={"calendar_start", "calendar_end"})
    return hashlib.sha256(json.dumps(core, sort_keys=True).encode()).hexdigest()[:16]


def transfer_events(req: InvestmentRequest, dates) -> tuple[DemoEvent, ...]:
    """Each contribution as money leaving checking on its date (a transfer, labelled as such)."""
    return tuple(
        DemoEvent(f"experiment-invest-{i}", d, f"Invest · transfer {i}", req.contribution, "out", "experiment", "hypothetical")
        for i, d in enumerate(dates, 1)
    )


def run_investment(profile: Profile, req: InvestmentRequest) -> InvestmentResult:
    if req.start_date <= DEMO_AS_OF:
        raise CalendarRangeError(f"start_date must be after {DEMO_AS_OF} (contributions can only start in the future).")
    if req.start_date > DEMO_AS_OF + timedelta(days=365):
        raise CalendarRangeError("start_date must be within a year of the demo reference date.")
    if req.years > MAX_YEARS:
        raise CalendarRangeError(f"years must be {MAX_YEARS} or fewer.")

    dates = contribution_dates(req.start_date, req.frequency, req.years)
    pct = lambda p: p / Decimal(100)  # noqa: E731
    runs = {
        "no_fee": project(dates, req.contribution, req.start_date, req.years, pct(req.gross_return_pct), ZERO),
        "a": project(dates, req.contribution, req.start_date, req.years, pct(req.gross_return_pct), pct(req.fee_a_pct)),
        "b": project(dates, req.contribution, req.start_date, req.years, pct(req.gross_return_pct), pct(req.fee_b_pct)),
        "adv_no_fee": project(dates, req.contribution, req.start_date, req.years, pct(req.adverse_return_pct), ZERO),
        "adv_a": project(dates, req.contribution, req.start_date, req.years, pct(req.adverse_return_pct), pct(req.fee_a_pct)),
        "adv_b": project(dates, req.contribution, req.start_date, req.years, pct(req.adverse_return_pct), pct(req.fee_b_pct)),
    }
    end = {k: v[-1] for k, v in runs.items()}
    total = end["a"].contributed

    def fund(fid: str, label: str, fee_pct: Decimal) -> FundResult:
        e, adv = end[fid], end["adv_" + fid]
        effect = end["no_fee"].value - e.value
        return FundResult(
            id=fid, label=label, fee_pct=fmt(fee_pct),
            ending_value=fmt(e.value), fees_deducted=fmt(e.fees),
            fee_effect_on_ending=fmt(effect), lost_growth=fmt(effect - e.fees),
            adverse_ending_value=fmt(adv.value), adverse_fees_deducted=fmt(adv.fees),
            adverse_fee_effect_on_ending=fmt(end["adv_no_fee"].value - adv.value),
        )

    funds = [fund("a", "Fund A (lower fee)", req.fee_a_pct), fund("b", "Fund B (higher fee)", req.fee_b_pct)]
    gap = end["a"].value - end["b"].value
    extra_fees = end["b"].fees - end["a"].fees

    series = [
        SeriesPoint(
            month=f"{p.month:%Y-%m}", contributed=fmt(p.contributed), no_fee_value=fmt(runs["no_fee"][i].value),
            fund_a_value=fmt(p.value), fund_b_value=fmt(runs["b"][i].value),
            adverse_fund_a_value=fmt(runs["adv_a"][i].value), adverse_fund_b_value=fmt(runs["adv_b"][i].value),
        )
        for i, p in enumerate(runs["a"])
    ]

    # Cash flow: only while bills and pay are known. Transfers after that are counted, not judged.
    snap = snapshot_from(profile)
    transfers = transfer_events(req, dates)
    window_end = min(max(SCHEDULED_THROUGH, req.start_date), DEMO_AS_OF + timedelta(days=MAX_DAYS_AHEAD))
    in_window = [d for d in dates if d <= SCHEDULED_THROUGH]
    before = compute_calendar(snap.checking, snap.savings, ALL_EVENTS, req.start_date, window_end)
    after = compute_calendar(snap.checking, snap.savings, ALL_EVENTS + transfers, req.start_date, window_end)
    cash_flow = CashFlowCheck(
        assessed_through=SCHEDULED_THROUGH.isoformat(),
        contributions_in_window=len(in_window),
        amount_in_window=fmt(req.contribution * len(in_window)),
        contributions_after_coverage=len(dates) - len(in_window),
        lowest_checking_before=LowestBalance(date=before.lowest_day.isoformat(), balance=fmt(before.lowest_balance)),
        lowest_checking_after=LowestBalance(date=after.lowest_day.isoformat(), balance=fmt(after.lowest_balance)),
        shortfall_dates_after=[d.isoformat() for d in after.shortfall_dates],
    )

    baseline = scenario = None
    if req.calendar_start and req.calendar_end:
        baseline = build_calendar(profile, req.calendar_start, req.calendar_end)
        scenario = build_calendar(profile, req.calendar_start, req.calendar_end, extra_events=transfers)

    return InvestmentResult(
        plan_key=plan_key(req),
        first_contribution=dates[0].isoformat(),
        horizon_end=runs["a"][-1].month.isoformat(),
        contribution_dates=[d.isoformat() for d in dates],
        contributions_count=len(dates),
        total_contributions=fmt(total),
        no_fee_ending_value=fmt(end["no_fee"].value),
        adverse_no_fee_ending_value=fmt(end["adv_no_fee"].value),
        funds=funds,
        fee_difference=FeeDifference(ending_value_gap=fmt(gap), extra_fees_deducted=fmt(extra_fees), extra_lost_growth=fmt(gap - extra_fees)),
        series=series,
        cash_flow=cash_flow,
        baseline=baseline,
        scenario=scenario,
        convention=CONVENTION,
        assumptions=ASSUMPTIONS,
    )
