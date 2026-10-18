"""Optional demo setup. Run from backend/:

  python -m scripts.seed_accounts            # preview only, changes nothing
  python -m scripts.seed_accounts --apply    # create any missing accounts

Never deletes anything and never creates deposits/transactions. If the customer
already has an account of a given type, it is reused and left untouched.
"""
import argparse
import sys

from app.config import ConfigError, get_settings
from app.nessie_client import NessieClient, NessieError

# (Nessie type, nickname, opening balance in USD). Fictional demo values.
WANTED = [
    ("Checking", "Demo Checking", 1200),
    ("Savings", "Demo Savings", 400),
]


def find_existing(accounts: list[dict], account_type: str) -> dict | None:
    return next((a for a in accounts if a.get("type") == account_type), None)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="actually create missing accounts")
    args = parser.parse_args()

    try:
        settings = get_settings()
    except ConfigError as exc:
        print(f"Error: {exc}")
        return 1

    client = NessieClient(settings)
    try:
        customer = client.get_customer(settings.customer_id)
        accounts = client.get_accounts(settings.customer_id)

        print(f"Customer: {customer.get('first_name')} {customer.get('last_name')} ({settings.customer_id})")
        print(f"Existing accounts: {len(accounts)}")
        for a in accounts:
            print(f"  - {a.get('type')} '{a.get('nickname')}' balance={a.get('balance')} id={a.get('_id')}")

        missing = []
        for account_type, nickname, balance in WANTED:
            existing = find_existing(accounts, account_type)
            if existing:
                print(f"REUSE   {account_type}: already exists (balance {existing.get('balance')}), leaving it alone")
            else:
                print(f"CREATE  {account_type} '{nickname}' with opening balance ${balance}.00 (no deposit)")
                missing.append((account_type, nickname, balance))

        if not missing:
            print("Nothing to do.")
            return 0
        if not args.apply:
            print("\nPreview only. Re-run with --apply to create the accounts above.")
            return 0

        for account_type, nickname, balance in missing:
            # Re-check right before creating so a repeat run can't duplicate.
            if find_existing(client.get_accounts(settings.customer_id), account_type):
                print(f"SKIP    {account_type}: appeared since the preview")
                continue
            created = client.create_account(settings.customer_id, account_type, nickname, balance)
            print(f"CREATED {account_type} id={created.get('_id')}")
    except NessieError as exc:
        print(f"Error: {exc}")
        return 1
    finally:
        client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
