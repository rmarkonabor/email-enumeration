"""FastAPI app exposing the email finder as a small REST API.

Endpoints:
  GET  /health         -> liveness probe
  POST /find           -> find email for one contact
  POST /find/batch     -> find emails for up to 50 contacts in one call

Auth: pass X-API-Key header matching the API_KEY env var.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, Header, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .cache import Cache
from .smtp_verifier import SMTPVerifier
from .verifier import EmailFinder

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("email_finder")

# ----- Configuration (env) -----
API_KEY = os.getenv("API_KEY", "")
SENDER_EMAIL = os.getenv("SENDER_EMAIL", "verify@example.com")
HELO_HOSTNAME = os.getenv("HELO_HOSTNAME", "verifier.example.com")
SMTP_TIMEOUT = float(os.getenv("SMTP_TIMEOUT", "10"))
DB_PATH = os.getenv("DB_PATH", "./data/cache.db")
CATCH_ALL_TTL = int(os.getenv("CATCH_ALL_TTL_SECONDS", str(60 * 60 * 24 * 30)))
VERIFIED_TTL = int(os.getenv("VERIFIED_TTL_SECONDS", str(60 * 60 * 24 * 14)))
PACING_SECONDS = float(os.getenv("PACING_SECONDS", "0.3"))

MAX_BATCH_SIZE = 50


@asynccontextmanager
async def lifespan(app: FastAPI):
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    verifier = SMTPVerifier(
        sender_email=SENDER_EMAIL,
        helo_hostname=HELO_HOSTNAME,
        smtp_timeout=SMTP_TIMEOUT,
    )
    cache = Cache(
        DB_PATH,
        catch_all_ttl=CATCH_ALL_TTL,
        verified_ttl=VERIFIED_TTL,
    )
    app.state.finder = EmailFinder(
        verifier=verifier, cache=cache, pacing_seconds=PACING_SECONDS
    )
    logger.info("Email finder started. db=%s helo=%s", DB_PATH, HELO_HOSTNAME)
    if not API_KEY:
        logger.warning("API_KEY env var is empty. All requests will be rejected.")
    yield


app = FastAPI(
    title="Email Finder API",
    description="SMTP-based email finder with catch-all detection. "
                "Use as a cheap first-pass before falling back to paid enrichment.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----- Auth dependency -----
def require_api_key(x_api_key: str = Header(default="")) -> None:
    if not API_KEY:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="API_KEY not configured on server",
        )
    if x_api_key != API_KEY:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing X-API-Key header",
        )


# ----- Models -----
class FindRequest(BaseModel):
    first_name: str = Field(..., min_length=1, description="Contact's first name")
    last_name: str = Field(..., min_length=1, description="Contact's last name")
    domain: str = Field(..., min_length=3, description="Company domain (e.g. 'notion.so')")
    middle_name: str | None = Field(default=None)
    return_attempts: bool = Field(
        default=False,
        description="Include the full list of candidates tried and their statuses",
    )


class FindResponse(BaseModel):
    email: str | None
    status: str  # verified | catch_all | not_found
    catch_all: bool
    candidates_tried: int
    attempts: list[dict] | None = None
    message: str | None = None
    fallback_recommended: bool


class BatchRequest(BaseModel):
    contacts: list[FindRequest] = Field(..., max_length=MAX_BATCH_SIZE)


class BatchResponse(BaseModel):
    results: list[FindResponse]


# ----- Endpoints -----
@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def _to_response(result, return_attempts: bool) -> FindResponse:
    message = None
    fallback = False
    if result.status == "catch_all":
        message = ("Domain is catch-all; SMTP cannot confirm. "
                   "Fall back to paid enrichment (LeadMagic, Findymail, etc.).")
        fallback = True
    elif result.status == "not_found":
        message = "No candidate verified. Consider a paid enrichment tool."
        fallback = True
    return FindResponse(
        email=result.email,
        status=result.status,
        catch_all=result.catch_all,
        candidates_tried=result.candidates_tried,
        attempts=result.attempts if return_attempts else None,
        message=message,
        fallback_recommended=fallback,
    )


@app.post(
    "/find",
    response_model=FindResponse,
    dependencies=[Depends(require_api_key)],
    summary="Find a verified email for one contact",
)
async def find(req: FindRequest) -> FindResponse:
    finder: EmailFinder = app.state.finder
    try:
        result = await finder.find(
            first_name=req.first_name,
            last_name=req.last_name,
            domain=req.domain,
            middle_name=req.middle_name,
            return_attempts=req.return_attempts,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _to_response(result, req.return_attempts)


@app.get(
    "/find/stream",
    summary="Stream live progress for a single email lookup (SSE)",
)
async def find_stream(
    first_name: str = Query(...),
    last_name: str = Query(...),
    domain: str = Query(...),
    middle_name: str | None = Query(default=None),
    api_key: str = Query(default=""),
) -> StreamingResponse:
    if not API_KEY:
        raise HTTPException(status_code=500, detail="API_KEY not configured on server")
    if api_key != API_KEY:
        raise HTTPException(status_code=401, detail="Invalid or missing api_key")

    finder: EmailFinder = app.state.finder

    async def event_gen():
        try:
            async for event in finder.find_stream(first_name, last_name, domain, middle_name):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post(
    "/find/batch/stream",
    dependencies=[Depends(require_api_key)],
    summary="Stream live progress for a batch lookup (SSE)",
)
async def find_batch_stream(req: BatchRequest) -> StreamingResponse:
    finder: EmailFinder = app.state.finder

    async def event_gen():
        total = len(req.contacts)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        for i, contact in enumerate(req.contacts):
            yield f"data: {json.dumps({'type': 'contact_start', 'index': i, 'name': f'{contact.first_name} {contact.last_name}', 'domain': contact.domain})}\n\n"
            try:
                result = await finder.find(
                    first_name=contact.first_name,
                    last_name=contact.last_name,
                    domain=contact.domain,
                    middle_name=contact.middle_name,
                )
                resp = _to_response(result, False)
                yield f"data: {json.dumps({'type': 'contact_done', 'index': i, **resp.model_dump()})}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'type': 'contact_done', 'index': i, 'email': None, 'status': 'error', 'catch_all': False, 'candidates_tried': 0, 'message': str(e), 'fallback_recommended': False})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post(
    "/find/batch",
    response_model=BatchResponse,
    dependencies=[Depends(require_api_key)],
    summary="Find verified emails for multiple contacts (max 50)",
)
async def find_batch(req: BatchRequest) -> BatchResponse:
    finder: EmailFinder = app.state.finder

    async def _one(contact: FindRequest) -> FindResponse:
        try:
            result = await finder.find(
                first_name=contact.first_name,
                last_name=contact.last_name,
                domain=contact.domain,
                middle_name=contact.middle_name,
                return_attempts=contact.return_attempts,
            )
            return _to_response(result, contact.return_attempts)
        except ValueError as e:
            return FindResponse(
                email=None,
                status="error",
                catch_all=False,
                candidates_tried=0,
                message=str(e),
                fallback_recommended=False,
            )

    # Run with bounded concurrency to avoid hammering a single domain's mail server
    sem = asyncio.Semaphore(5)

    async def _bounded(c: FindRequest) -> FindResponse:
        async with sem:
            return await _one(c)

    results = await asyncio.gather(*(_bounded(c) for c in req.contacts))
    return BatchResponse(results=results)
