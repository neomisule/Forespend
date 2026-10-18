"""Investing illustration: pure maths + endpoint with a fake Nessie. No network."""
import copy
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app import main
from app.demo_fixtures import ALL_EVENTS
from app.investing import contribution_dates, project

D = Decimal


# ---- dates -------------------------------------------------------------------------

def test_contribution_dates_are_real_calendar_dates():
    assert contribution_dates(date(2026, 11, 1), "biweekly", 1)[:3] == [date(2026, 11, 1), date(2026, 11, 15), date(2026, 11, 29)]
    assert len(contribution_dates(date(2026, 11, 1), "biweekly", 1)) == 27  # 365 days / 14 -> 27 dates before Nov 1, 2027
    assert len(contribution_dates(date(2026, 11, 1), "weekly", 1)) == 53
    monthly = contribution_dates(date(2026, 10, 31), "monthly", 1)
    assert monthly[:4] == [date(2026, 10, 31), date(2026, 11, 30), date(2026, 12, 31), date(2027, 1, 31)]  # clamped, not "4 weeks"
    assert len(monthly) == 12


# ---- the convention --------------------------------------------------------------------

def test_zero_return_zero_fee_ends_at_contributions():
    dates = contribution_dates(date(2026, 11, 1), "monthly", 2)
    pts = project(dates, D("25.00"), date(2026, 11, 1), 2, D("0"), D("0"))
    assert len(pts) == 24
    assert pts[-1].value == pts[-1].contributed == D("600.00") and pts[-1].fees == 0


def test_contributions_grow_from_the_following_month():
    dates = [date(2026, 11, 1)]
    pts = project(dates, D("1200.00"), date(2026, 11, 1), 1, D("0.12"), D("0"))
    assert pts[0].value == D("1200.00")  # added at month end, no growth yet
    assert pts[1].value == D("1212.00")  # 1% in the next month


def test_higher_fee_lowers_the_ending_value_and_fee_effect_exceeds_fees_deducted():
    dates = contribution_dates(date(2026, 11, 1), "biweekly", 5)
    no_fee = project(dates, D("25.00"), date(2026, 11, 1), 5, D("0.06"), D("0"))[-1]
    low = project(dates, D("25.00"), date(2026, 11, 1), 5, D("0.06"), D("0.0015"))[-1]
    high = project(dates, D("25.00"), date(2026, 11, 1), 5, D("0.06"), D("0.0125"))[-1]
    assert no_fee.value > low.value > high.value
    assert high.fees > low.fees > 0
    assert no_fee.value - high.value > high.fees  # lost growth on top of the fees taken


def test_adverse_return_can_end_below_contributions():
    dates = contribution_dates(date(2026, 11, 1), "biweekly", 5)
    adverse = project(dates, D("25.00"), date(2026, 11, 1), 5, D("-0.04"), D("0.0125"))[-1]
    assert adverse.value < adverse.contributed


# ---- endpoint -------------------------------------------------------------------------

class FakeNessie:
    def __init__(self, settings): pass
    def close(self): pass
    def get_customer(self, cid): return {"_id": cid, "first_name": "Test", "last_name": "User"}
    def get_accounts(self, cid):
        return [{"_id": "chk-1", "type": "Checking", "balance": 1200}, {"_id": "sav-1", "type": "Savings", "balance": 400}]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("NESSIE_API_KEY", "test-key")
    monkeypatch.setenv("NESSIE_CUSTOMER_ID", "cust-1")
    monkeypatch.setattr(main, "NessieClient", FakeNessie)
    return TestClient(main.app)


def plan(**over):
    return {"contribution": "25.00", "frequency": "biweekly", "start_date": "2026-10-23", "years": 5} | over


def test_endpoint_returns_consistent_results(client):
    r = client.post("/api/investments", json=plan())
    assert r.status_code == 200, r.text
    b = r.json()
    assert b["contributions_count"] == len(b["contribution_dates"]) == 129
    assert b["total_contributions"] == "3225.00" and b["first_contribution"] == "2026-10-23"
    a, f_b = b["funds"]
    assert (a["fee_pct"], f_b["fee_pct"]) == ("0.15", "1.25")
    assert D(a["ending_value"]) > D(f_b["ending_value"]) > D(b["total_contributions"])
    # fees deducted vs total effect of fees, kept separate and consistent
    assert D(a["fee_effect_on_ending"]) == D(a["fees_deducted"]) + D(a["lost_growth"])
    assert D(b["no_fee_ending_value"]) - D(a["ending_value"]) == D(a["fee_effect_on_ending"])
    gap = b["fee_difference"]
    assert D(gap["ending_value_gap"]) == D(a["ending_value"]) - D(f_b["ending_value"])
    assert D(gap["ending_value_gap"]) == D(gap["extra_fees_deducted"]) + D(gap["extra_lost_growth"])
    # the chart/table series ends exactly at the headline numbers
    last = b["series"][-1]
    assert len(b["series"]) == 60 and last["month"] == "2031-09"
    assert (last["fund_a_value"], last["fund_b_value"], last["contributed"]) == (a["ending_value"], f_b["ending_value"], b["total_contributions"])
    assert last["adverse_fund_b_value"] == f_b["adverse_ending_value"]
    assert D(f_b["adverse_ending_value"]) < D(b["total_contributions"])  # adverse can end below what was put in
    assert any("not a forecast" in s for s in b["assumptions"]) and any("month end" in c for c in b["convention"])


