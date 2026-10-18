"""Installment and credit schedules (pure maths) plus the comparison endpoint. No network."""
import copy
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app import main
from app.demo_fixtures import ALL_EVENTS
from app.financing import add_months, credit_plan, installment_schedule

D = Decimal
OCT24 = date(2026, 10, 24)


# ---- installments --------------------------------------------------------------

@pytest.mark.parametrize("frequency,dates", [
    ("weekly", ["2026-10-24", "2026-10-31", "2026-11-07", "2026-11-14"]),
    ("biweekly", ["2026-10-24", "2026-11-07", "2026-11-21", "2026-12-05"]),
    ("monthly", ["2026-10-24", "2026-11-24", "2026-12-24", "2027-01-24"]),
])
def test_four_zero_fee_payments(frequency, dates):
    s = installment_schedule(D("600.00"), OCT24, 4, frequency, D("0.00"))
    assert [p.date.isoformat() for p in s] == dates
    assert [p.amount for p in s] == [D("150.00")] * 4
    assert [p.owed_after for p in s] == [D("450.00"), D("300.00"), D("150.00"), D("0.00")]


def test_rounding_goes_into_the_final_payment():
    s = installment_schedule(D("100.00"), OCT24, 3, "weekly", D("0.00"))
    assert [p.amount for p in s] == [D("33.33"), D("33.33"), D("33.34")]
    s = installment_schedule(D("100.00"), OCT24, 3, "weekly", D("1.00"))  # total 101.00
    assert [p.amount for p in s] == [D("33.66"), D("33.66"), D("33.68")]
    assert [p.financing_part for p in s] == [D("0.33"), D("0.33"), D("0.34")]
    assert sum(p.amount for p in s) == D("101.00") and sum(p.financing_part for p in s) == D("1.00")


def test_monthly_dates_clamp_to_month_end():
    assert add_months(date(2027, 1, 31), 1) == date(2027, 2, 28)
    assert add_months(date(2026, 12, 15), 2) == date(2027, 2, 15)


# ---- credit ----------------------------------------------------------------------

def test_zero_apr_repays_exactly():
    plan = credit_plan(D("600.00"), OCT24, D("0"), D("100.00"), date(2026, 11, 15), horizon=date(2026, 11, 6))
    assert [p.amount for p in plan.payments] == [D("100.00")] * 6
    assert plan.complete and plan.payoff_date == date(2027, 4, 15)
    assert plan.payments[-1].owed_after == 0
    assert plan.owed_at_horizon == D("600.00") and plan.interest_owed_at_horizon == 0


def test_interest_timing_and_owed_at_horizon():
    # 13 days of interest (Oct 25..Nov 6) on 600 at 24.99%: 600 * 0.2499 / 365 * 13 = 5.3403...
    plan = credit_plan(D("600.00"), OCT24, D("24.99"), D("100.00"), date(2026, 11, 15), horizon=date(2026, 11, 6))
    assert plan.owed_at_horizon == D("605.34")
    assert plan.interest_owed_at_horizon == D("5.34")
    first = plan.payments[0]  # 22 days of interest by Nov 15
    assert first.date == date(2026, 11, 15)
    assert first.financing_part == (D("600") * D("24.99") / 100 / 365 * 22).quantize(D("0.01"))
    assert first.principal_part == D("100.00") - first.financing_part
    assert plan.complete and plan.payments[-1].amount < D("100.00")  # last payment is just what's left
    assert plan.payments[-1].owed_after == 0
    total_interest = sum(p.financing_part for p in plan.payments)
    assert sum(p.amount for p in plan.payments) == D("600.00") + total_interest  # repaid once, plus interest


def test_payment_too_small_is_flagged():
    plan = credit_plan(D("600.00"), OCT24, D("24.99"), D("5.00"), date(2026, 11, 15), horizon=date(2026, 11, 6))
    assert plan.payment_too_small and not plan.complete and plan.payoff_date is None
    assert len(plan.payments) <= 2  # stopped early, not 120 rows of a growing debt


def test_long_plans_are_capped():
    # A 31-day month adds about $12.73 of interest; $13.00 covers it, but only just.
    plan = credit_plan(D("600.00"), OCT24, D("24.99"), D("13.00"), date(2026, 11, 15), horizon=date(2026, 11, 6))
    assert not plan.payment_too_small
    assert not plan.complete and len(plan.payments) == 120  # ...but not enough to finish in 10 years


# ---- endpoint ----------------------------------------------------------------------

