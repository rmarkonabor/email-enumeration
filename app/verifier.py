"""Orchestrates the full email-finding flow."""
from __future__ import annotations

import asyncio
import itertools
import logging
import time
from collections.abc import AsyncGenerator
from dataclasses import dataclass, field

from .cache import Cache
from .metrics import Metrics, Warmup
from .permutations import generate_permutations
from .provider_classifier import classify as classify_provider
from .smtp_verifier import SMTPVerifier
from .third_party_verifier import verify_third_party

logger = logging.getLogger(__name__)


@dataclass
class FindResult:
    email: str | None
    status: str  # 'verified' | 'catch_all' | 'not_found' | 'throttled'
    catch_all: bool
    candidates_tried: int
    attempts: list[dict] = field(default_factory=list)
    mail_provider: str | None = None
    credits_used: int = 0
    reason: str | None = None  # populated when status='throttled' to explain the block


def _done_event(email, status, catch_all, attempts, fallback, mail_provider=None, credits_used=0) -> dict:
    if status == "verified":
        message = None
    elif status == "catch_all":
        message = "Domain is catch-all; cannot confirm via SMTP."
    elif status == "throttled":
        message = "SMTP rate limit hit before verification could complete. Retry later or use a third-party provider."
    else:
        message = "No candidate verified. Consider a paid enrichment tool."
    return {
        "type": "done",
        "email": email,
        "status": status,
        "catch_all": catch_all,
        "candidates_tried": len(attempts),
        "attempts": attempts,
        "mail_provider": mail_provider,
        "credits_used": credits_used,
        "message": message,
        "fallback_recommended": fallback,
    }


