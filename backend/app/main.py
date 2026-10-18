"""FastAPI app. Run from backend/:  uvicorn app.main:app --reload"""
from datetime import date

from fastapi import FastAPI, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .config import ConfigError, get_settings
from .money_calendar import CalendarRangeError, MissingAccountError, build_calendar
from .nessie_client import NessieClient, NessieError
from .profile import build_profile
from .schemas import Calendar, Profile, SimulationRequest, SimulationResult
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
    """Preview one hypothetical cash purchase. Read-only: nothing is saved or paid."""
    return run_simulation(fetch_profile(), req)
