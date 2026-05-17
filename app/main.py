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

from .auth import UserContext, invalidate_cache, validate_key
from .cache import Cache
from .metrics import Metrics, Warmup
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

# ----- SMTP warm-up -----
# Daily-cap schedule lives in metrics.DEFAULT_STEPPED_SCHEDULE (B2B-tuned).
# Only the operational knobs are env-tunable here.
WARMUP_SOFT_BLOCK_THRESHOLD = float(os.getenv("WARMUP_SOFT_BLOCK_THRESHOLD", "0.05"))
WARMUP_PER_DOMAIN_CAP = int(os.getenv("WARMUP_PER_DOMAIN_CAP", "40"))


def _parse_source_ips(raw: str) -> tuple[list[str], dict[str, str]]:
    """Parse SMTP_SOURCE_IPS env var into (ips, ip->helo map).

    Accepts comma-separated entries, each either a plain IP or an ip:helo pair:
      5.78.84.39:verify1.mailcheckhq.com,5.78.29.123:verify2.mailcheckhq.com

    IPv6 is rejected (the colon split assumes IPv4 dotted-quad). Duplicate IPs
    are collapsed to keep warmup capacity reporting honest.
    """
    ips: list[str] = []
    helo_map: dict[str, str] = {}
    seen: set[str] = set()
    for entry in raw.split(","):
        entry = entry.strip()
        if not entry:
            continue
        if entry.startswith("[") or entry.count(":") > 1:
            logger.warning("SMTP_SOURCE_IPS: skipping unsupported entry %r (IPv6 not supported)", entry)
            continue
        if ":" in entry:
            ip, helo = entry.split(":", 1)
            ip, helo = ip.strip(), helo.strip()
        else:
            ip, helo = entry, ""
        if ip in seen:
            logger.warning("SMTP_SOURCE_IPS: skipping duplicate IP %s", ip)
            continue
        seen.add(ip)
        ips.append(ip)
        if helo:
            helo_map[ip] = helo
    return ips, helo_map


SMTP_SOURCE_IPS, SMTP_IP_HELO_MAP = _parse_source_ips(os.getenv("SMTP_SOURCE_IPS", ""))


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
        ip_helo_map=SMTP_IP_HELO_MAP,
    )
    cache = Cache(
        DB_PATH,
        catch_all_ttl=CATCH_ALL_TTL,
        verified_ttl=VERIFIED_TTL,
    )
    metrics = Metrics(DB_PATH)
    warmup = Warmup(
        DB_PATH,
        soft_block_threshold=WARMUP_SOFT_BLOCK_THRESHOLD,
        per_domain_cap=WARMUP_PER_DOMAIN_CAP,
        source_ips=SMTP_SOURCE_IPS,
    )
    app.state.metrics = metrics
    app.state.warmup = warmup
    app.state.finder = EmailFinder(
        verifier=verifier, cache=cache, pacing_seconds=PACING_SECONDS,
        metrics=metrics, warmup=warmup, source_ips=SMTP_SOURCE_IPS,
    )

    # Run once on startup so a restart actually clears anything overdue,
    # then every 24h.
    initial_d, initial_e = await asyncio.to_thread(cache.purge_expired)
    if initial_d or initial_e:
        logger.info("Startup cache purge: removed %d expired domains, %d expired emails", initial_d, initial_e)
    purge_task = asyncio.create_task(_purge_loop(cache, 60 * 60 * 24))

    logger.info("Email finder started. db=%s helo=%s smtp_ips=%s", DB_PATH, HELO_HOSTNAME, SMTP_SOURCE_IPS or ["default"])
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


# ----- Auth dependencies -----
async def require_api_key(x_api_key: str = Header(default="")) -> UserContext:
    ctx = await validate_key(x_api_key)
    if ctx is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid, missing, or disabled X-API-Key",
        )
    return ctx


async def require_admin(ctx: UserContext = Depends(require_api_key)) -> UserContext:
    if not ctx.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return ctx


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


class FeedbackRequest(BaseModel):
    email: str = Field(..., min_length=3, description="The email address you are reporting on")
    actual_status: str = Field(..., description="What the email really is: verified | not_found | catch_all")
    reported_status: str | None = Field(default=None, description="What we previously said about it")
    notes: str | None = Field(default=None, max_length=500)


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


@app.get(
    "/stats",
    dependencies=[Depends(require_api_key)],
    summary="SMTP warm-up status, today's volume, and feedback-based accuracy",
)
async def stats() -> dict:
    metrics: Metrics = app.state.metrics
    warmup: Warmup = app.state.warmup
    return {
        "warmup": warmup.today_stats(),
        "volume_24h": metrics.today_volume(),
        "accuracy_30d": metrics.accuracy(days=30),
        "accuracy_7d": metrics.accuracy(days=7),
    }