class FakeNessie:
    calls: list[str] = []
    def __init__(self, settings): pass
    def close(self): pass
    def get_customer(self, cid):
        FakeNessie.calls.append("get_customer")
        return {"_id": cid, "first_name": "Test", "last_name": "User"}
    def get_accounts(self, cid):
        FakeNessie.calls.append("get_accounts")
        return [{"_id": "chk-1", "type": "Checking", "balance": 1200}, {"_id": "sav-1", "type": "Savings", "balance": 400}]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("NESSIE_API_KEY", "test-key")
    monkeypatch.setenv("NESSIE_CUSTOMER_ID", "cust-1")
    monkeypatch.setattr(main, "NessieClient", FakeNessie)
    FakeNessie.calls = []
    return TestClient(main.app)


def compare(**overrides):
    body = {
        "label": "Laptop", "amount": "600.00", "purchase_date": "2026-10-24", "payment": "cash",
        "start_date": "2026-11-01", "end_date": "2026-11-30", "compare": True,
        "installments": {"count": 4, "frequency": "biweekly", "fee": "0.00"},
        "credit": {"apr": "24.99", "monthly_payment": "100.00", "first_payment_date": "2026-11-15"},
    }
    return body | overrides


def opts(body):
    return {o["method"]: o for o in body["options"]}


def day(calendar, d):
    return next(b for b in calendar["daily_balances"] if b["date"] == d)


def test_compare_all_three_from_one_snapshot(client):
    r = client.post("/api/simulations", json=compare())
    assert r.status_code == 200, r.text
    body = r.json()
    o = opts(body)
    assert FakeNessie.calls == ["get_customer", "get_accounts"]  # fetched once for all methods
    assert day(o["cash"]["scenario"], "2026-11-01")["checking"] == "170.00"
    assert day(o["installments"]["scenario"], "2026-11-01")["checking"] == "620.00"  # only Oct 24's $150 so far
    assert day(o["credit"]["scenario"], "2026-11-01")["checking"] == "770.00"  # purchase is debt, not checking
    windows = {(x["comparison"]["window_start"], x["comparison"]["window_end"]) for x in o.values()}
    assert windows == {("2026-10-24", "2026-11-30")}  # same window for every method
    for x in o.values():  # savings never moves
        assert {b["savings"] for b in x["scenario"]["daily_balances"]} == {"400.00"}


def test_installment_option_details(client):
    i = opts(client.post("/api/simulations", json=compare()).json())["installments"]
    assert [(p["date"], p["amount"]) for p in i["schedule"]] == [
        ("2026-10-24", "150.00"), ("2026-11-07", "150.00"), ("2026-11-21", "150.00"), ("2026-12-05", "150.00")]
    assert i["paid_from_checking_in_period"] == "300.00"  # Nov 7 + Nov 21
    assert i["owed_at_window_end"] == "150.00"  # Dec 5 still to pay on Nov 30
    assert i["financing_cost_full_schedule"] == "0.00"
    payments = [e for e in i["scenario"]["events"] if e["source"] == "experiment"]
    assert [e["label"] for e in payments] == ["Laptop · payment 2", "Laptop · payment 3"]


def test_credit_option_details(client):
    body = client.post("/api/simulations", json=compare(start_date="2026-10-01", end_date="2026-10-31")).json()
    c = opts(body)["credit"]
    assert c["comparison"]["window_end"] == "2026-11-06"
    assert c["paid_from_checking_in_period"] == "0.00" and c["paid_from_checking_in_window"] == "0.00"
    assert c["owed_at_window_end"] == "605.34" and c["interest_or_fees_owed_at_window_end"] == "5.34"
    assert c["financing_cost_paid_in_window"] == "0.00"
    assert D(c["financing_cost_full_schedule"]) > 0 and c["full_schedule_complete"]
    assert D(c["total_paid_full_schedule"]) == D("600.00") + D(c["financing_cost_full_schedule"])
    assert not [e for e in c["scenario"]["events"] if e["source"] == "experiment"]  # nothing leaves checking in Oct
    assert any("still owed" in w for w in c["warnings"])


def test_what_leaves_checking_on_the_purchase_date(client):
    o = opts(client.post("/api/simulations", json=compare()).json())
    # Only money leaving checking ON Oct 24, never a later monthly repayment.
    assert o["cash"]["paid_on_purchase_date"] == "600.00"
    assert o["installments"]["paid_on_purchase_date"] == "150.00"
    assert o["credit"]["paid_on_purchase_date"] == "0.00"
    assert o["credit"]["schedule"][0]["date"] == "2026-11-15" and o["credit"]["schedule"][0]["amount"] == "100.00"
    assert (o["cash"]["last_payment_date"], o["installments"]["last_payment_date"]) == ("2026-10-24", "2026-12-05")
    assert o["credit"]["last_payment_date"] == "2027-05-15"
    assert [o[m]["payments_after_scheduled_through"] for m in ("cash", "installments", "credit")] == [False, True, True]