def test_cash_flow_is_assessed_only_through_the_known_schedule(client):
    b = client.post("/api/investments", json=plan()).json()
    cf = b["cash_flow"]
    assert cf["assessed_through"] == "2026-11-06"
    assert cf["contributions_in_window"] == 2 and cf["amount_in_window"] == "50.00"  # Oct 23 + Nov 6
    assert cf["contributions_after_coverage"] == 127
    assert cf["lowest_checking_before"] == {"date": "2026-11-01", "balance": "770.00"}
    assert cf["lowest_checking_after"] == {"date": "2026-11-01", "balance": "745.00"}  # one $25 transfer before Nov 1
    assert cf["shortfall_dates_after"] == []


def test_calendar_transfers_match_contribution_dates(client):
    b = client.post("/api/investments", json=plan(calendar_start="2026-11-01", calendar_end="2026-11-30")).json()
    transfers = [e for e in b["scenario"]["events"] if e["source"] == "experiment"]
    assert [e["date"] for e in transfers] == [d for d in b["contribution_dates"] if d.startswith("2026-11")]
    assert all(e["amount"] == "25.00" and e["direction"] == "out" and e["label"].startswith("Invest · transfer") for e in transfers)
    nov1 = {d["date"]: d for d in b["scenario"]["daily_balances"]}["2026-11-01"]
    assert nov1["checking"] == "745.00" and nov1["savings"] == "400.00"
    assert b["baseline"] == client.get("/api/calendar?start_date=2026-11-01&end_date=2026-11-30").json()
    assert client.post("/api/investments", json=plan()).json()["scenario"] is None


def test_nothing_changes(client):
    before = copy.deepcopy(ALL_EVENTS)
    k1 = client.post("/api/investments", json=plan()).json()["plan_key"]
    k2 = client.post("/api/investments", json=plan(calendar_start="2026-11-01", calendar_end="2026-11-30")).json()["plan_key"]
    k3 = client.post("/api/investments", json=plan(fee_b_pct="0.75")).json()["plan_key"]
    assert k1 == k2 != k3  # the calendar period doesn't change the plan; fees do
    assert ALL_EVENTS == before
    assert client.get("/api/profile").json()["accounts"][0]["balance"] == "1200.00"


@pytest.mark.parametrize("over,expected", [
    ({"start_date": "2026-10-17"}, "start_date must be after"),
    ({"years": 0}, "years"),
    ({"years": 11}, "years"),
    ({"contribution": "0"}, "contribution"),
    ({"frequency": "daily"}, "frequency"),
    ({"gross_return_pct": "45"}, "gross_return_pct"),
    ({"fee_a_pct": "-1"}, "fee_a_pct"),
    ({"calendar_start": "2026-11-01"}, "together"),
])
def test_invalid_plans_are_rejected(client, over, expected):
    r = client.post("/api/investments", json=plan(**over))
    assert r.status_code == 422 and expected in r.json()["error"]


def test_assistant_gets_the_investing_context(client, monkeypatch):
    calls = []

    class Fake:
        name, model = "fake", "fake-model"
        def complete(self, system, messages, max_tokens):
            calls.append(messages[-1]["content"]); return "ok"

    from app.config import AiSettings
    monkeypatch.setattr(main, "get_provider", lambda s: Fake())
    monkeypatch.setattr(main, "get_ai_settings", lambda: AiSettings(
        provider="anthropic", anthropic_api_key="x", anthropic_model="m", elevenlabs_api_key="", elevenlabs_voice_id="", tts_model="t", stt_model="s"))
    r = client.post("/api/explain", json={"investment": plan(), "question": "Why do fees matter?", "client_tag": "i1"})
    assert r.status_code == 200, r.text
    assert r.json()["scenario_key"].startswith("invest-")
    ctx = calls[0]
    assert "investing illustration" in ctx and "$25.00 every 2 weeks from Oct 23, 2026 for 5 year(s)" in ctx
    assert "Fund A (lower fee): fee 0.15%/yr" in ctx and "lost growth" in ctx and "assessed only through Nov 6, 2026" in ctx
    assert "chk-1" not in ctx and ctx.rstrip().endswith("QUESTION: Why do fees matter?")