class EmailFinder:
    def __init__(
        self,
        verifier: SMTPVerifier,
        cache: Cache,
        pacing_seconds: float = 0.3,
        metrics: Metrics | None = None,
        warmup: Warmup | None = None,
        source_ips: list[str] | None = None,
    ) -> None:
        self.verifier = verifier
        self.cache = cache
        self.pacing_seconds = pacing_seconds
        self.metrics = metrics
        self.warmup = warmup
        self.source_ips = source_ips or []
        self._ip_iter = itertools.cycle(self.source_ips) if self.source_ips else None

    def _pick_source_ip(self, domain: str) -> tuple[str | None, str | None]:
        """Round-robin across source IPs, skipping any that are capped/paused.

        Returns (source_ip, block_reason). block_reason is None when allowed.
        source_ip is None when using the default OS-selected IP (single-IP mode).
        """
        if not self.source_ips:
            if self.warmup:
                allowed, reason = self.warmup.can_attempt(domain)
                return (None, reason if not allowed else None)
            return None, None

        # Try each IP once in rotation order; return first available
        for _ in range(len(self.source_ips)):
            ip = next(self._ip_iter)
            if self.warmup:
                allowed, reason = self.warmup.can_attempt(domain, source_ip=ip)
                if allowed:
                    return ip, None
            else:
                return ip, None

        return None, "all_ips_capped"

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
        user_id: str | None = None,
    ) -> FindResult:
        domain = domain.strip().lower().lstrip("@")

        if provider != "smtp":
            return await self._find_third_party(
                first_name, last_name, domain, middle_name, return_attempts,
                provider, provider_key, user_id=user_id,
            )

        mx_hosts = await self.verifier.get_mx_records(domain)
        provider_bucket = classify_provider(mx_hosts)
        mail_provider = await self.verifier.detect_mail_provider(domain)

        catch_all = self.cache.get_catch_all(domain)
        if catch_all is None:
            ca_ip, block_reason = self._pick_source_ip(domain)
            if block_reason is not None:
                return FindResult(email=None, status="throttled", catch_all=False,
                                  candidates_tried=0,
                                  attempts=[{"status": "throttled", "reason": block_reason}] if return_attempts else [],
                                  mail_provider=mail_provider,
                                  reason=block_reason)
            t0 = time.perf_counter()
            catch_all = await self.verifier.is_catch_all(domain, source_ip=ca_ip)
            ca_latency = int((time.perf_counter() - t0) * 1000)
            if self.warmup is not None:
                self.warmup.record_attempt(None, domain, source_ip=ca_ip or "",
                                            provider=provider_bucket, response_ms=ca_latency)
            self.cache.set_catch_all(domain, catch_all)
        if catch_all:
            best_guess = generate_permutations(first_name, last_name, domain, middle_name)
            best_email = best_guess[0] if best_guess else ""
            if self.metrics is not None:
                self.metrics.log_result("smtp", best_email, "catch_all", None, 0,
                                        user_id=user_id, candidates_tried=0, credits_used=0)
            return FindResult(email=best_email or None,
                              status="catch_all", catch_all=True,
                              candidates_tried=0, mail_provider=mail_provider)

        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        attempts: list[dict] = []
        throttled = False
        throttle_reason: str | None = None

        for candidate in candidates:
            cached = self.cache.get_verified(candidate)
            if cached == "verified":
                attempts.append({"email": candidate, "status": "verified"})
                if self.metrics is not None:
                    self.metrics.log_result("smtp", candidate, "verified", None, 0,
                                            user_id=user_id, candidates_tried=len(attempts), credits_used=0)
                return FindResult(email=candidate, status="verified", catch_all=False,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider)
            if cached == "not_found":
                attempts.append({"email": candidate, "status": "not_found"})
                continue

            source_ip, block_reason = self._pick_source_ip(domain)
            if block_reason is not None:
                attempts.append({"email": candidate, "status": "throttled", "reason": block_reason})
                throttled = True
                throttle_reason = block_reason
                break

            t0 = time.perf_counter()
            result = await self.verifier.verify_email(candidate, source_ip=source_ip)
            response_ms = int((time.perf_counter() - t0) * 1000)
            self.cache.set_verified(candidate, result.status)
            if self.warmup is not None:
                self.warmup.record_attempt(result.response_code, domain, source_ip=source_ip or "",
                                            provider=provider_bucket, response_ms=response_ms)
            attempts.append({"email": candidate, "status": result.status, "code": result.response_code})

            if result.status == "verified":
                if self.metrics is not None:
                    self.metrics.log_result("smtp", candidate, "verified", result.response_code,
                                            response_ms, user_id=user_id,
                                            candidates_tried=len(attempts), credits_used=0)
                return FindResult(email=candidate, status="verified", catch_all=False,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider)
            if self.pacing_seconds > 0:
                await asyncio.sleep(self.pacing_seconds)

        if not throttled and self.metrics is not None:
            first = candidates[0] if candidates else ""
            self.metrics.log_result("smtp", first, "not_found", None, 0,
                                    user_id=user_id, candidates_tried=len(attempts), credits_used=0)
        return FindResult(email=None, status="throttled" if throttled else "not_found",
                          catch_all=False,
                          candidates_tried=len(attempts),
                          attempts=attempts if return_attempts else [],
                          mail_provider=mail_provider,
                          reason=throttle_reason if throttled else None)

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
        user_id: str | None = None,
    ) -> FindResult:
        mail_provider = await self.verifier.detect_mail_provider(domain)
        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        attempts: list[dict] = []
        credits_used = 0

        for candidate in candidates:
            t0 = time.perf_counter()
            status, billed = await verify_third_party(candidate, provider, provider_key)
            response_ms = int((time.perf_counter() - t0) * 1000)
            if billed:
                credits_used += 1
            attempts.append({"email": candidate, "status": status, "provider": provider})

            if status == "verified":
                if self.metrics is not None:
                    self.metrics.log_result(provider, candidate, "verified", None, response_ms,
                                            user_id=user_id, candidates_tried=len(attempts),
                                            credits_used=credits_used)
                return FindResult(email=candidate, status="verified", catch_all=False,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider,
                                  credits_used=credits_used)
            if status == "catch_all":
                if self.metrics is not None:
                    self.metrics.log_result(provider, candidate, "catch_all", None, response_ms,
                                            user_id=user_id, candidates_tried=len(attempts),
                                            credits_used=credits_used)
                return FindResult(email=candidates[0] if candidates else None,
                                  status="catch_all", catch_all=True,
                                  candidates_tried=len(attempts),
                                  attempts=attempts if return_attempts else [],
                                  mail_provider=mail_provider,
                                  credits_used=credits_used)

        if self.metrics is not None:
            self.metrics.log_result(provider, candidates[0] if candidates else "", "not_found",
                                    None, 0, user_id=user_id, candidates_tried=len(attempts),
                                    credits_used=credits_used)
        return FindResult(email=None, status="not_found", catch_all=False,
                          candidates_tried=len(attempts),
                          attempts=attempts if return_attempts else [],
                          mail_provider=mail_provider,
                          credits_used=credits_used)

    # --------------------------------------------------------- SMTP stream
    async def find_stream(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None = None,
        provider: str = "smtp",
        provider_key: str = "",
        user_id: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        domain = domain.strip().lower().lstrip("@")

        if provider != "smtp":
            async for event in self._find_stream_third_party(
                first_name, last_name, domain, middle_name, provider, provider_key, user_id=user_id,
            ):
                yield event
            return

        mx_hosts = await self.verifier.get_mx_records(domain)
        provider_bucket = classify_provider(mx_hosts)
        mail_provider = await self.verifier.detect_mail_provider(domain)
        if mail_provider:
            yield {"type": "mail_provider", "mail_provider": mail_provider}

        yield {"type": "status", "message": f"Checking catch-all for {domain}…"}
        catch_all = self.cache.get_catch_all(domain)
        cached_ca = catch_all is not None
        if catch_all is None:
            ca_ip, block_reason = self._pick_source_ip(domain)
            if block_reason is not None:
                yield {"type": "attempt", "status": "throttled", "reason": block_reason}
                yield _done_event(None, "throttled", False, [], True, mail_provider)
                return
            t0 = time.perf_counter()
            catch_all = await self.verifier.is_catch_all(domain, source_ip=ca_ip)
            ca_latency = int((time.perf_counter() - t0) * 1000)
            if self.warmup is not None:
                self.warmup.record_attempt(None, domain, source_ip=ca_ip or "",
                                            provider=provider_bucket, response_ms=ca_latency)
            self.cache.set_catch_all(domain, catch_all)
        yield {"type": "catch_all", "catch_all": catch_all, "cached": cached_ca}

        candidates = generate_permutations(first_name, last_name, domain, middle_name)

        if catch_all:
            best_guess = candidates[0] if candidates else None
            if self.metrics is not None:
                self.metrics.log_result("smtp", best_guess or "", "catch_all", None, 0,
                                        user_id=user_id, candidates_tried=0, credits_used=0)
            yield _done_event(best_guess, "catch_all", True, [], True, mail_provider)
            return

        yield {"type": "candidates", "count": len(candidates)}
        attempts: list[dict] = []
        throttled = False

        for candidate in candidates:
            yield {"type": "trying", "email": candidate}
            cached_status = self.cache.get_verified(candidate)
            if cached_status == "verified":
                attempt = {"email": candidate, "status": "verified"}
                attempts.append(attempt)
                yield {"type": "attempt", **attempt}
                if self.metrics is not None:
                    self.metrics.log_result("smtp", candidate, "verified", None, 0,
                                            user_id=user_id, candidates_tried=len(attempts), credits_used=0)
                yield _done_event(candidate, "verified", False, attempts, False, mail_provider)
                return
            if cached_status == "not_found":
                attempt = {"email": candidate, "status": "not_found"}
                attempts.append(attempt)
                yield {"type": "attempt", **attempt}
                continue

            source_ip, block_reason = self._pick_source_ip(domain)
            if block_reason is not None:
                attempt = {"email": candidate, "status": "throttled", "reason": block_reason}
                attempts.append(attempt)
                yield {"type": "attempt", **attempt}
                throttled = True
                break

            t0 = time.perf_counter()
            result = await self.verifier.verify_email(candidate, source_ip=source_ip)
            response_ms = int((time.perf_counter() - t0) * 1000)
            self.cache.set_verified(candidate, result.status)
            if self.warmup is not None:
                self.warmup.record_attempt(result.response_code, domain, source_ip=source_ip or "",
                                            provider=provider_bucket, response_ms=response_ms)
            attempt = {"email": candidate, "status": result.status, "code": result.response_code}
            attempts.append(attempt)
            yield {"type": "attempt", **attempt}

            if result.status == "verified":
                if self.metrics is not None:
                    self.metrics.log_result("smtp", candidate, "verified", result.response_code,
                                            response_ms, user_id=user_id,
                                            candidates_tried=len(attempts), credits_used=0)
                yield _done_event(candidate, "verified", False, attempts, False, mail_provider)
                return
            if self.pacing_seconds > 0:
                await asyncio.sleep(self.pacing_seconds)

        if not throttled and self.metrics is not None:
            first = candidates[0] if candidates else ""
            self.metrics.log_result("smtp", first, "not_found", None, 0,
                                    user_id=user_id, candidates_tried=len(attempts), credits_used=0)
        yield _done_event(None, "throttled" if throttled else "not_found",
                          False, attempts, True, mail_provider)

    # ------------------------------------------------- Third-party stream
    async def _find_stream_third_party(
        self,
        first_name: str,
        last_name: str,
        domain: str,
        middle_name: str | None,
        provider: str,
        provider_key: str,
        user_id: str | None = None,
    ) -> AsyncGenerator[dict, None]:
        mail_provider = await self.verifier.detect_mail_provider(domain)
        if mail_provider:
            yield {"type": "mail_provider", "mail_provider": mail_provider}

        provider_label = provider.capitalize()
        yield {"type": "status", "message": f"Using {provider_label} to verify…"}

        candidates = generate_permutations(first_name, last_name, domain, middle_name)
        yield {"type": "candidates", "count": len(candidates)}
        attempts: list[dict] = []
        credits_used = 0

        for candidate in candidates:
            yield {"type": "trying", "email": candidate}
            t0 = time.perf_counter()
            status, billed = await verify_third_party(candidate, provider, provider_key)
            response_ms = int((time.perf_counter() - t0) * 1000)
            if billed:
                credits_used += 1
            attempt = {"email": candidate, "status": status, "provider": provider}
            attempts.append(attempt)
            yield {"type": "attempt", **attempt}

            if status == "verified":
                if self.metrics is not None:
                    self.metrics.log_result(provider, candidate, "verified", None, response_ms,
                                            user_id=user_id, candidates_tried=len(attempts),
                                            credits_used=credits_used)
                yield _done_event(candidate, "verified", False, attempts, False, mail_provider, credits_used)
                return
            if status == "catch_all":
                if self.metrics is not None:
                    self.metrics.log_result(provider, candidate, "catch_all", None, response_ms,
                                            user_id=user_id, candidates_tried=len(attempts),
                                            credits_used=credits_used)
                yield _done_event(candidates[0] if candidates else None, "catch_all", True, attempts, True, mail_provider, credits_used)
                return

        if self.metrics is not None:
            self.metrics.log_result(provider, candidates[0] if candidates else "", "not_found",
                                    None, 0, user_id=user_id, candidates_tried=len(attempts),
                                    credits_used=credits_used)
        yield _done_event(None, "not_found", False, attempts, True, mail_provider, credits_used)


__all__ = ["EmailFinder", "FindResult"]
