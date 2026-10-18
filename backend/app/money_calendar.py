"""The calendar maths. Pure functions: no network, no files, no global changes.

(Named money_calendar, not calendar, so it never hides Python's built-in `calendar`.)

Idea in one paragraph: Nessie tells us the checking balance as of DEMO_AS_OF.
Events on or before that day are *already inside* that balance, so we "undo"
them to find the opening balance on the first day, then walk forward day by day
applying every event, past and future. The walk passes through the Nessie balance
on DEMO_AS_OF by construction, so nothing is double-counted.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from .demo_fixtures import ALL_EVENTS, DEMO_AS_OF, HISTORY_START, UPCOMING_EVENTS, DemoEvent
from .schemas import Calendar, CalendarEvent, DailyBalance, LowestBalance, Profile, Summary

CENT = Decimal("0.01")
MAX_DAYS_AHEAD = 90  # how far past DEMO_AS_OF we are willing to project
# Bills and pay are only known up to the last fixture event. Later days are not a complete budget.
SCHEDULED_THROUGH = max(e.date for e in UPCOMING_EVENTS)


class CalendarRangeError(ValueError):
    """The requested date range is not supported."""


class MissingAccountError(Exception):
    """The customer has no checking account yet."""


def fmt(value: Decimal) -> str:
    return str(value.quantize(CENT))


@dataclass(frozen=True)
class DayBalance:
    day: date
    checking: Decimal
    savings: Decimal


@dataclass(frozen=True)
class CalendarResult:
    start: date
    end: date
    opening_checking: Decimal
    opening_savings: Decimal
    events: tuple[DemoEvent, ...]  # only those inside start..end
    days: tuple[DayBalance, ...]
    lowest_day: date
    lowest_balance: Decimal
    shortfall_dates: tuple[date, ...]
    spent_so_far: Decimal
    income_so_far: Decimal
    projected_spending: Decimal
    projected_income: Decimal


def compute_calendar(
    checking_now: Decimal,
    savings_now: Decimal,
    events: tuple[DemoEvent, ...],
    start: date,
    end: date,
    as_of: date = DEMO_AS_OF,
    supported_start: date = HISTORY_START,
) -> CalendarResult:
    if start > end:
        raise CalendarRangeError("start_date must not be after end_date.")
    if start < supported_start:
        raise CalendarRangeError(f"start_date cannot be before {supported_start} (earliest supported date).")
    latest = as_of + timedelta(days=MAX_DAYS_AHEAD)
    if end > latest:
        raise CalendarRangeError(f"end_date cannot be after {latest} (projections stop {MAX_DAYS_AHEAD} days out).")

    past = [e for e in events if e.date <= as_of]
    if any(e.date < supported_start for e in past):
        raise ValueError("An event is dated before the supported start; the opening balance would be wrong.")

    by_day: dict[date, list[DemoEvent]] = {}
    for e in sorted(events, key=lambda e: (e.date, e.id)):  # sorted() makes a copy; `events` is untouched
        by_day.setdefault(e.date, []).append(e)

    # Undo history to find what the balance was before the first supported day.
    running = checking_now - sum((e.signed_amount for e in past), Decimal("0"))

    opening_checking = running
    days: list[DayBalance] = []
    day = supported_start
    while day <= end:
        if day == start:
            opening_checking = running  # balance at the START of the first visible day
        for e in by_day.get(day, []):
            running += e.signed_amount
        if day >= start:
            days.append(DayBalance(day, running, savings_now))
        day += timedelta(days=1)

    visible = tuple(e for d in sorted(by_day) if start <= d <= end for e in by_day[d])
    lowest = min(days, key=lambda d: (d.checking, d.day))

    def total(direction: str, is_past: bool) -> Decimal:
        return sum((e.amount for e in visible if e.direction == direction and (e.date <= as_of) == is_past),
                   Decimal("0"))

    return CalendarResult(
        start=start,
        end=end,
        opening_checking=opening_checking,
        opening_savings=savings_now,  # savings never moves in this milestone
        events=visible,
        days=tuple(days),
        lowest_day=lowest.day,
        lowest_balance=lowest.checking,
        shortfall_dates=tuple(d.day for d in days if d.checking < 0),
        spent_so_far=total("out", True),
        income_so_far=total("in", True),
        projected_spending=total("out", False),
        projected_income=total("in", False),
    )


# ---- turning results into JSON-ready shapes -------------------------------

def event_dict(e: DemoEvent, account_id: str) -> dict:
    return {
        "id": e.id,
        "date": e.date.isoformat(),
        "label": e.label,
        "amount": fmt(e.amount),
        "direction": e.direction,
        "account_id": account_id,
        "source": e.source,
        "certainty": e.certainty,
    }


def upcoming_events(checking_account_id: str | None) -> list[dict]:
    """Future-only events for /api/profile. Empty if there is no checking account to link to."""
    if not checking_account_id:
        return []
    return [event_dict(e, checking_account_id) for e in UPCOMING_EVENTS if e.date > DEMO_AS_OF]


ASSUMPTIONS = [
    "Account balances come from the Capital One Nessie sandbox; everything else here is fictional demo data.",
    f"Transactions dated {HISTORY_START} to {DEMO_AS_OF} are app demo history (source 'demo_history'), "
    "not records fetched from Nessie. They were chosen to be consistent with the current checking balance.",
    f"The opening balance on {HISTORY_START} is derived by undoing that history from the current balance; "
    "the current balance is not changed or counted twice.",
    f"Events after {DEMO_AS_OF} are estimates (source 'demo_assumption', certainty 'estimated').",
    f"The Nessie balances are treated as of the demo reference date {DEMO_AS_OF} so the demo stays stable; "
    "retrieval_date is the real date they were fetched.",
    "Savings stays flat and is never used automatically to cover checking.",
    "No payments, deposits or Nessie balance changes are made.",
]


@dataclass(frozen=True)
class Snapshot:
    """The fetched Nessie balances that every calculation in one request starts from."""
    checking_id: str
    checking: Decimal
    savings: Decimal
    notes: tuple[str, ...]


def snapshot_from(profile: Profile) -> Snapshot:
    checking = next((a for a in profile.accounts if a.type == "checking"), None)
    if checking is None:
        raise MissingAccountError(
            "No checking account found in Nessie. Run: python -m scripts.seed_accounts --apply"
        )
    savings = next((a for a in profile.accounts if a.type == "savings"), None)
    notes = list(ASSUMPTIONS)
    if savings is None:
        notes.append("No savings account found in Nessie, so savings is shown as 0.00.")
    return Snapshot(checking.id, Decimal(checking.balance),
                    Decimal(savings.balance) if savings else Decimal("0"), tuple(notes))


def build_calendar(profile: Profile, start: date, end: date,
                   extra_events: tuple[DemoEvent, ...] = ()) -> Calendar:
    """`extra_events` are hypothetical (e.g. an experiment); the fixtures are never changed."""
    snap = snapshot_from(profile)
    r = compute_calendar(snap.checking, snap.savings, ALL_EVENTS + extra_events, start, end)
    checking_id, notes = snap.checking_id, list(snap.notes)
    return Calendar(
        start_date=r.start.isoformat(),
        end_date=r.end.isoformat(),
        currency=profile.currency,
        demo_reference_date=DEMO_AS_OF.isoformat(),
        retrieval_date=profile.snapshot_date,
        scheduled_through=SCHEDULED_THROUGH.isoformat(),
        opening_balances={"checking": fmt(r.opening_checking), "savings": fmt(r.opening_savings)},
        events=[
            CalendarEvent(**event_dict(e, checking_id), period="past" if e.date <= DEMO_AS_OF else "projected")
            for e in r.events
        ],
        daily_balances=[
            DailyBalance(date=d.day.isoformat(), checking=fmt(d.checking), savings=fmt(d.savings)) for d in r.days
        ],
        lowest_checking=LowestBalance(date=r.lowest_day.isoformat(), balance=fmt(r.lowest_balance)),
        shortfall_dates=[d.isoformat() for d in r.shortfall_dates],
        summary=Summary(
            spent_so_far=fmt(r.spent_so_far),
            income_so_far=fmt(r.income_so_far),
            projected_spending=fmt(r.projected_spending),
            projected_income=fmt(r.projected_income),
        ),
        assumptions=notes,
    )
