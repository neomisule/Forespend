# Money Calendar

A financial calendar for students (Technica 2026 hackathon project). It shows a
demo customer's upcoming money in a month calendar and lets you test a purchase
paid by cash, installments, or a credit card before spending.

All data is practice data: account balances come from the Capital One
[Nessie](http://api.nessieisreal.com/) sandbox; past activity and future
events are made-up demo data. Nothing here moves real money.

## What works now

- **Calendar and list** of October–mid-January (demo day: Oct 17, 2026) with
  end-of-day checking balances, past vs. projected days, and day details.
- **Purchase test run**: enter a purchase once and compare
  - **Cash**: the full price leaves checking on the purchase date.
  - **Installments**: a hypothetical fixed-payment offer (number of payments,
    frequency, optional fixed fee; rounding goes into the last payment).
  - **Credit card**: an educational repayment illustration (APR ÷ 365 daily
    interest from the day after purchase, planned monthly repayment).
- Each option answers the same four questions over the same date window, plus a
  plain-language summary, an optional "keep at least $X" cushion check, and
  "What does this mean?" explanations for unfamiliar terms.

- **Ask about these options** (optional, needs keys): "Explain my options",
  suggested questions and follow-ups answered by Claude from the exact
  comparison the server just calculated; **Listen/Stop** reads the shown
  answer aloud and **Record question** transcribes a spoken question into the
  editable question box (both via ElevenLabs). Python does every financial
  calculation; the model only explains. Without keys the app shows its own
  calculated explanation and says the live assistant is unavailable.

Known limits: bills and pay are only scheduled through Nov 6, 2026, so later
days are not a complete budget; installment and credit terms are examples, not
real offers.

## Run it locally (Windows PowerShell)

Requirements: Python 3.11+ and Node.js 20.19+ (or 22.12+).

**1. Backend (FastAPI), terminal 1**

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
Copy-Item .env.example .env   # then paste your Nessie API key into backend\.env
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload
```

Optional AI keys go in the same `backend/.env` (see `.env.example`):
`ANTHROPIC_API_KEY` (+ `ANTHROPIC_MODEL`, default `claude-opus-5-5`) for
explanations, `ELEVENLABS_API_KEY` (+ optional `ELEVENLABS_VOICE_ID`,
`ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`) for speech. `GET /api/ai/status`
shows which are configured without revealing them.

Never commit `backend/.env`. Optional one-time demo account setup:
`.\.venv\Scripts\python.exe -m scripts.seed_accounts` (preview) and add
`--apply` to create missing accounts.

**2. Frontend (React + Vite), terminal 2**

```powershell
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. The dev server forwards `/api` to the backend on
port 8000.

## Tests

```powershell
cd backend;  .\.venv\Scripts\python.exe -m pytest -q
cd frontend; npm run typecheck; npm test; npm run build
```

## API (backend)

| Endpoint | Purpose |
|---|---|
| `GET /api/health` | Health check |
| `GET /api/profile` | Customer, Nessie account balances, upcoming demo events |
| `GET /api/calendar?start_date=&end_date=` | Daily balances and events for a date range |
| `POST /api/simulations` | Compare a hypothetical purchase paid by cash / installments / credit |
| `GET /api/ai/status` | Which optional AI features have keys configured (never the keys) |
| `POST /api/explain` | Answer a question about the current comparison (recalculated server-side, then explained by the model) |
| `POST /api/speech` | Read given text aloud (MP3) |
| `POST /api/transcribe` | Turn a short recording into text |

A full sample calendar response is in `backend/docs/calendar-sample-october.json`.
