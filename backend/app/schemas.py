"""The shape of the JSON our frontend receives (and, for simulations, sends)."""
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints, model_validator


class Account(BaseModel):
    id: str
    nickname: str | None
    type: str  # "checking" | "savings" | "credit_card" | "other"
    balance: str  # decimal string, e.g. "1200.00"


class CalendarEvent(BaseModel):
    id: str
    date: str
    label: str
    amount: str  # always positive, e.g. "45.00"
    direction: str  # "in" | "out"
    account_id: str
    source: str  # "demo_history" | "demo_assumption"
    certainty: str  # "historical" | "estimated"
    period: str  # "past" (already happened) | "projected" (future estimate)


class DailyBalance(BaseModel):
    date: str
    checking: str  # balance at the END of this day
    savings: str


class LowestBalance(BaseModel):
    date: str
    balance: str


class Summary(BaseModel):
    spent_so_far: str
    income_so_far: str
    projected_spending: str
    projected_income: str


class Calendar(BaseModel):
    start_date: str
    end_date: str
    currency: str
    demo_reference_date: str  # fixed day the Nessie balances are treated as "now"
    retrieval_date: str  # real day (America/New_York) the balances were fetched
    scheduled_through: str  # last date with known bills/pay; later days are NOT a complete budget
    opening_balances: dict[str, str]  # balances at the START of start_date
    events: list[CalendarEvent]
    daily_balances: list[DailyBalance]
    lowest_checking: LowestBalance
    shortfall_dates: list[str]
    summary: Summary
    assumptions: list[str]


class Profile(BaseModel):
    profile_id: str
    customer_id: str
    display_name: str
    currency: str
    snapshot_date: str  # YYYY-MM-DD, America/New_York
    accounts: list[Account]
    upcoming_events: list[dict]
    assumptions: str


# ---- POST /api/simulations ---------------------------------------------------

Money = Annotated[Decimal, Field(decimal_places=2)]  # send as a string, e.g. "600.00"


class InstallmentTerms(BaseModel):
    """A hypothetical fixed-payment offer. Real offers have their own terms."""
    count: int = Field(ge=2, le=24)
    frequency: Literal["weekly", "biweekly", "monthly"]
    fee: Money = Field(default=Decimal("0.00"), ge=0, le=Decimal("10000"))  # fixed, disclosed, added to the total


class CreditTerms(BaseModel):
    """An educational repayment plan, not an issuer's real terms."""
    apr: Decimal = Field(ge=0, le=Decimal("99.99"), decimal_places=2)  # purchase APR in percent, e.g. "24.99"
    monthly_payment: Money = Field(gt=0, le=Decimal("100000"))
    first_payment_date: date  # must be after the purchase date


class SimulationRequest(BaseModel):
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    amount: Money = Field(gt=0, le=Decimal("100000"))
    purchase_date: date
    payment: Literal["cash", "installments", "credit"] = "cash"  # the method whose scenario is returned on top
    start_date: date  # the period being displayed
    end_date: date
    installments: InstallmentTerms | None = None  # required when payment == "installments"
    credit: CreditTerms | None = None  # required when payment == "credit"
    compare: bool = False  # also return every method whose terms are given (cash always)

    @model_validator(mode="after")
    def check(self):
        if self.start_date > self.end_date:
            raise ValueError("start_date must not be after end_date.")
        if self.payment == "installments" and self.installments is None:
            raise ValueError("installments terms are required when payment is 'installments'.")
        if self.payment == "credit" and self.credit is None:
            raise ValueError("credit terms are required when payment is 'credit'.")
        if self.installments and self.amount + self.installments.fee < Decimal("0.01") * self.installments.count:
            raise ValueError("installments: each payment must be at least $0.01.")
        if self.credit:
            first = self.credit.first_payment_date
            if first <= self.purchase_date:
                raise ValueError("credit.first_payment_date must be after the purchase date.")
            if (first - self.purchase_date).days > 62:
                raise ValueError("credit.first_payment_date must be within 62 days of the purchase.")
        return self


class SimulationComparison(BaseModel):
    period_start: str
    period_end: str
    ending_checking_before: str  # checking at the end of end_date
    ending_checking_after: str
    difference: str  # after - before, e.g. "-600.00"
    window_start: str  # purchase date
    window_end: str  # last day checked for the lowest balance
    lowest_before: LowestBalance
    lowest_after: LowestBalance
    outcome: Literal["cushion", "shortfall"]  # shortfall = checking goes below 0.00 in the window
    shortfall_dates_after: list[str]


class ScheduledPayment(BaseModel):
    number: int
    date: str
    amount: str  # leaves checking on this date
    financing_part: str  # fee or interest inside `amount`
    principal_part: str
    owed_after: str
    in_window: bool  # on or before the comparison window's end


class MissingItem(BaseModel):
    label: str
    last_scheduled: str


class Coverage(BaseModel):
    scheduled_through: str  # baseline bills/pay are only known up to here
    window_start: str  # the purchase date
    window_end: str  # the same for every method
    window_beyond_coverage: bool
    not_scheduled_after: list[MissingItem]  # recurring-looking items with no dates after scheduled_through


class MethodOption(BaseModel):
    method: Literal["cash", "installments", "credit"]
    title: str
    terms: str  # one-line plain description of the terms used
    scenario: Calendar
    comparison: SimulationComparison
    paid_on_purchase_date: str  # what leaves checking ON the purchase date itself (not later repayments)
    last_payment_date: str | None  # date of the last scheduled payment shown in `schedule`
    payments_after_scheduled_through: bool  # some payments fall after the known bills/pay schedule
    paid_from_checking_in_period: str  # within start_date..end_date
    paid_from_checking_in_window: str
    financing_cost_paid_in_window: str  # fees/interest actually paid by window_end
    financing_cost_full_schedule: str  # all modeled fees/interest over the whole schedule
    total_paid_full_schedule: str
    full_schedule_complete: bool  # False if a credit plan wasn't repaid within the cap
    owed_at_window_end: str  # still owed at window_end (installments left, or card debt incl. interest)
    interest_or_fees_owed_at_window_end: str  # the financing part of owed_at_window_end
    payoff_date: str | None
    schedule: list[ScheduledPayment]
    warnings: list[str]
    assumptions: list[str]


class SimulationResult(BaseModel):
    purchase: CalendarEvent  # the purchase being tested (source "experiment")
    payment: str  # the selected method; `scenario` and `comparison` belong to it
    baseline: Calendar  # original, same snapshot
    scenario: Calendar  # with the purchase
    comparison: SimulationComparison
    assumptions: list[str]
    coverage: Coverage
    options: list[MethodOption]  # the selected method, or all compared methods