def test_same_window_numbers_are_consistent(client):
    o = opts(client.post("/api/simulations", json=compare(start_date="2026-10-01", end_date="2026-10-31")).json())
    for x in o.values():
        assert x["comparison"]["window_start"] == "2026-10-24" and x["comparison"]["window_end"] == "2026-11-06"
        # Paid by the window end + still owed then = the full plan (when the plan finishes).
        if x["full_schedule_complete"] and x["method"] != "credit":
            assert D(x["paid_from_checking_in_window"]) + D(x["owed_at_window_end"]) == D(x["total_paid_full_schedule"])
    assert o["installments"]["paid_from_checking_in_window"] == "150.00"  # Nov 7 is after Nov 6
    assert o["installments"]["owed_at_window_end"] == "450.00"


def test_carry_forward_into_a_later_month(client):
    o = opts(client.post("/api/simulations", json=compare(start_date="2026-12-01", end_date="2026-12-31")).json())
    base = 1420  # original checking from Nov 6 onward (no later scheduled events)
    assert o["installments"]["scenario"]["opening_balances"]["checking"] == f"{base - 450}.00"  # 3 paid before Dec
    assert day(o["installments"]["scenario"], "2026-12-05")["checking"] == f"{base - 600}.00"
    credit_dec = o["credit"]["scenario"]
    paid_before_dec = sum(D(p["amount"]) for p in o["credit"]["schedule"] if p["date"] < "2026-12-01")
    assert D(credit_dec["opening_balances"]["checking"]) == D(base) - paid_before_dec


def test_coverage_is_reported_for_later_months(client):
    body = client.post("/api/simulations", json=compare(start_date="2026-12-01", end_date="2026-12-31")).json()
    cov = body["coverage"]
    assert cov["scheduled_through"] == "2026-11-06" and cov["window_beyond_coverage"] is True
    labels = {m["label"] for m in cov["not_scheduled_after"]}
    assert {"Rent/utilities", "Part-time pay", "Phone bill"} <= labels
    assert body["baseline"]["scheduled_through"] == "2026-11-06"


def test_insufficient_credit_payment_warns(client):
    body = client.post("/api/simulations", json=compare(
        payment="credit", credit={"apr": "24.99", "monthly_payment": "5.00", "first_payment_date": "2026-11-15"})).json()
    c = opts(body)["credit"]
    assert any("does not cover the interest" in w for w in c["warnings"])
    assert c["full_schedule_complete"] is False and c["payoff_date"] is None
    assert body["payment"] == "credit" and body["scenario"] == c["scenario"]


def test_cash_only_request_still_works(client):
    body = client.post("/api/simulations", json={
        "label": "Laptop", "amount": "600.00", "purchase_date": "2026-10-24",
        "start_date": "2026-11-01", "end_date": "2026-11-30"}).json()
    assert [o["method"] for o in body["options"]] == ["cash"]
    assert day(body["scenario"], "2026-11-01")["checking"] == "170.00"


def test_nothing_is_changed(client):
    before = copy.deepcopy(ALL_EVENTS)
    client.post("/api/simulations", json=compare())
    assert ALL_EVENTS == before
    assert day(client.get("/api/calendar?start_date=2026-11-01&end_date=2026-11-30").json(), "2026-11-01")["checking"] == "770.00"
    assert client.get("/api/profile").json()["accounts"][0]["balance"] == "1200.00"


@pytest.mark.parametrize("overrides,expected", [
    ({"payment": "installments", "installments": None}, "installments terms are required"),
    ({"payment": "credit", "credit": None}, "credit terms are required"),
    ({"installments": {"count": 1, "frequency": "weekly"}}, "installments.count"),
    ({"installments": {"count": 25, "frequency": "weekly"}}, "installments.count"),
    ({"installments": {"count": 4, "frequency": "daily"}}, "installments.frequency"),
    ({"installments": {"count": 4, "frequency": "weekly", "fee": "-1.00"}}, "installments.fee"),
    ({"credit": {"apr": "120", "monthly_payment": "50.00", "first_payment_date": "2026-11-15"}}, "credit.apr"),
    ({"credit": {"apr": "20", "monthly_payment": "0", "first_payment_date": "2026-11-15"}}, "credit.monthly_payment"),
    ({"credit": {"apr": "20", "monthly_payment": "50.00", "first_payment_date": "2026-10-24"}}, "must be after the purchase date"),
    ({"credit": {"apr": "20", "monthly_payment": "50.00", "first_payment_date": "2027-01-10"}}, "within 62 days"),
    ({"purchase_date": "2026-10-10"}, "purchase_date must be after"),
])
def test_invalid_terms_are_rejected(client, overrides, expected):
    r = client.post("/api/simulations", json=compare(**overrides))
    assert r.status_code == 422
    assert expected in r.json()["error"]
