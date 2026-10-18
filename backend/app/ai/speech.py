"""ElevenLabs text-to-speech and speech-to-text, called from the server only.

Endpoints (verified against the ElevenLabs API reference):
  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=...   JSON {text, model_id}
  POST https://api.elevenlabs.io/v1/speech-to-text                                  multipart {file, model_id}
  GET  https://api.elevenlabs.io/v1/voices                                          (to pick a default voice)
The key goes in the `xi-api-key` header and never leaves this module.
"""
import logging

import httpx

from ..config import AiSettings
from .providers import AiUnavailableError, ProviderError

BASE_URL = "https://api.elevenlabs.io/v1"
MAX_SPEECH_CHARS = 2000
MAX_AUDIO_BYTES = 10 * 1024 * 1024
OUTPUT_FORMAT = "mp3_44100_128"  # ElevenLabs' default mp3; plays in every browser
TTS_TIMEOUT = httpx.Timeout(45.0)
STT_TIMEOUT = httpx.Timeout(60.0)

logging.getLogger("httpx").setLevel(logging.WARNING)  # its INFO logs would include request URLs

_default_voice: str | None = None  # looked up once per process when ELEVENLABS_VOICE_ID is blank


def _require_key(settings: AiSettings) -> dict:
    if not settings.elevenlabs_api_key:
        raise AiUnavailableError("Speech isn't set up: ELEVENLABS_API_KEY is blank in backend/.env.")
    return {"xi-api-key": settings.elevenlabs_api_key}


def _raise_for(resp: httpx.Response, what: str) -> None:
    if resp.status_code == 401:
        raise AiUnavailableError("The speech service rejected the API key. Check ELEVENLABS_API_KEY in backend/.env.")
    if resp.status_code == 422:
        raise ProviderError(f"The speech service rejected the {what} request (invalid input or model id).", 422)
    if resp.status_code == 429:
        raise ProviderError("The speech service is busy (rate limited). Try again in a moment.", 429)
    if resp.status_code >= 400:
        raise ProviderError(f"The speech service returned an error for {what} (HTTP {resp.status_code}).")


def _call(method: str, url: str, what: str, timeout: httpx.Timeout, **kwargs) -> httpx.Response:
    try:
        resp = httpx.request(method, url, timeout=timeout, **kwargs)
    except httpx.TimeoutException:
        raise ProviderError(f"The speech service took too long ({what}). Try again.", 504)
    except httpx.HTTPError:
        raise ProviderError("Could not reach the speech service. Check the server's internet connection.")
    _raise_for(resp, what)
    return resp


def default_voice_id(settings: AiSettings) -> str:
    global _default_voice
    if settings.elevenlabs_voice_id:
        return settings.elevenlabs_voice_id
    if _default_voice is None:
        resp = _call("GET", f"{BASE_URL}/voices", "voice list", TTS_TIMEOUT, headers=_require_key(settings))
        voices = resp.json().get("voices") or []
        if not voices:
            raise ProviderError("No voices are available on this ElevenLabs account; set ELEVENLABS_VOICE_ID.")
        _default_voice = voices[0]["voice_id"]
    return _default_voice


def synthesize(settings: AiSettings, text: str) -> bytes:
    """Returns MP3 bytes for `text`."""
    headers = _require_key(settings)
    text = text.strip()
    if not text:
        raise ProviderError("There is no text to read.", 422)
    if len(text) > MAX_SPEECH_CHARS:
        raise ProviderError(f"That text is too long to read aloud (limit {MAX_SPEECH_CHARS} characters).", 422)
    voice = default_voice_id(settings)
    resp = _call(
        "POST",
        f"{BASE_URL}/text-to-speech/{voice}",
        "text-to-speech",
        TTS_TIMEOUT,
        headers={**headers, "Accept": "audio/mpeg"},
        params={"output_format": OUTPUT_FORMAT},
        json={"text": text, "model_id": settings.tts_model},
    )
    if not resp.content:
        raise ProviderError("The speech service returned no audio.")
    return resp.content


def transcribe(settings: AiSettings, audio: bytes, filename: str, content_type: str) -> str:
    """Returns the transcript text for a short recording."""
    headers = _require_key(settings)
    if not audio:
        raise ProviderError("The recording was empty.", 422)
    if len(audio) > MAX_AUDIO_BYTES:
        raise ProviderError("The recording is too large (limit 10 MB). Try a shorter question.", 422)
    resp = _call(
        "POST",
        f"{BASE_URL}/speech-to-text",
        "speech-to-text",
        STT_TIMEOUT,
        headers=headers,
        files={"file": (filename or "question.webm", audio, content_type or "application/octet-stream")},
        data={"model_id": settings.stt_model},
    )
    if resp.status_code == 202:
        raise ProviderError("The speech service queued the transcription instead of returning it. Try again.")
    body = resp.json()
    text = (body.get("text") or "").strip()
    if not text:
        raise ProviderError("No speech was recognised in the recording. Try again, closer to the microphone.", 422)
    return text
