"""Classify a domain by mail provider based on its MX records.

The classifier returns a stable bucket name used for per-provider capacity
tracking and (later) adaptive rate-limiting. Buckets are intentionally coarse:
we want enough granularity to detect throttling per provider but not so much
that we fragment samples.

First-match wins. Patterns are matched as hostname suffixes against each
MX hostname individually — so ``me.com`` only matches ``mx1.me.com`` and
``me.com``, never ``mx.acme.com``.
"""
from __future__ import annotations

PROVIDERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("microsoft",      ("mail.protection.outlook.com", "outlook.com", "hotmail.com")),
    ("google",         ("aspmx.l.google.com", "googlemail.com", "google.com")),
    ("mimecast",       ("mimecast.com",)),
    ("proofpoint",     ("pphosted.com", "ppe-hosted.com", "proofpoint.com")),
    ("barracuda",      ("barracudanetworks.com",)),
    ("cisco_ironport", ("iphmx.com",)),
    ("trendmicro",     ("trendmicro.com",)),
    ("yahoo_aol",      ("yahoodns.net", "yahoo.com", "aol.com")),
    ("zoho",           ("zoho.com", "zoho.eu", "zohomail.com")),
    ("fastmail",       ("messagingengine.com",)),
    ("icloud",         ("icloud.com", "me.com", "mac.com")),
    ("proton",         ("protonmail.ch", "proton.me")),
    ("amazonses",      ("amazonses.com",)),
    ("mailgun",        ("mailgun.org",)),
    ("sendgrid",       ("sendgrid.net",)),
)

GATEWAYS = frozenset({"mimecast", "proofpoint", "barracuda", "cisco_ironport", "trendmicro"})


def _host_matches(host: str, pattern: str) -> bool:
    """Match ``pattern`` against ``host`` as a domain suffix on label boundary."""
    return host == pattern or host.endswith("." + pattern)


def classify(mx_hosts: list[str] | None) -> str:
    """Return a provider bucket: a known key, "other", or "unknown" (no MX)."""
    if not mx_hosts:
        return "unknown"
    hosts = [h.strip().rstrip(".").lower() for h in mx_hosts if h]
    if not hosts:
        return "unknown"
    for name, patterns in PROVIDERS:
        if any(_host_matches(h, p) for h in hosts for p in patterns):
            return name
    return "other"


def is_gateway(provider: str) -> bool:
    return provider in GATEWAYS


__all__ = ["classify", "is_gateway", "PROVIDERS", "GATEWAYS"]
