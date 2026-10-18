"""FICTIONAL demo money events. None of this comes from Nessie.

Two lists live here:
  * PAST_EVENTS     - made-up history for Oct 1-17 (source "demo_history")
  * UPCOMING_EVENTS - made-up future estimates   (source "demo_assumption")

Nessie only knows the checking balance *today* ($1,200). The past events are
chosen so that, when replayed, they end exactly at that balance. We never add
them to the balance; we work backwards to find the Oct 1 opening balance.

Everything here is frozen/immutable so calculations cannot change it.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

# The day the fetched Nessie balances are treated as "now". Pinned (instead of
# using today's date) so the demo stays the same however long the hackathon runs.
DEMO_AS_OF = date(2026, 10, 17)
# First day we have history for; the calendar cannot start before this.
HISTORY_START = date(2026, 10, 1)


@dataclass(frozen=True)
class DemoEvent:
    id: str  # stable: never changes between runs
    date: date
    label: str
    amount: Decimal  # always positive; `direction` says which way money moves
    direction: str  # "in" or "out"
    source: str
    certainty: str

    def __post_init__(self):
        if self.direction not in ("in", "out"):
            raise ValueError(f"direction must be 'in' or 'out', got {self.direction!r}")
        if self.amount <= 0:
            raise ValueError("amount must be positive; use direction for the sign")

    @property
    def signed_amount(self) -> Decimal:
        return self.amount if self.direction == "in" else -self.amount


def _past(day: int, slug: str, label: str, amount: str, direction: str) -> DemoEvent:
    return DemoEvent(f"demo-history-2026-10-{day:02d}-{slug}", date(2026, 10, day), label,
                     Decimal(amount), direction, "demo_history", "historical")


def _future(d: date, slug: str, label: str, amount: str, direction: str) -> DemoEvent:
    return DemoEvent(f"demo-estimate-{d.isoformat()}-{slug}", d, label,
                     Decimal(amount), direction, "demo_assumption", "estimated")


# Net of these = -470.00, so opening balance on Oct 1 = 1200 + 470 = 1670.00.
PAST_EVENTS: tuple[DemoEvent, ...] = (
    _past(1, "rent-utilities", "Rent/utilities", "850.00", "out"),
    _past(4, "groceries", "Groceries", "65.00", "out"),
    _past(6, "transport", "Transport", "30.00", "out"),
    _past(9, "part-time-pay", "Part-time pay", "650.00", "in"),
    _past(11, "groceries", "Groceries", "72.00", "out"),
    _past(13, "subscription", "Subscription", "15.00", "out"),
    _past(15, "dining", "Dining out", "28.00", "out"),
    _past(16, "groceries", "Groceries", "60.00", "out"),
)

UPCOMING_EVENTS: tuple[DemoEvent, ...] = (
    _future(date(2026, 10, 20), "phone-bill", "Phone bill", "45.00", "out"),
    _future(date(2026, 10, 22), "groceries", "Groceries", "70.00", "out"),
    _future(date(2026, 10, 23), "part-time-pay", "Part-time pay", "650.00", "in"),
    _future(date(2026, 10, 25), "transport", "Transport", "30.00", "out"),
    _future(date(2026, 10, 27), "subscription", "Subscription", "15.00", "out"),
    _future(date(2026, 10, 29), "groceries", "Groceries", "70.00", "out"),
    _future(date(2026, 11, 1), "rent-utilities", "Rent/utilities", "850.00", "out"),
    _future(date(2026, 11, 6), "part-time-pay", "Part-time pay", "650.00", "in"),
)

ALL_EVENTS: tuple[DemoEvent, ...] = PAST_EVENTS + UPCOMING_EVENTS
