"""Claude via the official Anthropic Python SDK."""
import anthropic

from .providers import AiUnavailableError, ProviderError

TIMEOUT_SECONDS = 30.0


class AnthropicProvider:
    name = "anthropic"

    def __init__(self, api_key: str, model: str):
        self.model = model
        self._client = anthropic.Anthropic(api_key=api_key, timeout=TIMEOUT_SECONDS, max_retries=1)

    def complete(self, system: str, messages: list[dict], max_tokens: int) -> str:
        try:
            resp = self._client.beta.messages.create(
                model=self.model,
                max_tokens=max_tokens,
                system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                output_config={"effort": "low"},  # short, friendly answers; thinking stays adaptive
                # If a safety classifier declines, the API re-runs the request on a fallback model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.AuthenticationError:
            raise AiUnavailableError("The assistant's API key was rejected. Check ANTHROPIC_API_KEY in backend/.env.")
        except anthropic.NotFoundError:
            raise ProviderError(f"The model '{self.model}' was not found. Check ANTHROPIC_MODEL in backend/.env.")
        except anthropic.RateLimitError:
            raise ProviderError("The assistant is busy right now (rate limited). Try again in a moment.", 429)
        except anthropic.APITimeoutError:
            raise ProviderError("The assistant took too long to answer. Try again.", 504)
        except anthropic.APIStatusError as e:
            raise ProviderError(f"The assistant service returned an error (HTTP {e.status_code}).")
        except anthropic.APIConnectionError:
            raise ProviderError("Could not reach the assistant service. Check the server's internet connection.")

        if resp.stop_reason == "refusal":
            raise ProviderError("The assistant declined to answer this question. Try rephrasing it.", 422)
        text = "".join(block.text for block in resp.content if block.type == "text").strip()
        if not text:
            raise ProviderError("The assistant returned an empty answer. Try again.")
        return text
