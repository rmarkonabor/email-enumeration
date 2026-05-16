"""Orchestrates the full email-finding flow."""
from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field

from .cache import Cache
from .permutations import generate_permutations
from .smtp_verifier import SMTPVerifier
from .third_party_verifier import verify_third_party

logger = logging.getLogger(__name__)


@dataclass
class FindResult:
    email: str | None
    status: str  # 'verified' | 'catch_all' | 'not_found'
    catch_all: bool
    candidates_tried: int
    attempts: list[dict] = field(default_factory=list)
    mail_provider: str | None = None


def _done_event(email, status, catch_all, attempts, fallback, mail_provider=None) -> dict:
    return {
        "type": "done",
        "email": email,
        "status": status,
        "catch_all": catch_all,
        "candidates_tried": len(attempts),
        "attempts": attempts,
        "mail_provider": mail_provider,
        "message": None if status == "verified" else (
            "Domain is catch-all; cannot confirm via SMTP." if status == "catch_all"
            else "No candidate verified. Consider a paid enrichment tool."
        ),
        "fallback_recommended": fallback,
    }


class EmailFinder:
    def __init__(self, verifier: SMTPVerifier, cache: Cache, pacing_seconds: float = 0.3) -> None:
        self.verifier = verifier
        self.cache = cache
        self.pacing_seconds = pacing_seconds

    # ------------------------------------------------------------------ SMTP
    async def find(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None = None,
        return_attempts: bool = False,
        provider: str = "smtp",
        provider_key: str = "",
    ) -> FindResult:
        domain = domain.strip().lower().lstrip("@")

        if provider != "smtp":
            return await self._find_third_party(
                first_name, last_name, domain, middle_name, return_attempts, provider, provider_key
            )

        mail_provider = await self.verifier.detect_mail_provider(domain)

        catch_all = self.cache.get_catch_all(domain)
        if catch_all is None:
            catch_all = await self.verifier.is_catch_all(domain)
            self.cache.set_catch_all(domain, catch_all)
        if catch_all:
            return FindResult(email=None, status="catch_all", catch_all=True,
                              candidates_tried=0, mail_provider=mail_provider)

        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        attempts: list[dict] = []

        for candidate in candidates:
            cached = self.cache.get_verified(candidate)
            if cached == "verified":
                attempts.append({"email": candidate, "status": "verified", "cached": True})
                return FindResult(email=candidate, status="verified", catch_all=False,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider)
            if cached == "not_found":
                attempts.append({"email": candidate, "status": "not_found", "cached": True})
                continue

            result = await self.verifier.verify_email(candidate)
            self.cache.set_verified(candidate, result.status)
            attempts.append({"email": candidate, "status": result.status, "code": result.response_code})

            if result.status == "verified":
                return FindResult(email=candidate, status="verified", catch_all=False,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider)
            if self.pacing_seconds > 0:
                await asyncio.sleep(self.pacing_seconds)

        return FindResult(email=None, status="not_found", catch_all=False,
                          candidates_tried=len(attempts),
                          attempts=attempts if return_attempts else [],
                          mail_provider=mail_provider)

    # --------------------------------------------------------- Third-party
    async def _find_third_party(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None,
        return_attempts: bool,
        provider: str,
        provider_key: str,
    ) -> FindResult:
        mail_provider = await self.verifier.detect_mail_provider(domain)
        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        attempts: list[dict] = []

        for candidate in candidates:
            status = await verify_third_party(candidate, provider, provider_key)
            attempts.append({"email": candidate, "status": status, "provider": provider})

            if status == "verified":
                return FindResult(email=candidate, status="verified", catch_all=False,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider)
            if status == "catch_all":
                return FindResult(email=None, status="catch_all", catch_all=True,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider)

        return FindResult(email=None, status="not_found", catch_all=False,
                          candidates_tried=len(attempts),
                          attempts=attempts if return_attempts else [],
                          mail_provider=mail_provider)

    # --------------------------------------------------------- SMTP stream
    async def find_stream(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None = None,
        provider: str = "smtp",
        provider_key: str = "",
    ) -> AsyncGenerator[dict, None]:
        domain = domain.strip().lower().lstrip("@")

        if provider != "smtp":
            async for event in self._find_stream_third_party(
                first_name, last_name, domain, middle_name, provider, provider_key
            ):
                yield event
            return

        mail_provider = await self.verifier.detect_mail_provider(domain)
        if mail_provider:
            yield {"type": "mail_provider", "mail_provider": mail_provider}

        yield {"type": "status", "message": f"Checking catch-all for {domain}…"}
        catch_all = self.cache.get_catch_all(domain)
        cached_ca = catch_all is not None
        if catch_all is None:
            catch_all = await self.verifier.is_catch_all(domain)
            self.cache.set_catch_all(domain, catch_all)
        yield {"type": "catch_all", "catch_all": catch_all, "cached": cached_ca}

        if catch_all:
            yield _done_event(None, "catch_all", True, [], True, mail_provider)
            return

        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        yield {"type": "candidates", "count": len(candidates)}
        attempts: list[dict] = []

        for candidate in candidates:
            yield {"type": "trying", "email": candidate}
            cached_status = self.cache.get_verified(candidate)
            if cached_status == "verified":
                attempt = {"email": candidate, "status": "verified", "cached": True}
                attempts.append(attempt)
                yield {"type": "attempt", **attempt}
                yield _done_event(candidate, "verified", False, attempts, False, mail_provider)
                return
            if cached_status == "not_found":
                attempt = {"email": candidate, "status": "not_found", "cached": True}
                attempts.append(attempt)
                yield {"type": "attempt", **attempt}
                continue

            result = await self.verifier.verify_email(candidate)
            self.cache.set_verified(candidate, result.status)
            attempt = {"email": candidate, "status": result.status, "code": result.response_code}
            attempts.append(attempt)
            yield {"type": "attempt", **attempt}

            if result.status == "verified":
                yield _done_event(candidate, "verified", False, attempts, False, mail_provider)
                return
            if self.pacing_seconds > 0:
                await asyncio.sleep(self.pacing_seconds)

        yield _done_event(None, "not_found", False, attempts, True, mail_provider)

    # ------------------------------------------------- Third-party stream
    async def _find_stream_third_party(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None,
        provider: str,
        provider_key: str,
    ) -> AsyncGenerator[dict, None]:
        mail_provider = await self.verifier.detect_mail_provider(domain)
        if mail_provider:
            yield {"type": "mail_provider", "mail_provider": mail_provider}

        provider_label = provider.capitalize()
        yield {"type": "status", "message": f"Using {provider_label} to verify…"}

        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        yield {"type": "candidates", "count": len(candidates)}
        attempts: list[dict] = []

        for candidate in candidates:
            yield {"type": "trying", "email": candidate}
            status = await verify_third_party(candidate, provider, provider_key)
            attempt = {"email": candidate, "status": status, "provider": provider}
            attempts.append(attempt)
            yield {"type": "attempt", **attempt}

            if status == "verified":
                yield _done_event(candidate, "verified", False, attempts, False, mail_provider)
                return
            if status == "catch_all":
                yield _done_event(None, "catch_all", True, attempts, True, mail_provider)
                return

        yield _done_event(None, "not_found", False, attempts, True, mail_provider)


__all__ = ["EmailFinder", "FindResult"]
