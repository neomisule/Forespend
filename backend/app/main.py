"""FastAPI app. Run from backend/:  uvicorn app.main:app --reload"""
from datetime import date

from fastapi import FastAPI, File, Form, Query, Request, UploadFile
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from .ai import speech
from .ai.explain import run_explanation
from .ai.providers import ProviderError, get_provider
from .config import ConfigError, get_ai_settings, get_settings
from .money_calendar import CalendarRangeError, MissingAccountError, build_calendar
from .nessie_client import NessieClient, NessieError
from .profile import build_profile
from .investing_plan import run_investment
from .schemas import (
    AiStatus,
    Calendar,
    ExplainRequest,
    ExplainResponse,
    InvestmentRequest,
    InvestmentResult,
    Profile,
    SimulationRequest,
    SimulationResult,
    SpeechRequest,
    TranscriptResponse,
)
from .simulation import run_simulation

app = FastAPI(title="Financial Calendar API")

DEFAULT_START = date(2026, 10, 1)
DEFAULT_END = date(2026, 10, 31)

# Lets the frontend dev server call us. Vite=5173, CRA/Next=3000.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.exception_handler(ConfigError)
async def config_error_handler(request: Request, exc: ConfigError):
    return JSONResponse(status_code=503, content={"error": str(exc)})


@app.exception_handler(NessieError)
async def nessie_error_handler(request: Request, exc: NessieError):
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc)})


@app.exception_handler(CalendarRangeError)
async def calendar_range_error_handler(request: Request, exc: CalendarRangeError):
    return JSONResponse(status_code=422, content={"error": str(exc)})


@app.exception_handler(RequestValidationError)
async def validation_error_handler(request: Request, exc: RequestValidationError):
    # Same {"error": "..."} shape as our other errors; FastAPI's "detail" is kept for compatibility.
    first = exc.errors()[0] if exc.errors() else {}
    field = ".".join(p for p in first.get("loc", ()) if isinstance(p, str) and p not in ("body", "query"))
    message = f"{field}: {first.get('msg', 'invalid value')}" if field else first.get("msg", "Invalid request.")
    return JSONResponse(status_code=422, content={"error": message, "detail": jsonable_encoder(exc.errors())})


@app.exception_handler(MissingAccountError)
async def missing_account_error_handler(request: Request, exc: MissingAccountError):
    return JSONResponse(status_code=409, content={"error": str(exc)})


@app.exception_handler(ProviderError)
async def provider_error_handler(request: Request, exc: ProviderError):
    return JSONResponse(status_code=exc.status_code, content={"error": str(exc)})


@app.get("/api/health")
def health():
    return {"status": "ok"}


def fetch_profile() -> Profile:
    settings = get_settings()
    client = NessieClient(settings)
    try:
        return build_profile(client, settings.customer_id)
    finally:
        client.close()


@app.get("/api/profile", response_model=Profile)
def profile():
    return fetch_profile()


@app.get("/api/calendar", response_model=Calendar)
def calendar(
    start_date: date = Query(DEFAULT_START, description="YYYY-MM-DD; earliest 2026-10-01"),
    end_date: date = Query(DEFAULT_END, description="YYYY-MM-DD; default is the end of October"),
):
    return build_calendar(fetch_profile(), start_date, end_date)


@app.post("/api/simulations", response_model=SimulationResult)
def simulate(req: SimulationRequest):
    """Preview one hypothetical purchase. Read-only: nothing is saved or paid."""
    return run_simulation(fetch_profile(), req)


@app.post("/api/investments", response_model=InvestmentResult)
def invest(req: InvestmentRequest):
    """Illustrate regular contributions into two funds that differ only in fees. Read-only."""
    return run_investment(fetch_profile(), req)


# ---- optional AI features -------------------------------------------------------------

@app.get("/api/ai/status", response_model=AiStatus)
def ai_status():
    """Which optional features are configured. Never includes key values."""
    s = get_ai_settings()
    missing = []
    if not s.explanations_available:
        missing.append("ANTHROPIC_API_KEY")
    if not s.speech_available:
        missing.append("ELEVENLABS_API_KEY")
    return AiStatus(
        explanations=s.explanations_available,
        speech=s.speech_available,
        transcription=s.speech_available,
        provider=s.provider if s.explanations_available else None,
        model=s.anthropic_model if s.explanations_available else None,
        missing=missing,
    )


@app.post("/api/explain", response_model=ExplainResponse)
def explain(req: ExplainRequest):
    """Explain the current comparison. Python recalculates the numbers; the model only explains them."""
    provider = get_provider(get_ai_settings())
    return run_explanation(fetch_profile(), req, provider)


@app.post("/api/speech")
def speak(req: SpeechRequest):
    """Reads the given text aloud (MP3). Called only when the user presses Listen."""
    audio = speech.synthesize(get_ai_settings(), req.text)
    return Response(content=audio, media_type="audio/mpeg", headers={"X-Client-Tag": req.client_tag[:120]})


@app.post("/api/transcribe", response_model=TranscriptResponse)
async def transcribe(file: UploadFile = File(...), client_tag: str = Form("")):
    """Turns a short recording into text. The browser shows it for editing before sending."""
    data = await file.read(speech.MAX_AUDIO_BYTES + 1)
    text = speech.transcribe(get_ai_settings(), data, file.filename or "", file.content_type or "")
    return TranscriptResponse(text=text, client_tag=client_tag[:120])