@app.post(
    "/verify/feedback",
    summary="Report an incorrect verification result",
)
async def submit_feedback(req: FeedbackRequest,
                           ctx: UserContext = Depends(require_api_key)) -> dict:
    if req.actual_status not in {"verified", "not_found", "catch_all"}:
        raise HTTPException(status_code=400, detail="actual_status must be one of: verified, not_found, catch_all")
    metrics: Metrics = app.state.metrics
    metrics.log_feedback(
        email=req.email,
        actual_status=req.actual_status,
        reported_status=req.reported_status,
        notes=req.notes,
    )
    return {"recorded": True}


def _to_response(result, return_attempts: bool) -> FindResponse:
    message = None
    fallback = False
    if result.status == "catch_all":
        message = ("Domain is catch-all; SMTP cannot confirm. "
                   "Fall back to paid enrichment (LeadMagic, Findymail, etc.).")
        fallback = True
    elif result.status == "throttled":
        message = ("SMTP rate limit hit before verification could complete. "
                   "Retry later or use a third-party provider.")
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


def _check_smtp_pool(provider: str) -> None:
    """Raise 503 if the SMTP pool is fully exhausted. Skipped for third-party providers."""
    if provider != "smtp":
        return
    warmup: Warmup = app.state.warmup
    if warmup.is_pool_exhausted():
        raise HTTPException(
            status_code=503,
            detail="SMTP pool fully exhausted for today. Retry after UTC midnight or switch to ZeroBounce/Reoon.",
        )


