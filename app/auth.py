"""API key validation against Supabase profiles table with in-memory cache."""
from __future__ import annotations

import logging
import os
import time

import httpx

logger = logging.getLogger(__name__)

SUPABASE_URL = os.getenv("SUPABASE_URL", "").rstrip("/")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "")
ADMIN_API_KEY = os.getenv("API_KEY", "")

_cache: dict[str, float] = {}
_CACHE_TTL = 300


async def is_valid_key(key: str) -> bool:
    if not key:
        return False
    if ADMIN_API_KEY and key == ADMIN_API_KEY:
        return True
    if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
        return False

    now = time.time()
    if key in _cache and _cache[key] > now:
        return True

    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                f"{SUPABASE_URL}/rest/v1/profiles",
                params={"api_key": f"eq.{key}", "select": "id"},
                headers={
                    "apikey": SUPABASE_SERVICE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                },
                timeout=5,
            )
            if r.status_code == 200 and r.json():
                _cache[key] = now + _CACHE_TTL
                return True
    except Exception as e:
        logger.warning("Supabase key validation error: %s", e)

    return False
