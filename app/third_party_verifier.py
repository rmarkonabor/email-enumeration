"""ZeroBounce and Reoon email verification clients."""
from __future__ import annotations

import logging

import httpx

logger = logging.getLogger(__name__)

_ZEROBOUNCE_URL = "https://api.zerobounce.net/v2/validate"
_REOON_URL = "https://emailverifier.reoon.com/api/v1/verify"


async def verify_zerobounce(email: str, api_key: str) -> str:
    """Returns 'verified', 'not_found', 'catch_all', or 'unknown'."""
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                _ZEROBOUNCE_URL,
                params={"api_key": api_key, "email": email, "ip_address": ""},
                timeout=15,
            )
            r.raise_for_status()
            status = r.json().get("status", "").lower()
        if status == "valid":
            return "verified"
        if status in ("invalid", "do_not_mail", "spamtrap", "abuse"):
            return "not_found"
        if status == "catch-all":
            return "catch_all"
        return "unknown"
    except Exception as e:
        logger.warning("ZeroBounce error for %s: %s", email, e)
        return "unknown"


async def verify_reoon(email: str, api_key: str) -> str:
    """Returns 'verified', 'not_found', 'catch_all', or 'unknown'.

    Reoon power-mode response 'status' values:
      safe | invalid | catch_all | risky | unknown | disposable |
      role_account | mailbox_full | disabled | spamtrap
    """
    try:
        async with httpx.AsyncClient() as client:
            r = await client.get(
                _REOON_URL,
                params={"email": email, "key": api_key, "mode": "power"},
                timeout=30,
            )
            r.raise_for_status()
            data = r.json()
        status = (data.get("status") or "").lower()
        logger.info("Reoon %s -> %s", email, status or data)
        if status == "safe":
            return "verified"
        if status in ("invalid", "disposable", "spamtrap", "disabled"):
            return "not_found"
        if status == "catch_all" or data.get("is_catch_all") or data.get("is_catchall"):
            return "catch_all"
        return "unknown"
    except Exception as e:
        logger.warning("Reoon error for %s: %s", email, e)
        return "unknown"


async def verify_third_party(email: str, provider: str, api_key: str) -> str:
    if provider == "zerobounce":
        return await verify_zerobounce(email, api_key)
    if provider == "reoon":
        return await verify_reoon(email, api_key)
    raise ValueError(f"Unknown provider: {provider}")
