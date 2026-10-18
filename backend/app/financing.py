"""Payment schedules for hypothetical installment plans and credit-card repayment.

Plain Python + Decimal. No network, no randomness, nothing saved.

INSTALLMENTS (a made-up fixed-payment offer, not any real provider's terms)
  * total = price + fixed fee; split into `count` equal payments rounded DOWN
    to the cent, and the final payment absorbs the leftover cents.
  * the fee is split across payments the same way, so we always know how much
    of each payment is fee.
  * first payment on the purchase date, then every 7 days / 14 days / month.

CREDIT CARD (an educational illustration, not an issuer statement)
  * the purchase becomes debt on the purchase date; checking is untouched.
  * interest accrues every day after the purchase at APR / 365 on the full
    amount owed. No grace period is modelled: interest starts the next day.
  * accrued interest is rounded to the cent and added to the debt on each
    payment date; the payment then goes to interest first, then principal.
  * payments are monthly on the same day as the first payment (moved to the
    last day of shorter months). The last payment is only what is still owed.
  * we stop after MAX_CREDIT_PAYMENTS payments and say so.
"""
import calendar as stdlib_calendar
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import ROUND_DOWN, ROUND_HALF_UP, Decimal

CENT = Decimal("0.01")
MAX_CREDIT_PAYMENTS = 120  # 10 years of monthly payments
FREQUENCY_DAYS = {"weekly": 7, "biweekly": 14}


def add_months(d: date, months: int, day: int | None = None) -> date:
    """Same day-of-month `months` later, clamped to the month's last day (Jan 31 -> Feb 28)."""
    index = d.year * 12 + (d.month - 1) + months
    year, month = divmod(index, 12)
    month += 1
    last = stdlib_calendar.monthrange(year, month)[1]
    return date(year, month, min(day or d.day, last))


@dataclass(frozen=True)
class Payment:
    number: int
    date: date
    amount: Decimal  # leaves checking on `date`
    financing_part: Decimal  # fee (installments) or interest (credit) inside `amount`
    principal_part: Decimal
    owed_after: Decimal  # still owed right after this payment


# ---- installments ------------------------------------------------------------

def installment_dates(start: date, count: int, frequency: str) -> list[date]:
    if frequency == "monthly":
        return [add_months(start, i, start.day) for i in range(count)]
    step = timedelta(days=FREQUENCY_DAYS[frequency])
    return [start + step * i for i in range(count)]


def _split(total: Decimal, count: int) -> list[Decimal]:
    """Equal parts rounded down to the cent; the last part takes the remainder, so parts sum to total."""
    part = (total / count).quantize(CENT, rounding=ROUND_DOWN)
    return [part] * (count - 1) + [total - part * (count - 1)]


def installment_schedule(price: Decimal, start: date, count: int, frequency: str, fee: Decimal) -> list[Payment]:
    total = price + fee
    amounts, fees = _split(total, count), _split(fee, count)
    owed = total
    schedule = []
    for i, (d, amount, fee_part) in enumerate(zip(installment_dates(start, count, frequency), amounts, fees), 1):
        owed -= amount
        schedule.append(Payment(i, d, amount, fee_part, amount - fee_part, owed))
    return schedule


# ---- credit card -------------------------------------------------------------

@dataclass
class CreditPlan:
    payments: list[Payment] = field(default_factory=list)
    complete: bool = False  # True when the debt reaches 0.00 within the cap
    payoff_date: date | None = None
    payment_too_small: bool = False  # a payment didn't even cover that period's interest
    # Snapshot at the end of the horizon day:
    owed_at_horizon: Decimal = Decimal("0")
    interest_owed_at_horizon: Decimal = Decimal("0")  # unpaid interest included in owed_at_horizon


def credit_plan(price: Decimal, purchase: date, apr: Decimal, planned: Decimal, first_payment: date,
                horizon: date, max_payments: int = MAX_CREDIT_PAYMENTS) -> CreditPlan:
    daily_rate = apr / Decimal(100) / Decimal(365)
    plan = CreditPlan()
    owed = price  # principal + interest already added to the debt
    unpaid_interest = Decimal("0")  # the part of `owed` that is interest
    accrued = Decimal("0")  # interest built up since the last payment date, not yet rounded or added
    next_due = first_payment

    def snapshot():
        pending = accrued.quantize(CENT, rounding=ROUND_HALF_UP)
        plan.owed_at_horizon = owed + pending
        plan.interest_owed_at_horizon = unpaid_interest + pending

    if horizon <= purchase:
        snapshot()
    day = purchase
    while owed > 0 and len(plan.payments) < max_payments:
        day += timedelta(days=1)
        accrued += owed * daily_rate  # interest for this day, on what was owed at the start of it
        if day == next_due:
            interest = accrued.quantize(CENT, rounding=ROUND_HALF_UP)
            accrued = Decimal("0")
            owed += interest
            unpaid_interest += interest
            amount = min(planned, owed)
            if amount <= interest and amount < owed:
                plan.payment_too_small = True
            interest_paid = min(amount, unpaid_interest)
            unpaid_interest -= interest_paid
            owed -= amount
            plan.payments.append(Payment(len(plan.payments) + 1, day, amount, interest_paid, amount - interest_paid, owed))
            next_due = add_months(first_payment, len(plan.payments), first_payment.day)
        if day == horizon:
            snapshot()
        if plan.payment_too_small and day >= horizon:
            break  # the debt can't shrink; no point walking 10 years of it
    if day < horizon:  # paid off (or stopped) before the horizon: nothing more accrues
        snapshot()
    plan.complete = owed == 0
    plan.payoff_date = plan.payments[-1].date if plan.complete else None
    return plan
