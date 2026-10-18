"""Reads settings from backend/.env (or real environment variables)."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


class ConfigError(Exception):
    """A required setting is missing."""


@dataclass(frozen=True)
class Settings:
    api_key: str
    base_url: str
    customer_id: str


def get_settings() -> Settings:
    load_dotenv(ENV_PATH)
    api_key = os.getenv("NESSIE_API_KEY", "").strip()
    customer_id = os.getenv("NESSIE_CUSTOMER_ID", "").strip()
    if not api_key:
        raise ConfigError(
            f"NESSIE_API_KEY is not set. Paste your key into {ENV_PATH} "
            "(copy .env.example to .env first). Do not share it in chat or commit it."
        )
    if not customer_id:
        raise ConfigError(f"NESSIE_CUSTOMER_ID is not set. Add it to {ENV_PATH}.")
    base_url = os.getenv("NESSIE_BASE_URL", "https://prod-api.nessieisreal.com").strip()
    return Settings(api_key=api_key, base_url=base_url.rstrip("/"), customer_id=customer_id)
