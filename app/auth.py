"""API key validation against Supabase profiles with in-memory cache.

Returns a UserContext describing the caller so handlers can attribute
verification activity to a specific user and gate admin endpoints.

Two valid key forms:
  1. ADMIN_API_KEY env var matches  -> system-admin context (user_id=None, is_admin=True)
  2. profiles.api_key matches in Supabase -> user context (user_id, is_admin, disabled)

Disabled accounts are rejected as if the key were invalid.
"""
from __future__ import annotations

import logging
import os
import secrets
import time
from dataclasses import dataclass

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ADMIN_API_KEY = os.getenv("API_KEY", "")

_CACHE_TTL = 300


@dataclass(frozen=True)
class UserContext:
    user_id: str | None  # None for system admin (env var key)
    is_admin: bool
    disabled: bool

    @property
    def valid(self) -> bool:
        return not self.disabled


# key -> (UserContext, expires_at)
_cache: dict[str, tuple[UserContext, float]] = {}


def _admin_context() -> UserContext:
    return UserContext(user_id=None, is_admin=True, disabled=False)


async def validate_key(key: str) -> UserContext | None:
    """Look up the key. Returns None if invalid/unknown/disabled."""
    if not key:
        return None
    if ADMIN_API_KEY and secrets.compare_digest(key, ADMIN_API_KEY):
        return _admin_context()
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return None

    now = time.time()
    cached = _cache.get(key)
    if cached and cached[1] > now:
        ctx = cached[0]
        return ctx if ctx.valid else None

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"api_key": f"eq.{key}", "select": "id,is_admin,disabled"},
                headers={
                    "apikey": SUPABASE_SERVICE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                },
                timeout=5,
            )
            if r.status_code == 200:
                rows = r.json()
                if rows:
                    row = rows[0]
                    ctx = UserContext(
                        user_id=row["id"],
                        is_admin=bool(row.get("is_admin")),
                        disabled=bool(row.get("disabled")),
                    )
                    _cache[key] = (ctx, now + _CACHE_TTL)
                    return ctx if ctx.valid else None
    except Exception as e:
        logger.warning("Supabase key validation error: %s", e)

    return None


def invalidate_cache(key: str | None = None) -> None:
    """Drop a single key (after regenerate/disable) or the whole cache."""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


# Backward-compat shim — existing call sites use is_valid_key(key) -> bool.
async def is_valid_key(key: str) -> bool:
    return (await validate_key(key)) is not None
