"""The seam between our app and any language-model provider.

Everything else in the app talks to `ExplanationProvider`. Adding Gemini later
means writing one more module like anthropic_provider.py and one more line in
`get_provider()`; the endpoint and the frontend don't change.
"""
from typing import Protocol

from ..config import AiSettings, ConfigError


class AiUnavailableError(ConfigError):
    """The feature isn't configured (missing key). Message is safe to show."""


class ProviderError(Exception):
    """The provider was configured but the call failed. Message is safe to show."""

    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.status_code = status_code


class ExplanationProvider(Protocol):
    name: str
    model: str

    def complete(self, system: str, messages: list[dict], max_tokens: int) -> str:
        """Returns the assistant's text for a short, non-streaming chat turn."""
        ...


def get_provider(settings: AiSettings) -> ExplanationProvider:
    if settings.provider == "anthropic":
        if not settings.anthropic_api_key:
            raise AiUnavailableError(
                "The live assistant isn't set up: ANTHROPIC_API_KEY is blank in backend/.env."
            )
        from .anthropic_provider import AnthropicProvider  # imported lazily: the SDK is optional at runtime

        return AnthropicProvider(settings.anthropic_api_key, settings.anthropic_model)
    raise AiUnavailableError(f"Unknown AI_PROVIDER '{settings.provider}'. Supported: anthropic.")
