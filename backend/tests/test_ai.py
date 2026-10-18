"""AI explanation + speech endpoints with MOCKED providers. Nothing here calls Anthropic or ElevenLabs."""
import io

import pytest
from fastapi.testclient import TestClient

from app import main
from app.ai import speech
from app.ai.providers import ProviderError
from app.config import AiSettings


class FakeNessie:
    def __init__(self, settings): pass
    def close(self): pass
    def get_customer(self, cid): return {"_id": cid, "first_name": "Test", "last_name": "User"}
    def get_accounts(self, cid):
        return [{"_id": "chk-1", "type": "Checking", "balance": 1200}, {"_id": "sav-1", "type": "Savings", "balance": 400}]


class FakeProvider:
    """Records the prompt it was given and returns a canned answer."""
    name, model = "fake", "fake-model"
    calls: list[dict] = []

    def complete(self, system, messages, max_tokens):
        FakeProvider.calls.append({"system": system, "messages": messages, "max_tokens": max_tokens})
        return "Canned answer."


def ai_settings(**over):
    base = dict(provider="anthropic", anthropic_api_key="", anthropic_model="claude-opus-5-5",
                elevenlabs_api_key="", elevenlabs_voice_id="", tts_model="tts-x", stt_model="stt-x")
    return AiSettings(**(base | over))


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("NESSIE_API_KEY", "test-key")
    monkeypatch.setenv("NESSIE_CUSTOMER_ID", "cust-1")
    monkeypatch.setattr(main, "NessieClient", FakeNessie)
    monkeypatch.setattr(main, "get_provider", lambda settings: FakeProvider())
    monkeypatch.setattr(main, "get_ai_settings", lambda: ai_settings(anthropic_api_key="x", elevenlabs_api_key="y"))
    FakeProvider.calls = []
    return TestClient(main.app)


def explain_body(**over):
    body = {
        "simulation": {
            "label": "Laptop", "amount": "600.00", "purchase_date": "2026-10-24", "payment": "cash",
            "start_date": "2026-10-01", "end_date": "2026-10-31",
            "installments": {"count": 4, "frequency": "biweekly", "fee": "0.00"},
            "credit": {"apr": "24.99", "monthly_payment": "100.00", "first_payment_date": "2026-11-15"},
        },
        "selected_method": "credit",
        "question": "Why does credit leave more cash?",
        "cushion": "500.00",
        "client_tag": "tag-1",
    }
    return body | over


# ---- explanations ------------------------------------------------------------------

def test_scenario_context_reaches_the_provider(client):
    r = client.post("/api/explain", json=explain_body())
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["answer"] == "Canned answer." and body["client_tag"] == "tag-1"
    assert body["provider"] == "fake" and body["model"] == "fake-model"
    assert (body["window_start"], body["window_end"], body["scheduled_through"]) == ("2026-10-24", "2026-11-06", "2026-11-06")
    assert len(body["scenario_key"]) == 16

    prompt = FakeProvider.calls[0]["messages"][-1]["content"]
    assert prompt.startswith("SCENARIO")
    assert "Laptop, $600.00, bought Oct 24, 2026" in prompt
    assert "CREDIT CARD (currently selected on the calendar)" in prompt
    # The numbers Python calculated, for every method:
    assert "CASH: Pay $600.00 from checking" in prompt and "Lowest checking in the window: $170.00 on Nov 1, 2026" in prompt
    assert "Leaves checking on the purchase date: $150.00" in prompt  # installments
    assert "Leaves checking on the purchase date: $0.00" in prompt and "Still owed on Nov 6, 2026: $605.34 (includes $5.34 interest)" in prompt
    assert "$43.73 over the full plan; plan ends May 15, 2027" in prompt
    assert "Payments: Nov 15, 2026 $100.00, Dec 15, 2026 $100.00" in prompt
    # Cushion is judged in Python, not by the model:
    assert "BELOW the $500.00 cushion: lowest $170.00 on Nov 1, 2026" in prompt
    assert "stays at or above the $500.00 cushion through Nov 6, 2026" in prompt
    assert "SCHEDULED_THROUGH: Nov 6, 2026" in prompt and "GLOSSARY" in prompt


def test_question_is_last_and_no_identifiers_are_sent(client):
    client.post("/api/explain", json=explain_body())
    prompt = FakeProvider.calls[0]["messages"][-1]["content"]
    assert prompt.rstrip().endswith("QUESTION: Why does credit leave more cash?")
    for private in ("chk-1", "sav-1", "cust-1", "Test User", "0c5083b5"):
        assert private not in prompt
    system = FakeProvider.calls[0]["system"]
    assert "never calculate" in system.lower() or "Explain; never calculate" in system
    assert "edit the form" in system


