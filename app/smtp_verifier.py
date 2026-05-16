"""SMTP-based email verification via RCPT TO checks.

For each email candidate:
1. Resolve MX records for the domain.
2. Connect to the highest-priority MX on port 25.
3. EHLO -> MAIL FROM -> RCPT TO.
4. Read the response code:
     2xx -> verified (inbox exists)
     5xx -> not_found (550/551/553 = no such user)
     4xx / no response -> unknown (greylisted, rate-limited, blocked)

Notes:
- Many ISPs and cloud providers (AWS, GCP, Azure, DO by default) block
  outbound port 25. Deploy on a host that allows it.
- Some providers (Google Workspace, increasingly Microsoft 365) accept
  any RCPT and only bounce later. Those domains will look catch-all to
  this verifier; fall through to a paid tool for them.
"""

from __future__ import annotations

import asyncio
import logging
import random
import socket
import string
from dataclasses import dataclass

import aiosmtplib
import dns.asyncresolver
import dns.resolver

logger = logging.getLogger(__name__)


@dataclass
class VerifyResult:
    email: str
    status: str  # 'verified' | 'not_found' | 'unknown'
    response_code: int | None = None
    response_message: str | None = None


class SMTPVerifier:
    def __init__(
        self,
        sender_email: str = "verify@example.com",
        helo_hostname: str = "verifier.example.com",
        smtp_timeout: float = 10.0,
        ip_helo_map: dict[str, str] | None = None,
    ) -> None:
        self.sender_email = sender_email
        self.helo_hostname = helo_hostname
        self.smtp_timeout = smtp_timeout
        # Maps source_ip -> helo_hostname for per-IP HELO alignment
        self.ip_helo_map: dict[str, str] = ip_helo_map or {}
        self._mx_cache: dict[str, list[str]] = {}

    def _helo_for(self, source_ip: str | None) -> str:
        """Return the HELO hostname for the given source IP."""
        if source_ip and source_ip in self.ip_helo_map:
            return self.ip_helo_map[source_ip]
        return self.helo_hostname

    async def get_mx_records(self, domain: str) -> list[str]:
        """Return MX hosts sorted by preference (lowest number = try first)."""
        if domain in self._mx_cache:
            return self._mx_cache[domain]

        hosts: list[str] = []
        try:
            answers = await dns.asyncresolver.resolve(domain, "MX")
            mx_records = sorted(
                ((int(r.preference), str(r.exchange).rstrip(".")) for r in answers),
                key=lambda x: x[0],
            )
            hosts = [h for _, h in mx_records]
        except (dns.resolver.NoAnswer, dns.resolver.NXDOMAIN):
            logger.info("No MX records for %s", domain)
        except Exception as e:
            logger.warning("MX lookup failed for %s: %s", domain, e)

        self._mx_cache[domain] = hosts
        return hosts

    async def detect_mail_provider(self, domain: str) -> str | None:
        """Return a human-readable mail provider name based on MX records."""
        mx_hosts = await self.get_mx_records(domain)
        combined = " ".join(mx_hosts).lower()

        if "google.com" in combined or "googlemail.com" in combined:
            return "Google Workspace"
        if "mail.protection.outlook.com" in combined:
            return "Microsoft 365"
        if "hotmail.com" in combined or "outlook.com" in combined:
            return "Outlook.com"
        if "yahoodns.net" in combined or "yahoo.com" in combined:
            return "Yahoo"
        if "zoho.com" in combined:
            return "Zoho"
        if "protonmail.ch" in combined or "proton.me" in combined:
            return "Proton Mail"
        if "messagingengine.com" in combined:
            return "Fastmail"
        if "icloud.com" in combined or "me.com" in combined:
            return "Apple iCloud"
        if "mailgun.org" in combined:
            return "Mailgun"
        if "sendgrid.net" in combined:
            return "SendGrid"
        if "amazonses.com" in combined:
            return "Amazon SES"
        if "pphosted.com" in combined or "proofpoint.com" in combined:
            return "Proofpoint"
        if "mimecast.com" in combined:
            return "Mimecast"
        if "barracudanetworks.com" in combined:
            return "Barracuda"
        if "iphmx.com" in combined or "cisco.com" in combined:
            return "Cisco Email Security"
        if "trendmicro.com" in combined:
            return "Trend Micro"
        if mx_hosts:
            return None  # Known MX but unrecognised provider
        return None

    async def _smtp_rcpt(
        self, mx_host: str, email: str, source_ip: str | None = None
    ) -> tuple[int | None, str | None]:
        """Open SMTP connection, RCPT TO, return (code, message). Best-effort cleanup."""
        smtp = aiosmtplib.SMTP(
            hostname=mx_host,
            port=25,
            timeout=self.smtp_timeout,
            local_hostname=self._helo_for(source_ip),
            source_address=(source_ip, 0) if source_ip else None,
        )
        try:
            await smtp.connect()
            await smtp.ehlo()
            await smtp.mail(self.sender_email)
            code, message = await smtp.rcpt(email)
            msg = message.decode() if isinstance(message, bytes) else str(message)
            return code, msg
        finally:
            try:
                await smtp.quit()
            except Exception:
                try:
                    smtp.close()
                except Exception:
                    pass

    async def verify_email(self, email: str, source_ip: str | None = None) -> VerifyResult:
        """Verify a single email via SMTP RCPT TO."""
        if "@" not in email:
            return VerifyResult(email=email, status="unknown",
                                response_message="Invalid email format")

        domain = email.split("@", 1)[1]
        mx_hosts = await self.get_mx_records(domain)
        if not mx_hosts:
            return VerifyResult(email=email, status="unknown",
                                response_message="No MX records")

        last_error: str | None = None
        for host in mx_hosts:
            try:
                code, msg = await self._smtp_rcpt(host, email, source_ip=source_ip)
            except (asyncio.TimeoutError, socket.gaierror, aiosmtplib.SMTPException,
                    OSError, ConnectionError) as e:
                last_error = f"{type(e).__name__}: {e}"
                logger.debug("SMTP attempt to %s for %s failed: %s", host, email, e)
                continue

            if code is None:
                last_error = "No SMTP response"
                continue
            if 200 <= code < 300:
                return VerifyResult(email=email, status="verified",
                                    response_code=code, response_message=msg)
            if code in (550, 551, 553, 554):
                return VerifyResult(email=email, status="not_found",
                                    response_code=code, response_message=msg)
            # 4xx (greylist / rate limit) and other 5xx -> unknown
            return VerifyResult(email=email, status="unknown",
                                response_code=code, response_message=msg)

        return VerifyResult(email=email, status="unknown",
                            response_message=last_error or "All MX hosts unreachable")

    async def is_catch_all(self, domain: str, source_ip: str | None = None) -> bool:
        """Probe with a clearly-bogus address. If the server accepts it, catch-all."""
        rnd = "".join(random.choices(string.ascii_lowercase + string.digits, k=24))
        bogus = f"zzz_nope_{rnd}@{domain}"
        result = await self.verify_email(bogus, source_ip=source_ip)
        return result.status == "verified"


__all__ = ["SMTPVerifier", "VerifyResult"]
