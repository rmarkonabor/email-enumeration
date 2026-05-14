"""Orchestrates the full email-finding flow.

Flow:
  1. Resolve catch-all status for the domain (cached, long TTL).
     If catch-all -> return early signaling "fall back to paid tool".
  2. Generate permutations in priority order.
  3. For each candidate: check cache, otherwise SMTP-verify and cache.
  4. First 'verified' wins. If none verified, return 'not_found'.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from .cache import Cache
from .permutations import generate_permutations
from .smtp_verifier import SMTPVerifier

logger = logging.getLogger(__name__)


@dataclass
class FindResult:
    email: str | None
    status: str  # 'verified' | 'catch_all' | 'not_found'
    catch_all: bool
    candidates_tried: int
    attempts: list[dict] = field(default_factory=list)


class EmailFinder:
    def __init__(
        self,
        verifier: SMTPVerifier,
        cache: Cache,
        pacing_seconds: float = 0.3,
    ) -> None:
        self.verifier = verifier
        self.cache = cache
        self.pacing_seconds = pacing_seconds

    async def find(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None = None,
        return_attempts: bool = False,
    ) -> FindResult:
        domain = domain.strip().lower().lstrip("@")

        # 1) Catch-all check (cached)
        catch_all = self.cache.get_catch_all(domain)
        if catch_all is None:
            catch_all = await self.verifier.is_catch_all(domain)
            self.cache.set_catch_all(domain, catch_all)

        if catch_all:
            return FindResult(
                email=None,
                status="catch_all",
                catch_all=True,
                candidates_tried=0,
            )

        # 2) Generate permutations
        candidates = generate_permutations(first_name, last_name, domain, middle_name)

        # 3) Try each in order
        attempts: list[dict] = []
        for candidate in candidates:
            cached = self.cache.get_verified(candidate)
            if cached == "verified":
                attempts.append({"email": candidate, "status": "verified", "cached": True})
                return FindResult(
                    email=candidate,
                    status="verified",
                    catch_all=False,
                    candidates_tried=len(attempts),
                    attempts=attempts if return_attempts else [],
                )
            if cached == "not_found":
                attempts.append({"email": candidate, "status": "not_found", "cached": True})
                continue

            result = await self.verifier.verify_email(candidate)
            self.cache.set_verified(candidate, result.status)
            attempts.append({
                "email": candidate,
                "status": result.status,
                "code": result.response_code,
            })

            if result.status == "verified":
                return FindResult(
                    email=candidate,
                    status="verified",
                    catch_all=False,
                    candidates_tried=len(attempts),
                    attempts=attempts if return_attempts else [],
                )

            # Polite pacing between live SMTP checks on the same domain
            if self.pacing_seconds > 0:
                await asyncio.sleep(self.pacing_seconds)

        return FindResult(
            email=None,
            status="not_found",
            catch_all=False,
            candidates_tried=len(attempts),
            attempts=attempts if return_attempts else [],
        )


__all__ = ["EmailFinder", "FindResult"]