def test_no_scenario_answers_general_questions_only(client):
    r = client.post("/api/explain", json={"question": "What is APR?", "client_tag": "g1"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["scenario_key"] == "none" and body["client_tag"] == "g1"
    assert (body["window_start"], body["window_end"], body["scheduled_through"]) == ("", "", "")
    prompt = FakeProvider.calls[0]["messages"][-1]["content"]
    assert "NO personal numbers" in prompt and "Never invent a purchase" in prompt
    assert "GLOSSARY" in prompt and "Yearly interest rate (APR)" in prompt
    assert "$600.00" not in prompt and "Laptop" not in prompt  # nothing made up
    assert prompt.rstrip().endswith("QUESTION: What is APR?")


def test_selected_method_defaults_to_the_simulation_payment(client):
    body = explain_body()
    body["simulation"]["payment"] = "installments"
    del body["selected_method"]
    assert client.post("/api/explain", json=body).status_code == 200
    assert "INSTALLMENTS (currently selected on the calendar)" in FakeProvider.calls[0]["messages"][-1]["content"]


def test_history_is_passed_as_turns_and_bounded(client):
    hist = [{"question": "q1", "answer": "a1"}, {"question": "q2", "answer": "a2"}]
    r = client.post("/api/explain", json=explain_body(history=hist))
    assert r.status_code == 200
    roles = [m["role"] for m in FakeProvider.calls[0]["messages"]]
    assert roles == ["user", "assistant", "user", "assistant", "user"]
    too_many = [{"question": f"q{i}", "answer": "a"} for i in range(4)]
    assert client.post("/api/explain", json=explain_body(history=too_many)).status_code == 422


def test_scenario_key_changes_with_inputs_only(client):
    k1 = client.post("/api/explain", json=explain_body()).json()["scenario_key"]
    k_same = client.post("/api/explain", json=explain_body(question="other question?")).json()["scenario_key"]
    k_method = client.post("/api/explain", json=explain_body(selected_method="cash")).json()["scenario_key"]
    k_cushion = client.post("/api/explain", json=explain_body(cushion=None)).json()["scenario_key"]
    sim = explain_body()["simulation"] | {"amount": "650.00"}
    k_amount = client.post("/api/explain", json=explain_body(simulation=sim)).json()["scenario_key"]
    assert k1 == k_same
    assert len({k1, k_method, k_cushion, k_amount}) == 4


@pytest.mark.parametrize("over,field", [
    ({"question": ""}, "question"),
    ({"question": "x" * 501}, "question"),
    ({"cushion": "-1"}, "cushion"),
    ({"selected_method": "bitcoin"}, "selected_method"),
    ({"client_tag": "t" * 121}, "client_tag"),
])
def test_explain_input_bounds(client, over, field):
    r = client.post("/api/explain", json=explain_body(**over))
    assert r.status_code == 422 and field in r.json()["error"]


def test_missing_key_is_understandable(client, monkeypatch):
    from app.ai.providers import get_provider  # the real factory
    monkeypatch.setattr(main, "get_provider", get_provider)
    monkeypatch.setattr(main, "get_ai_settings", lambda: ai_settings())  # blank keys
    r = client.post("/api/explain", json=explain_body())
    assert r.status_code == 503
    assert "ANTHROPIC_API_KEY" in r.json()["error"] and "backend/.env" in r.json()["error"]
    assert client.get("/api/ai/status").json() == {
        "explanations": False, "speech": False, "transcription": False, "provider": None, "model": None,
        "missing": ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY"],
    }


def test_provider_failure_is_reported_not_faked(client, monkeypatch):
    class Failing(FakeProvider):
        def complete(self, *a, **k):
            raise ProviderError("The assistant is busy right now (rate limited). Try again in a moment.", 429)
    monkeypatch.setattr(main, "get_provider", lambda s: Failing())
    r = client.post("/api/explain", json=explain_body())
    assert r.status_code == 429 and "busy" in r.json()["error"]


def test_cut_off_answers_end_at_a_full_sentence():
    from app.ai.anthropic_provider import _complete_sentences

    assert _complete_sentences("Cash costs nothing extra. Credit adds $8.68 by Nov 30, 2026. The plan en") == (
        "Cash costs nothing extra. Credit adds $8.68 by Nov 30, 2026."
    )
    assert _complete_sentences("Cash costs nothing extra.") == "Cash costs nothing extra."
    assert _complete_sentences("Cash costs nothing ext") == ""  # better an error than half a thought


def test_prompt_money_is_formatted_like_the_app():
    from app.ai.explain import _usd

    assert _usd("1200.00") == "$1,200.00"
    assert _usd("-430.00") == "-$430.00"  # never "$-430.00"
    assert _usd("0.00") == "$0.00"


def test_system_prompt_asks_for_a_direct_answer_then_a_short_comparison(client):
    client.post("/api/explain", json=explain_body())
    system = FakeProvider.calls[0]["system"]
    assert "direct answer" in system and "Cash, Installments, Credit" in system
    assert "no headings, no tables" in system and "no HTML" in system
    assert "-$430.00, never $-430.00" in system


def test_status_reports_configured_features(client):
    assert client.get("/api/ai/status").json() == {
        "explanations": True, "speech": True, "transcription": True,
        "provider": "anthropic", "model": "claude-opus-5-5", "missing": [],
    }


# ---- speech (ElevenLabs mocked at the HTTP layer) ------------------------------------

class FakeResponse:
    def __init__(self, status_code=200, content=b"", json_body=None):
        self.status_code, self.content, self._json = status_code, content, json_body
    def json(self): return self._json


def test_speech_reads_the_given_text(client, monkeypatch):
    seen = {}
    def fake_request(method, url, timeout, **kw):
        seen.update(method=method, url=url, kw=kw)
        if url.endswith("/voices"):
            return FakeResponse(json_body={"voices": [{"voice_id": "voice-abc"}]})
        return FakeResponse(content=b"ID3fake-mp3")
    monkeypatch.setattr(speech.httpx, "request", fake_request)
    monkeypatch.setattr(speech, "_default_voice", None)
    r = client.post("/api/speech", json={"text": "Cash takes $600 now, on Oct 24, 2026.", "client_tag": "t9"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("audio/mpeg")
    assert r.content == b"ID3fake-mp3" and r.headers["x-client-tag"] == "t9"
    assert seen["url"].endswith("/text-to-speech/voice-abc")
    # The voice gets the spoken form; the visible answer in the browser is untouched.
    assert seen["kw"]["json"] == {"text": "Cash takes six hundred dollars now, on October twenty-fourth, twenty twenty-six.", "model_id": "tts-x"}
    assert seen["kw"]["headers"]["xi-api-key"] == "y" and seen["kw"]["params"] == {"output_format": "mp3_44100_128"}


def test_speech_limits_and_missing_key(client, monkeypatch):
    assert client.post("/api/speech", json={"text": "x" * 2001}).status_code == 422
    monkeypatch.setattr(main, "get_ai_settings", lambda: ai_settings())
    r = client.post("/api/speech", json={"text": "hello"})
    assert r.status_code == 503 and "ELEVENLABS_API_KEY" in r.json()["error"]


def test_transcribe_returns_text_and_echoes_tag(client, monkeypatch):
    seen = {}
    def fake_request(method, url, timeout, **kw):
        seen.update(url=url, kw=kw)
        return FakeResponse(json_body={"text": "  Why does credit leave more cash?  ", "language_code": "en"})
    monkeypatch.setattr(speech.httpx, "request", fake_request)
    r = client.post("/api/transcribe", data={"client_tag": "t3"},
                    files={"file": ("question.webm", io.BytesIO(b"\x1aE\xdf\xa3fake"), "audio/webm")})
    assert r.status_code == 200 and r.json() == {"text": "Why does credit leave more cash?", "client_tag": "t3"}
    assert seen["url"].endswith("/speech-to-text") and seen["kw"]["data"] == {"model_id": "stt-x"}
    name, data, ctype = seen["kw"]["files"]["file"]
    assert (name, ctype) == ("question.webm", "audio/webm")  # the browser's real format is passed through


def test_transcribe_failures_are_clear(client, monkeypatch):
    monkeypatch.setattr(speech.httpx, "request", lambda *a, **k: FakeResponse(json_body={"text": ""}))
    r = client.post("/api/transcribe", files={"file": ("q.webm", io.BytesIO(b"abc"), "audio/webm")})
    assert r.status_code == 422 and "No speech was recognised" in r.json()["error"]
    monkeypatch.setattr(speech.httpx, "request", lambda *a, **k: FakeResponse(status_code=401))
    r = client.post("/api/transcribe", files={"file": ("q.webm", io.BytesIO(b"abc"), "audio/webm")})
    assert r.status_code == 503 and "rejected the API key" in r.json()["error"]
    # A restricted key: ElevenLabs says which permission is missing; we pass that on.
    denied = {"detail": {"status": "missing_permissions", "message": "The API key you used is missing the permission voices_read to execute this operation."}}
    monkeypatch.setattr(speech.httpx, "request", lambda *a, **k: FakeResponse(status_code=401, json_body=denied))
    monkeypatch.setattr(speech, "_default_voice", None)
    r = client.post("/api/speech", json={"text": "hello"})
    assert r.status_code == 503 and "'voices_read' permission" in r.json()["error"] and "ELEVENLABS_VOICE_ID" in r.json()["error"]


@pytest.mark.parametrize("status_code,status,expected", [
    (400, "voice_not_found", "was not found on this ElevenLabs account"),
    (402, "paid_plan_required", "account's current plan (paid_plan_required)"),
    (401, "quota_exceeded", "account's current plan (quota_exceeded)"),
])
def test_elevenlabs_plan_and_voice_problems_are_explained(client, monkeypatch, status_code, status, expected):
    monkeypatch.setattr(main, "get_ai_settings", lambda: ai_settings(elevenlabs_api_key="y", elevenlabs_voice_id="abc"))
    body = {"detail": {"status": status, "message": "ElevenLabs says no."}}
    monkeypatch.setattr(speech.httpx, "request", lambda *a, **k: FakeResponse(status_code=status_code, json_body=body))
    r = client.post("/api/speech", json={"text": "hello"})
    assert r.status_code == 503 and expected in r.json()["error"]
    big = io.BytesIO(b"0" * (speech.MAX_AUDIO_BYTES + 1))
    r = client.post("/api/transcribe", files={"file": ("q.webm", big, "audio/webm")})
    assert r.status_code == 422 and "too large" in r.json()["error"]
