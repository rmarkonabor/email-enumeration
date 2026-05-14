"""SQLite-backed cache for catch-all status and verified emails."""

from __future__ import annotations

import sqlite3
import time
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS domain_status (
    domain TEXT PRIMARY KEY,
    catch_all INTEGER NOT NULL,
    checked_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS verified_emails (
    email TEXT PRIMARY KEY,
    status TEXT NOT NULL,
    verified_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_domain_checked ON domain_status (checked_at);
CREATE INDEX IF NOT EXISTS idx_email_verified ON verified_emails (verified_at);
"""


class Cache:
    """Persistent cache for catch-all status (long TTL) and verifications (shorter TTL)."""

    def __init__(
        self,
        db_path: str | Path,
        catch_all_ttl: int = 60 * 60 * 24 * 30,   # 30 days
        verified_ttl: int = 60 * 60 * 24 * 14,    # 14 days
    ) -> None:
        self.db_path = str(db_path)
        self.catch_all_ttl = catch_all_ttl
        self.verified_ttl = verified_ttl
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(SCHEMA)

    # ----- domain catch-all -----
    def get_catch_all(self, domain: str) -> bool | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT catch_all, checked_at FROM domain_status WHERE domain = ?",
                (domain,),
            ).fetchone()
        if not row:
            return None
        catch_all, checked_at = row
        if time.time() - checked_at > self.catch_all_ttl:
            return None
        return bool(catch_all)

    def set_catch_all(self, domain: str, catch_all: bool) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO domain_status (domain, catch_all, checked_at) "
                "VALUES (?, ?, ?)",
                (domain, int(catch_all), int(time.time())),
            )
            conn.commit()

    # ----- email verifications -----
    def get_verified(self, email: str) -> str | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT status, verified_at FROM verified_emails WHERE email = ?",
                (email,),
            ).fetchone()
        if not row:
            return None
        status, verified_at = row
        if time.time() - verified_at > self.verified_ttl:
            return None
        return status

    def set_verified(self, email: str, status: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT OR REPLACE INTO verified_emails (email, status, verified_at) "
                "VALUES (?, ?, ?)",
                (email, status, int(time.time())),
            )
            conn.commit()


__all__ = ["Cache"]
