"""POST /api/simulations, using a fake (read-only) Nessie. No network."""
import copy

import pytest
from fastapi.testclient import TestClient

from app import main
from app.demo_fixtures import ALL_EVENTS


class FakeNessie:
    """Only has read methods, so any attempt to write to Nessie would crash the test."""
    calls: list[str] = []

    def __init__(self, settings): pass
    def close(self): pass
    def get_customer(self, cid):
        FakeNessie.calls.append("get_customer")
        return {"_id": cid, "first_name": "Test", "last_name": "User"}
    def get_accounts(self, cid):
        FakeNessie.calls.append("get_accounts")
        return [
            {"_id": "chk-1", "type": "Checking", "nickname": "Demo Checking", "balance": 1200},
            {"_id": "sav-1", "type": "Savings", "nickname": "Demo Savings", "balance": 400},
        ]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("NESSIE_API_KEY", "test-key")
    monkeypatch.setenv("NESSIE_CUSTOMER_ID", "cust-1")
    monkeypatch.setattr(main, "NessieClient", FakeNessie)
    FakeNessie.calls = []
    return TestClient(main.app)


def laptop(**overrides):
    body = {"label": "Laptop", "amount": "600.00", "purchase_date": "2026-10-24", "payment": "cash",
            "start_date": "2026-10-01", "end_date": "2026-10-31"}
    return body | overrides


def by_date(calendar):
    return {d["date"]: d for d in calendar["daily_balances"]}


def test_laptop_drops_nov_1_from_770_to_170(client):
    r = client.post("/api/simulations", json=laptop(start_date="2026-11-01", end_date="2026-11-30"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert by_date(body["baseline"])["2026-11-01"]["checking"] == "770.00"
    assert by_date(body["scenario"])["2026-11-01"]["checking"] == "170.00"
    # Carried into a later month whose first day is after the purchase.
    assert body["scenario"]["opening_balances"]["checking"] == "1020.00"
    assert body["baseline"]["opening_balances"]["checking"] == "1620.00"


def test_october_comparison(client):
    body = client.post("/api/simulations", json=laptop()).json()
    c = body["comparison"]
    assert (c["ending_checking_before"], c["ending_checking_after"], c["difference"]) == ("1620.00", "1020.00", "-600.00")
    # Lowest point looks past October to the Nov 1 rent.
    assert c["lowest_after"] == {"date": "2026-11-01", "balance": "170.00"}
    assert c["lowest_before"] == {"date": "2026-11-01", "balance": "770.00"}
    assert c["window_end"] == "2026-11-06"
    assert c["outcome"] == "cushion" and c["shortfall_dates_after"] == []
    assert body["purchase"] == {
        "id": "experiment-cash-purchase", "date": "2026-10-24", "label": "Laptop", "amount": "600.00",
        "direction": "out", "account_id": "chk-1", "source": "experiment", "certainty": "hypothetical",
        "period": "projected",
    }


def test_only_the_purchase_changes_things(client):
    body = client.post("/api/simulations", json=laptop()).json()
    base, scen = by_date(body["baseline"]), by_date(body["scenario"])
    for day in base:
        assert scen[day]["savings"] == base[day]["savings"] == "400.00"
        if day < "2026-10-24":
            assert scen[day] == base[day]  # past and pre-purchase days untouched
    assert [e for e in body["scenario"]["events"] if e["source"] == "experiment"] == [body["purchase"]]
    assert [e for e in body["scenario"]["events"] if e["source"] != "experiment"] == body["baseline"]["events"]


def test_baseline_matches_the_calendar_endpoint(client):
    sim = client.post("/api/simulations", json=laptop()).json()
    cal = client.get("/api/calendar?start_date=2026-10-01&end_date=2026-10-31").json()
    assert sim["baseline"] == cal


def test_one_snapshot_no_writes_and_fixtures_unchanged(client):
    before = copy.deepcopy(ALL_EVENTS)
    client.post("/api/simulations", json=laptop())
    assert FakeNessie.calls == ["get_customer", "get_accounts"]  # one fetch, read-only
    assert ALL_EVENTS == before
    # The original calendar is unaffected afterwards.
    cal = client.get("/api/calendar?start_date=2026-11-01&end_date=2026-11-30").json()
    assert by_date(cal)["2026-11-01"]["checking"] == "770.00"


def test_big_purchase_is_a_shortfall(client):
    c = client.post("/api/simulations", json=laptop(amount="1000.00")).json()["comparison"]
    assert c["outcome"] == "shortfall"
    assert c["lowest_after"] == {"date": "2026-11-01", "balance": "-230.00"}
    assert c["shortfall_dates_after"][0] == "2026-11-01"


@pytest.mark.parametrize("overrides,expected", [
    ({"purchase_date": "2026-10-17"}, "purchase_date must be after 2026-10-17"),
    ({"purchase_date": "2027-02-01"}, "purchase_date cannot be after"),
    ({"amount": "0"}, "amount"),
    ({"amount": "-5.00"}, "amount"),
    ({"amount": "12.345"}, "amount"),
    ({"label": "   "}, "label"),
    ({"payment": "credit"}, "payment"),
    ({"start_date": "2026-10-31", "end_date": "2026-10-01"}, "start_date must not be after end_date"),
    ({"start_date": "2026-09-01"}, "start_date cannot be before"),
])
def test_rejections_have_readable_errors(client, overrides, expected):
    r = client.post("/api/simulations", json=laptop(**overrides))
    assert r.status_code == 422
    assert expected in r.json()["error"]