@app.post(
    "/find",
    response_model=FindResponse,
    summary="Find a verified email for one contact",
)
@limiter.limit(RATE_LIMIT)
async def find(request: Request, req: FindRequest,
               ctx: UserContext = Depends(require_api_key)) -> FindResponse:
    _check_smtp_pool(req.verify_provider)
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
            user_id=ctx.user_id,
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
    summary="Stream live progress for a single email lookup (SSE)",
)
@limiter.limit(RATE_LIMIT)
async def find_stream(request: Request, req: StreamRequest,
                       ctx: UserContext = Depends(require_api_key)) -> StreamingResponse:
    _check_smtp_pool(req.verify_provider)
    provider_key = req.zerobounce_api_key if req.verify_provider == "zerobounce" else (req.reoon_api_key if req.verify_provider == "reoon" else "")
    finder: EmailFinder = app.state.finder

    async def event_gen():
        try:
            async for event in finder.find_stream(
                req.first_name, req.last_name, req.domain, req.middle_name,
                provider=req.verify_provider, provider_key=provider_key,
                user_id=ctx.user_id,
            ):
                yield f"data: {json.dumps(event)}\n\n"
        except Exception as e:
            logger.error("find_stream error: %s", e, exc_info=True)
            yield f"data: {json.dumps({'type': 'error', 'message': 'Verification failed. Please try again.'})}\n\n"

    return StreamingResponse(event_gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post(
    "/find/batch/stream",
    summary="Stream live progress for a batch lookup (SSE)",
)
@limiter.limit(RATE_LIMIT)
async def find_batch_stream(request: Request, req: BatchRequest,
                             ctx: UserContext = Depends(require_api_key)) -> StreamingResponse:
    _check_smtp_pool(req.verify_provider)
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
                    user_id=ctx.user_id,
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
    summary="Find verified emails for multiple contacts (max 50)",
)
@limiter.limit(RATE_LIMIT)
async def find_batch(request: Request, req: BatchRequest,
                      ctx: UserContext = Depends(require_api_key)) -> BatchResponse:
    _check_smtp_pool(req.verify_provider)
    finder: EmailFinder = app.state.finder

    async def _one(contact: FindRequest) -> FindResponse:
        try:
            result = await finder.find(
                first_name=contact.first_name,
                last_name=contact.last_name,
                domain=contact.domain,
                middle_name=contact.middle_name,
                return_attempts=contact.return_attempts,
                user_id=ctx.user_id,
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


# ============================================================================
# Admin endpoints — gated by require_admin (X-API-Key with profiles.is_admin=true
# or matching ADMIN_API_KEY env var)
# ============================================================================

import httpx as _httpx
from .auth import SUPABASE_SERVICE_KEY, SUPABASE_URL


async def _supabase_request(method: str, path: str, **kwargs) -> _httpx.Response:
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(503, "Supabase not configured")
    headers = kwargs.pop("headers", {})
    headers.update({
        "apikey": SUPABASE_SERVICE_KEY,
        "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
        "Content-Type": "application/json",
    })
    async with _httpx.AsyncClient(timeout=10) as client:
        return await client.request(method, f"{SUPABASE_URL}/rest/v1{path}", headers=headers, **kwargs)


@app.get(
    "/admin/users",
    summary="List users with activity counts (admin only)",
)
async def admin_list_users(ctx: UserContext = Depends(require_admin)) -> dict:
    r = await _supabase_request(
        "GET",
        "/profiles",
        params={"select": "id,api_key,is_admin,disabled,created_at", "order": "created_at.desc"},
    )
    if r.status_code != 200:
        raise HTTPException(502, f"Supabase error: {r.status_code}")
    profiles = r.json()

    metrics: Metrics = app.state.metrics
    activity = {row["user_id"]: row for row in metrics.user_activity_summary()}

    users = []
    for p in profiles:
        a = activity.get(p["id"], {})
        api_key = p.get("api_key") or ""
        users.append({
            "id": p["id"],
            "api_key_preview": (api_key[:6] + "..." + api_key[-4:]) if len(api_key) > 10 else api_key,
            "is_admin": bool(p.get("is_admin")),
            "disabled": bool(p.get("disabled")),
            "created_at": p.get("created_at"),
            "lifetime_lookups": a.get("lifetime_lookups", 0),
            "lookups_24h": a.get("lookups_24h", 0),
            "lookups_7d": a.get("lookups_7d", 0),
            "lookups_30d": a.get("lookups_30d", 0),
            "last_activity": a.get("last_activity"),
        })
    return {"users": users}


@app.get(
    "/admin/users/{user_id}",
    summary="User detail with recent activity (admin only)",
)
async def admin_user_detail(user_id: str, ctx: UserContext = Depends(require_admin)) -> dict:
    r = await _supabase_request(
        "GET",
        "/profiles",
        params={"id": f"eq.{user_id}", "select": "*"},
    )
    if r.status_code != 200:
        raise HTTPException(502, f"Supabase error: {r.status_code}")
    rows = r.json()
    if not rows:
        raise HTTPException(404, "User not found")
    profile = rows[0]
    metrics: Metrics = app.state.metrics
    activity = next((a for a in metrics.user_activity_summary() if a["user_id"] == user_id), {})
    return {
        "profile": {
            "id": profile["id"],
            "api_key": profile.get("api_key"),
            "is_admin": bool(profile.get("is_admin")),
            "disabled": bool(profile.get("disabled")),
            "created_at": profile.get("created_at"),
            "verify_provider": profile.get("verify_provider"),
        },
        "activity": activity,
        "recent": metrics.user_recent_log(user_id, limit=50),
    }


class DisableRequest(BaseModel):
    disabled: bool


@app.post(
    "/admin/users/{user_id}/disable",
    summary="Disable or re-enable a user's API key (admin only)",
)
async def admin_set_disabled(user_id: str, req: DisableRequest,
                              ctx: UserContext = Depends(require_admin)) -> dict:
    r = await _supabase_request(
        "PATCH",
        "/profiles",
        params={"id": f"eq.{user_id}"},
        json={"disabled": req.disabled},
    )
    if r.status_code not in (200, 204):
        raise HTTPException(502, f"Supabase error: {r.status_code}")
    invalidate_cache()  # the user's cached UserContext may now be stale
    return {"id": user_id, "disabled": req.disabled}


@app.post(
    "/admin/users/{user_id}/regenerate-key",
    summary="Regenerate a user's API key (admin only)",
)
async def admin_regenerate_key(user_id: str, ctx: UserContext = Depends(require_admin)) -> dict:
    import secrets as _secrets
    new_key = "ef_" + _secrets.token_hex(16)
    r = await _supabase_request(
        "PATCH",
        "/profiles",
        params={"id": f"eq.{user_id}"},
        json={"api_key": new_key},
    )
    if r.status_code not in (200, 204):
        raise HTTPException(502, f"Supabase error: {r.status_code}")
    invalidate_cache()  # purge any cached entry for the old key
    return {"id": user_id, "api_key": new_key}


@app.delete(
    "/admin/users/{user_id}",
    summary="Delete a user, their profile, and all their verification logs (admin only)",
)
async def admin_delete_user(user_id: str, ctx: UserContext = Depends(require_admin)) -> dict:
    if ctx.user_id == user_id:
        raise HTTPException(400, "Cannot delete your own account via admin endpoint")
    metrics: Metrics = app.state.metrics
    deleted_logs = metrics.delete_user_data(user_id)
    # Delete from auth.users (cascades to public.profiles via FK)
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        raise HTTPException(503, "Supabase not configured")
    async with _httpx.AsyncClient(timeout=10) as client:
        r = await client.delete(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            },
        )
    if r.status_code not in (200, 204):
        raise HTTPException(502, f"Supabase auth delete failed: {r.status_code}")
    invalidate_cache()
    return {"id": user_id, "deleted_log_rows": deleted_logs}


@app.get(
    "/admin/system",
    summary="System-wide metrics — IPs, warmup, volume (admin only)",
)
async def admin_system(ctx: UserContext = Depends(require_admin)) -> dict:
    warmup: Warmup = app.state.warmup
    metrics: Metrics = app.state.metrics
    return {
        "warmup": warmup.today_stats(),
        "volume_24h": metrics.today_volume(),
        "pool_exhausted": warmup.is_pool_exhausted(),
    }
