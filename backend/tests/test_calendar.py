"""Calendar tests. These use fixtures and a fake Nessie; nothing here touches the network."""
import copy
from datetime import date
from decimal import Decimal

import pytest
from fastapi.testclient import TestClient

from app import main
from app.demo_fixtures import ALL_EVENTS, DEMO_AS_OF, PAST_EVENTS, UPCOMING_EVENTS, DemoEvent
from app.money_calendar import CalendarRangeError, compute_calendar

D = Decimal


def closing(result, day):
    return next(d for d in result.days if d.day == day)


def future_only(start, end, checking="1200.00", events=UPCOMING_EVENTS):
    """$1,200 today and ONLY the eight upcoming events (no history)."""
    return compute_calendar(D(checking), D("400.00"), events, start, end,
                            as_of=DEMO_AS_OF, supported_start=DEMO_AS_OF)


def test_checking_after_nov_1():
    # 1200 -45 -70 +650 -30 -15 -70 -850 = 770.
    # (The milestone brief said 670; the listed events add up to 770.)
    r = future_only(DEMO_AS_OF, date(2026, 11, 1))
    assert closing(r, date(2026, 11, 1)).checking == D("770.00")


def test_checking_after_nov_6():
    # 770 + 650 pay = 1420. (Brief said 1320; same $100 difference as above.)
    r = future_only(DEMO_AS_OF, date(2026, 11, 6))
    assert closing(r, date(2026, 11, 6)).checking == D("1420.00")


def test_savings_unchanged_every_day():
    r = future_only(DEMO_AS_OF, date(2026, 11, 6))
    assert {d.savings for d in r.days} == {D("400.00")}


def test_repeating_does_not_change_source_data():
    before_events = copy.deepcopy(ALL_EVENTS)
    first = future_only(DEMO_AS_OF, date(2026, 11, 6))
    second = future_only(DEMO_AS_OF, date(2026, 11, 6))
    assert first == second
    assert ALL_EVENTS == before_events
    with pytest.raises(Exception):  # fixture events are frozen
        UPCOMING_EVENTS[0].amount = D("1")


def test_history_derives_opening_balance_and_lands_on_current_balance():
    r = compute_calendar(D("1200.00"), D("400.00"), ALL_EVENTS, date(2026, 10, 1), date(2026, 10, 31))
    assert r.opening_checking == D("1670.00")  # 1200 + 470 net spending in Oct 1-17
    # Replaying history ends exactly on the Nessie balance: not changed, not double-counted.
    assert closing(r, DEMO_AS_OF).checking == D("1200.00")
    assert r.lowest_balance == D("725.00") and r.lowest_day == date(2026, 10, 6)
    assert r.shortfall_dates == ()


def test_past_and_projected_spending_are_separate():
    r = compute_calendar(D("1200.00"), D("400.00"), ALL_EVENTS, date(2026, 10, 1), date(2026, 10, 31))
    assert r.spent_so_far == sum(e.amount for e in PAST_EVENTS if e.direction == "out") == D("1120.00")
    assert r.projected_spending == D("230.00")  # 45+70+30+15+70, Nov 1 rent is outside October
    assert r.income_so_far == D("650.00") and r.projected_income == D("650.00")


def test_events_before_visible_start_still_count():
    r = compute_calendar(D("1200.00"), D("400.00"), ALL_EVENTS, date(2026, 10, 25), date(2026, 10, 31))
    assert r.opening_checking == D("1735.00")  # after Oct 20, 22, 23 events
    assert [e.date.day for e in r.events] == [25, 27, 29]


def test_shortfall_dates_and_savings_not_used_to_cover():
    big = DemoEvent("t-1", date(2026, 10, 19), "Laptop", D("1500.00"), "out", "demo_assumption", "estimated")
    r = future_only(DEMO_AS_OF, date(2026, 10, 21), events=(big,))
    assert r.shortfall_dates == (date(2026, 10, 19), date(2026, 10, 20), date(2026, 10, 21))
    assert r.lowest_balance == D("-300.00")
    assert closing(r, date(2026, 10, 19)).savings == D("400.00")


@pytest.mark.parametrize("start,end", [
    (date(2026, 9, 30), date(2026, 10, 31)),  # before supported history
    (date(2026, 10, 20), date(2026, 10, 18)),  # reversed
    (date(2026, 10, 1), date(2027, 3, 1)),  # too far ahead
])
def test_bad_ranges_rejected(start, end):
    with pytest.raises(CalendarRangeError):
        compute_calendar(D("1200.00"), D("400.00"), ALL_EVENTS, start, end)


# ---- the HTTP layer, with a pretend Nessie ---------------------------------

class FakeNessie:
    def __init__(self, settings): pass
    def close(self): pass
    def get_customer(self, cid): return {"_id": cid, "first_name": "Test", "last_name": "User"}
    def get_accounts(self, cid):
        return [
            {"_id": "chk-1", "type": "Checking", "nickname": "Demo Checking", "balance": 1200},
            {"_id": "sav-1", "type": "Savings", "nickname": "Demo Savings", "balance": 400},
        ]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("NESSIE_API_KEY", "test-key")
    monkeypatch.setenv("NESSIE_CUSTOMER_ID", "cust-1")
    monkeypatch.setattr(main, "NessieClient", FakeNessie)
    return TestClient(main.app)


def test_profile_has_linked_upcoming_events(client):
    body = client.get("/api/profile").json()
    events = body["upcoming_events"]
    assert len(events) == 8 and isinstance(body["assumptions"], str)
    assert {e["account_id"] for e in events} == {"chk-1"}
    assert events[0] == {
        "id": "demo-estimate-2026-10-20-phone-bill", "date": "2026-10-20", "label": "Phone bill",
        "amount": "45.00", "direction": "out", "account_id": "chk-1",
        "source": "demo_assumption", "certainty": "estimated",
    }


def test_calendar_endpoint_defaults_to_october(client):
    body = client.get("/api/calendar").json()
    assert (body["start_date"], body["end_date"]) == ("2026-10-01", "2026-10-31")
    assert body["demo_reference_date"] == "2026-10-17"
    assert body["retrieval_date"] != ""  # real fetch date, kept separate from the reference date
    assert body["opening_balances"] == {"checking": "1670.00", "savings": "400.00"}
    assert len(body["daily_balances"]) == 31
    assert body["lowest_checking"] == {"date": "2026-10-06", "balance": "725.00"}


def test_calendar_endpoint_rejects_bad_range(client):
    r = client.get("/api/calendar?start_date=2026-10-20&end_date=2026-10-18")
    assert r.status_code == 422 and "error" in r.json()
