"""Turns raw Nessie records into the clean Profile the frontend wants."""
from datetime import datetime
from decimal import Decimal, InvalidOperation
from zoneinfo import ZoneInfo

from .money_calendar import upcoming_events
from .nessie_client import NessieClient
from .schemas import Account, Profile

TYPE_MAP = {"Checking": "checking", "Savings": "savings", "Credit Card": "credit_card"}

ASSUMPTIONS = (
    "This is sandbox demo data from the Capital One Nessie API. "
    "The customer and balances are fictional and are not real financial information. "
    "The upcoming_events are fictional estimates from the app (source 'demo_assumption'), "
    "not records fetched from Nessie."
)


def money(value) -> str:
    try:
        return str(Decimal(str(value)).quantize(Decimal("0.01")))
    except (InvalidOperation, ValueError):
        return "0.00"


def normalize_account(raw: dict) -> Account:
    return Account(
        id=raw.get("_id", ""),
        nickname=raw.get("nickname"),
        type=TYPE_MAP.get(raw.get("type"), "other"),
        balance=money(raw.get("balance", 0)),
    )


def build_profile(client: NessieClient, customer_id: str) -> Profile:
    # Fetch first; we only report what Nessie actually says.
    customer = client.get_customer(customer_id)
    accounts = client.get_accounts(customer_id)
    name = f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip()
    normalized = [normalize_account(a) for a in accounts]
    checking = next((a for a in normalized if a.type == "checking"), None)
    return Profile(
        profile_id="nehal-demo",
        customer_id=customer.get("_id", customer_id),
        display_name=name or "Unknown",
        currency="USD",
        snapshot_date=datetime.now(ZoneInfo("America/New_York")).date().isoformat(),
        accounts=normalized,
        upcoming_events=upcoming_events(checking.id if checking else None),
        assumptions=ASSUMPTIONS,
    )
