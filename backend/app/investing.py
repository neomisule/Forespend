"""Hypothetical investing illustration: two funds, same mix and gross return, different fees.

CALCULATION CONVENTION (documented, deterministic, Decimal):
  * The illustration covers 12 * years whole calendar months, starting with the month of
    start_date. Contribution dates are real calendar dates inside that span: from
    start_date, every 7 days (weekly), 14 days (biweekly), or the same day each month
    (monthly, clamped to month end).
  * Month by month, in this order:
      1. growth:   value += value * gross_return / 12          (nominal annual rate ÷ 12)
      2. fee:      value -= value * fee / 12                   (annual fee ÷ 12, on the grown value)
      3. deposits: contributions dated in that month are added at month end,
                   so they start growing (and paying fees) from the next month.
  * Amounts are kept to the cent after each step (ROUND_HALF_UP).
  * "Fees deducted" is the sum of step 2 over the whole period. The "effect of fees
    on the ending value" is ending value with 0% fee minus ending value with the fee;
    it is larger than fees deducted because deducted money also stops growing.
  * The adverse scenario repeats everything with the adverse return instead.
Nothing here is a forecast: the returns are assumptions the user can change.
"""
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal

from .financing import add_months

CENT = Decimal("0.01")
ZERO = Decimal("0")
MAX_YEARS = 10

CONVENTION = [
    "The illustration covers the chosen number of years counted in whole months from the start month. Contribution "
    "dates are real calendar dates inside that span (every 7 days, every 14 days, or the same day each month).",
    "The illustration steps month by month. Each month: growth at the yearly return ÷ 12, then the fund fee at the "
    "yearly fee ÷ 12 on the grown value, then that month's contributions are added at month end.",
    "Contributions therefore start growing, and paying fees, from the month after they are made.",
    "Fees deducted = the fee taken each month, added up. The effect of fees on the ending value also includes the "
    "growth that the deducted money would have earned (lost growth).",
    "The adverse scenario repeats the same steps with the adverse yearly return.",
    "Amounts are rounded to the cent at every step.",
]


def horizon_start(start: date, years: int) -> date:
    """First day after the illustration: 12 * years whole months, counted from the start month."""
    return add_months(date(start.year, start.month, 1), 12 * years, 1)


def contribution_dates(start: date, frequency: str, years: int) -> list[date]:
    horizon = horizon_start(start, years)
    if frequency == "monthly":
        dates, i = [], 0
        while (d := add_months(start, i, start.day)) < horizon:
            dates.append(d)
            i += 1
        return dates
    step = timedelta(days=7 if frequency == "weekly" else 14)
    dates, d = [], start
    while d < horizon:
        dates.append(d)
        d += step
    return dates


@dataclass(frozen=True)
class MonthPoint:
    month: date  # first day of the month
    contributed: Decimal  # cumulative contributions by month end
    value: Decimal  # fund value at month end
    fees: Decimal  # cumulative fees deducted by month end


def project(dates: list[date], amount: Decimal, start: date, years: int, annual_return: Decimal, annual_fee: Decimal) -> list[MonthPoint]:
    """Runs the convention above. `annual_return` and `annual_fee` are fractions (0.06, not 6)."""
    growth_rate = annual_return / 12
    fee_rate = annual_fee / 12
    value = contributed = fees = ZERO
    points = []
    for i in range(12 * years):
        month = add_months(date(start.year, start.month, 1), i, 1)
        next_month = add_months(month, 1, 1)
        value = (value + value * growth_rate).quantize(CENT, rounding=ROUND_HALF_UP)
        fee = (value * fee_rate).quantize(CENT, rounding=ROUND_HALF_UP)
        value -= fee
        fees += fee
        deposits = sum(1 for d in dates if month <= d < next_month)
        contributed += amount * deposits
        value += amount * deposits
        points.append(MonthPoint(month, contributed, value, fees))
    return points
