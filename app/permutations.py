"""Generate realistic email permutations from a contact name and domain.

Covers the common B2B email conventions in priority order (most likely first).
Handles compound names, diacritics, hyphens, and middle initials.
"""

from __future__ import annotations

import re
import unicodedata


def _normalize(s: str) -> str:
    """Lowercase, strip diacritics, drop non-alphanumeric characters."""
    if not s:
        return ""
    # NFKD decomposition splits "é" -> "e" + combining accent; drop combiners
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = s.lower()
    s = re.sub(r"[^a-z0-9]", "", s)
    return s


def _split_compound(name: str) -> list[str]:
    """Split a compound name on whitespace and hyphens."""
    if not name:
        return []
    parts = re.split(r"[\s\-]+", name.strip())
    return [p for p in parts if p]


def generate_permutations(
    first_name: str,
    last_name: str,
    domain: str,
    middle_name: str | None = None,
) -> list[str]:
    """Return a deduplicated, ordered list of plausible email addresses.

    Ordering matters: most common conventions are tried first so we
    minimize SMTP calls in the happy path.
    """
    first_parts = _split_compound(first_name or "")
    last_parts = _split_compound(last_name or "")

    if not first_parts or not last_parts:
        raise ValueError("first_name and last_name are required")

    # Full normalized forms (e.g. "Mary Jane" -> "maryjane")
    first = _normalize("".join(first_parts))
    last = _normalize("".join(last_parts))
    # Single-token forms (first token of compound first, last token of compound last)
    first_single = _normalize(first_parts[0])
    last_single = _normalize(last_parts[-1])

    middle = _normalize(middle_name) if middle_name else ""
    f = first[0] if first else ""
    l = last[0] if last else ""
    m = middle[0] if middle else ""

    domain = domain.strip().lower().lstrip("@")
    if not domain or "." not in domain:
        raise ValueError("domain must be a valid hostname")

    seen: set[str] = set()
    patterns: list[str] = []

    def add(local: str) -> None:
        local = local.strip(".-_")
        if not local or local in seen:
            return
        seen.add(local)
        patterns.append(f"{local}@{domain}")

    # ----- Highest-probability patterns first -----
    add(f"{first}.{last}")        # jamie.lee
    add(f"{first}{last}")         # jamielee
    add(f"{first}")               # jamie
    add(f"{f}{last}")             # jlee
    add(f"{first}.{l}")           # jamie.l
    add(f"{f}.{last}")            # j.lee
    add(f"{first}_{last}")        # jamie_lee
    add(f"{first}-{last}")        # jamie-lee
    add(f"{last}.{first}")        # lee.jamie
    add(f"{last}{first}")         # leejamie
    add(f"{last}{f}")             # leej
    add(f"{last}.{f}")            # lee.j
    add(f"{last}")                # lee
    add(f"{first}{l}")            # jamiel
    add(f"{f}.{l}")               # j.l
    add(f"{f}{l}")                # jl

    # ----- Compound-name variations -----
    if first_single and first_single != first:
        add(f"{first_single}.{last}")
        add(f"{first_single}{last}")
        add(f"{first_single}")
    if last_single and last_single != last:
        add(f"{first}.{last_single}")
        add(f"{first}{last_single}")
        add(f"{f}{last_single}")

    # ----- Middle initial variations -----
    if m:
        add(f"{first}.{m}.{last}")
        add(f"{first}{m}{last}")
        add(f"{f}{m}{last}")
        add(f"{first}{m}.{last}")

    return patterns


__all__ = ["generate_permutations"]
