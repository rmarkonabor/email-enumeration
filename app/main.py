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

from fastapi import Depends, FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded

from .auth import is_valid_key
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
RATE_LIMIT = os.getenv("RATE_LIMIT", "500/minute")


def _rate_key(request: Request) -> str:
    """Rate-limit per API key (header) so users behind shared IPs don't share a bucket."""
    return request.headers.get("x-api-key") or (request.client.host if request.client else "anon")


limiter = Limiter(key_func=_rate_key, default_limits=[RATE_LIMIT])


async def _purge_loop(cache: Cache, interval_seconds: int) -> None:
    """Background task: periodically delete cache rows past their TTL."""
    while True:
        try:
            await asyncio.sleep(interval_seconds)
            domains, emails = await asyncio.to_thread(cache.purge_expired)
            if domains or emails:
                logger.info("Cache purge: removed %d expired domains, %d expired emails", domains, emails)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Cache purge failed: %s", e)


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

    # Run once on startup so a restart actually clears anything overdue,
    # then every 24h.
    initial_d, initial_e = await asyncio.to_thread(cache.purge_expired)
    if initial_d or initial_e:
        logger.info("Startup cache purge: removed %d expired domains, %d expired emails", initial_d, initial_e)
    purge_task = asyncio.create_task(_purge_loop(cache, 60 * 60 * 24))

    logger.info("Email finder started. db=%s helo=%s", DB_PATH, HELO_HOSTNAME)
    if not API_KEY:
        logger.warning("API_KEY env var is empty. All requests will be rejected.")
    try:
        yield
    finally:
        purge_task.cancel()
        try:
            await purge_task
        except asyncio.CancelledError:
            pass


app = FastAPI(
    title="Email Finder API",
    description="SMTP-based email finder with catch-all detection. "
                "Use as a cheap first-pass before falling back to paid enrichment.",
    version="1.0.0",
    lifespan=lifespan,
)

app.state.limiter = limiter


@app.exception_handler(RateLimitExceeded)
async def _ratelimit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": f"Rate limit exceeded: {exc.detail}. Try again shortly."},
    )


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ----- Auth dependency -----
async def require_api_key(x_api_key: str = Header(default="")) -> None:
    if not await is_valid_key(x_api_key):
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
    return_attempts: bool = Field(default=False)
    verify_provider: str = Field(default="smtp", description="smtp|zerobounce|reoon")
    zerobounce_api_key: str = Field(default="")
    reoon_api_key: str = Field(default="")


class FindResponse(BaseModel):
    email: str | None
    status: str  # verified | catch_all | not_found
    catch_all: bool
    candidates_tried: int
    attempts: list[dict] | None = None
    message: str | None = None
    fallback_recommended: bool
    mail_provider: str | None = None
    credits_used: int = 0


class BatchRequest(BaseModel):
    contacts: list[FindRequest] = Field(..., max_length=MAX_BATCH_SIZE)
    verify_provider: str = Field(default="smtp")
    zerobounce_api_key: str = Field(default="")
    reoon_api_key: str = Field(default="")


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
        mail_provider=result.mail_provider,
        credits_used=result.credits_used,
    )


@app.post(
    "/find",
    response_model=FindResponse,
    dependencies=[Depends(require_api_key)],
    summary="Find a verified email for one contact",
)
@limiter.limit(RATE_LIMIT)
async def find(request: Request, req: FindRequest) -> FindResponse:
    finder: EmailFinder = app.state.finder
    provider_key = req.zerobounce_api_key if req.verify_provider == "zerobounce" else (req.reoon_api_key if req.verify_provider == "reoon" else "")
    try:
        result = await finder.find(
            first_name=req.first_name,
            last_name=req.last_name,
            domain=req.domain,
            middle_name=req.middle_name,
            return_attempts=req.return_attempts,
            provider=req.verify_provider,
            provider_key=provider_key,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _to_response(result, req.return_attempts)


class StreamRequest(BaseModel):
    first_name: str = Field(..., min_length=1)
    last_name: str = Field(..., min_length=1)
    domain: str = Field(..., min_length=3)
    middle_name: str | None = Field(default=None)
    verify_provider: str = Field(default="smtp")
    zerobounce_api_key: str = Field(default="")
    reoon_api_key: str = Field(default="")


@app.post(
    "/find/stream",
    dependencies=[Depends(require_api_key)],
    summary="Stream live progress for a single email lookup (SSE)",
)
@limiter.limit(RATE_LIMIT)
async def find_stream(request: Request, req: StreamRequest) -> StreamingResponse:
    provider_key = req.zerobounce_api_key if req.verify_provider == "zerobounce" else (req.reoon_api_key if req.verify_provider == "reoon" else "")
    finder: EmailFinder = app.state.finder

    async def event_gen():
        try:
            async for event in finder.find_stream(
                req.first_name, req.last_name, req.domain, req.middle_name,
                provider=req.verify_provider, provider_key=provider_key,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error("find_stream error: %s", e, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': 'Verification failed. Please try again.'})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post(
    "/find/batch/stream",
    dependencies=[Depends(require_api_key)],
    summary="Stream live progress for a batch lookup (SSE)",
)
@limiter.limit(RATE_LIMIT)
async def find_batch_stream(request: Request, req: BatchRequest) -> StreamingResponse:
    finder: EmailFinder = app.state.finder

    async def event_gen():
        total = len(req.contacts)
        yield f"data: {json.dumps({'type': 'start', 'total': total})}\n\n"
        for i, contact in enumerate(req.contacts):
            yield f"data: {json.dumps({'type': 'contact_start', 'index': i, 'name': f'{contact.first_name} {contact.last_name}', 'domain': contact.domain})}\n\n"
            try:
                batch_provider_key = req.zerobounce_api_key if req.verify_provider == "zerobounce" else (req.reoon_api_key if req.verify_provider == "reoon" else "")
                result = await finder.find(
                    first_name=contact.first_name,
                    last_name=contact.last_name,
                    domain=contact.domain,
                    middle_name=contact.middle_name,
                    provider=req.verify_provider,
                    provider_key=batch_provider_key,
                )
                resp = _to_response(result, False)
                yield f"data: {json.dumps({'type': 'contact_done', 'index': i, **resp.model_dump()})}\n\n"
            except Exception as e:
                logger.error("batch_stream contact %d error: %s", i, e, exc_info=True)
                yield f"data: {json.dumps({'type': 'contact_done', 'index': i, 'email': None, 'status': 'error', 'catch_all': False, 'candidates_tried': 0, 'message': 'Verification failed. Please try again.', 'fallback_recommended': False})}\n\n"
        yield f"data: {json.dumps({'type': 'done', 'total': total})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post(
    "/find/batch",
    response_model=BatchResponse,
    dependencies=[Depends(require_api_key)],
    summary="Find verified emails for multiple contacts (max 50)",
)
@limiter.limit(RATE_LIMIT)
async def find_batch(request: Request, req: BatchRequest) -> BatchResponse:
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
