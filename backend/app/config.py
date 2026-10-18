"""Reads settings from backend/.env (or real environment variables)."""
import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

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


# ---- optional AI features (the app works without them) -----------------------

DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5"
DEFAULT_TTS_MODEL = "eleven_multilingual_v2"  # ElevenLabs' documented default for text-to-speech
DEFAULT_STT_MODEL = "scribe_v2"  # the model ElevenLabs documents for speech-to-text


@dataclass(frozen=True)
class AiSettings:
    provider: str  # "anthropic" (more can be added in app/ai/providers.py)
    anthropic_api_key: str
    anthropic_model: str
    elevenlabs_api_key: str
    elevenlabs_voice_id: str  # blank = first voice on the account
    tts_model: str
    stt_model: str

    @property
    def explanations_available(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def speech_available(self) -> bool:
        return bool(self.elevenlabs_api_key)


def get_ai_settings() -> AiSettings:
    # backend/.env is authoritative for these keys. A stale ANTHROPIC_API_KEY set at the
    # Windows user/machine level would otherwise win, because load_dotenv never replaces
    # a variable that already exists in the process environment.
    file_values = dotenv_values(ENV_PATH) if ENV_PATH.exists() else {}
    env = lambda k, default="": ((file_values.get(k) or "").strip() or os.getenv(k, "").strip()) or default  # noqa: E731
    return AiSettings(
        provider=env("AI_PROVIDER", "anthropic").lower(),
        anthropic_api_key=env("ANTHROPIC_API_KEY"),
        anthropic_model=env("ANTHROPIC_MODEL", DEFAULT_ANTHROPIC_MODEL),
        elevenlabs_api_key=env("ELEVENLABS_API_KEY"),
        elevenlabs_voice_id=env("ELEVENLABS_VOICE_ID"),
        tts_model=env("ELEVENLABS_TTS_MODEL", DEFAULT_TTS_MODEL),
        stt_model=env("ELEVENLABS_STT_MODEL", DEFAULT_STT_MODEL),
    )
