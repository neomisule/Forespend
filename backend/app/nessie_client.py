"""All talking to Nessie lives here. Routes never call Nessie directly.

Nessie wants the API key as a `?key=...` query parameter. That means the key
would show up in URLs, httpx logs and error messages, so we silence httpx's
request logging and never put exception text from httpx into our own errors.
"""
import logging

import httpx

from .config import Settings

# httpx logs full request URLs (including ?key=...) at INFO level.
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)

TIMEOUT = httpx.Timeout(10.0)


class NessieError(Exception):
    """A Nessie call failed. The message is safe to show (no API key)."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class NessieClient:
    def __init__(self, settings: Settings):
        self._key = settings.api_key
        self._http = httpx.Client(base_url=settings.base_url, timeout=TIMEOUT)

    def close(self) -> None:
        self._http.close()

    def _request(self, method: str, path: str, json: dict | None = None):
        try:
            resp = self._http.request(method, path, params={"key": self._key}, json=json)
        except httpx.TimeoutException:
            raise NessieError("Nessie did not respond in time. Try again in a moment.") from None
        except httpx.HTTPError:
            raise NessieError("Could not reach Nessie. Check your internet connection.") from None

        if resp.status_code in (401, 403):
            raise NessieError("Nessie rejected the API key. Check NESSIE_API_KEY in backend/.env.")
        if resp.status_code == 404:
            # Nessie also answers 404 (not 401) when the API key is wrong.
            raise NessieError(
                f"Nessie returned 'not found' for {path}. Check that NESSIE_API_KEY and "
                "NESSIE_CUSTOMER_ID in backend/.env are both correct."
            )
        if resp.status_code >= 400:
            raise NessieError(f"Nessie returned an error (HTTP {resp.status_code}) for {method} {path}.")
        try:
            return resp.json()
        except ValueError:
            raise NessieError("Nessie returned a response that was not JSON.") from None

    def get_customer(self, customer_id: str) -> dict:
        data = self._request("GET", f"/customers/{customer_id}")
        if not isinstance(data, dict):
            raise NessieError("Unexpected customer response from Nessie.")
        return data

    def get_accounts(self, customer_id: str) -> list[dict]:
        data = self._request("GET", f"/customers/{customer_id}/accounts")
        if not isinstance(data, list):
            raise NessieError("Unexpected accounts response from Nessie.")
        return data

    def create_account(self, customer_id: str, account_type: str, nickname: str, balance: int) -> dict:
        """Creates one account. `balance` is the opening balance; no deposit is made."""
        body = {"type": account_type, "nickname": nickname, "rewards": 0, "balance": balance}
        data = self._request("POST", f"/customers/{customer_id}/accounts", json=body)
        created = data.get("objectCreated") if isinstance(data, dict) else None
        if not isinstance(created, dict):
            raise NessieError("Nessie did not confirm the account was created.")
        return created
