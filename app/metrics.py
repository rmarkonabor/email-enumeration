"""SMTP IP warm-up controller and verification metrics/feedback storage.

Two responsibilities, one SQLite database (shared with the cache):

1. **Warmup**: cap daily SMTP attempts to ramp our outgoing IP reputation
   gradually. Linear growth from WARMUP_START to WARMUP_MAX over
   WARMUP_DAYS_TO_MAX days. If the soft-block rate (421/450/451/452) exceeds
   WARMUP_SOFT_BLOCK_THRESHOLD after a minimum sample size, SMTP is paused
   for the rest of the UTC day.

   Multiple source IPs are tracked independently — each IP gets its own
   daily cap and circuit breaker. Total daily capacity = cap_per_ip × num_ips.

2. **Metrics**: log every verification attempt (SMTP or third-party) and
   accept user feedback ("you said verified but the email bounces") so we
   can measure real-world accuracy.

Soft-block SMTP codes we count toward throttling:
   421  Service not available, closing transmission channel
   450  Mailbox unavailable; try again later
   451  Local error in processing
   452  Insufficient system storage
"""
from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger(__name__)

SOFT_BLOCK_CODES = {421, 450, 451, 452}

SCHEMA = """
CREATE TABLE IF NOT EXISTS verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    method TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    smtp_code INTEGER,
    response_ms INTEGER,
    soft_block INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vl_ts ON verification_log (ts);
CREATE INDEX IF NOT EXISTS idx_vl_email ON verification_log (email);

CREATE TABLE IF NOT EXISTS verification_feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    email TEXT NOT NULL,
    reported_status TEXT,
    actual_status TEXT NOT NULL,
    notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_vf_email ON verification_feedback (email);

CREATE TABLE IF NOT EXISTS smtp_daily_counters (
    day TEXT NOT NULL,
    source_ip TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    soft_blocks INTEGER NOT NULL DEFAULT 0,
    paused INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, source_ip)
);
CREATE INDEX IF NOT EXISTS idx_sdc_day ON smtp_daily_counters (day);

CREATE TABLE IF NOT EXISTS smtp_domain_daily (
    day TEXT NOT NULL,
    source_ip TEXT NOT NULL DEFAULT '',
    domain TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    soft_blocks INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, source_ip, domain)
);
CREATE INDEX IF NOT EXISTS idx_sdd_day ON smtp_domain_daily (day);

CREATE TABLE IF NOT EXISTS smtp_ip_metadata (
    source_ip TEXT PRIMARY KEY,
    first_seen_at INTEGER NOT NULL,
    last_activity_at INTEGER,
    lifetime_attempts INTEGER NOT NULL DEFAULT 0,
    lifetime_soft_blocks INTEGER NOT NULL DEFAULT 0
);
"""


def _today() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d")


def _migrate_db(conn: sqlite3.Connection) -> None:
    """Migrate smtp tables from single-IP schema (day PK) to per-IP schema (day, source_ip PK)."""
    tbl = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='smtp_daily_counters'"
    ).fetchone()
    if not tbl:
        return  # Fresh install — SCHEMA will create the new tables

    cols = {row[1] for row in conn.execute("PRAGMA table_info(smtp_daily_counters)").fetchall()}
    if "source_ip" in cols:
        return  # Already on new schema

    logger.info("Migrating smtp_daily_counters and smtp_domain_daily to per-IP schema...")
    conn.executescript("""
        ALTER TABLE smtp_daily_counters RENAME TO _smtp_daily_v1;
        ALTER TABLE smtp_domain_daily RENAME TO _smtp_domain_v1;

        CREATE TABLE smtp_daily_counters (
            day TEXT NOT NULL,
            source_ip TEXT NOT NULL DEFAULT '',
            attempts INTEGER NOT NULL DEFAULT 0,
            soft_blocks INTEGER NOT NULL DEFAULT 0,
            paused INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, source_ip)
        );
        CREATE INDEX IF NOT EXISTS idx_sdc_day ON smtp_daily_counters (day);

        CREATE TABLE smtp_domain_daily (
            day TEXT NOT NULL,
            source_ip TEXT NOT NULL DEFAULT '',
            domain TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            soft_blocks INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (day, source_ip, domain)
        );
        CREATE INDEX IF NOT EXISTS idx_sdd_day ON smtp_domain_daily (day);

        INSERT INTO smtp_daily_counters (day, source_ip, attempts, soft_blocks, paused)
        SELECT day, '', attempts, soft_blocks, paused FROM _smtp_daily_v1;

        INSERT INTO smtp_domain_daily (day, source_ip, domain, attempts, soft_blocks)
        SELECT day, '', domain, attempts, soft_blocks FROM _smtp_domain_v1;

        DROP TABLE _smtp_daily_v1;
        DROP TABLE _smtp_domain_v1;
    """)
    conn.commit()
    logger.info("Migration complete.")


def _backfill_ip_metadata(conn: sqlite3.Connection) -> None:
    """One-time backfill: derive first_seen_at and lifetime stats per IP
    from existing smtp_daily_counters rows. Idempotent — only inserts rows
    that don't already exist in smtp_ip_metadata.
    """
    rows = conn.execute(
        "SELECT source_ip, MIN(day), COALESCE(SUM(attempts), 0), COALESCE(SUM(soft_blocks), 0) "
        "FROM smtp_daily_counters GROUP BY source_ip"
    ).fetchall()
    for source_ip, first_day, attempts, soft_blocks in rows:
        if not first_day:
            continue
        ts = int(dt.datetime.strptime(first_day, "%Y-%m-%d")
                   .replace(tzinfo=dt.timezone.utc).timestamp())
        conn.execute(
            "INSERT OR IGNORE INTO smtp_ip_metadata "
            "(source_ip, first_seen_at, lifetime_attempts, lifetime_soft_blocks) "
            "VALUES (?, ?, ?, ?)",
            (source_ip, ts, attempts, soft_blocks),
        )
    conn.commit()


class Metrics:
    """Logs verification results and feedback for accuracy tracking."""

    def __init__(self, db_path: str | Path) -> None:
        self.db_path = str(db_path)
        self._init_db()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        return conn

    def _init_db(self) -> None:
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            _migrate_db(conn)
            conn.executescript(SCHEMA)
            _backfill_ip_metadata(conn)

    # --- writes ---
    def log_result(
        self,
        method: str,
        email: str,
        status: str,
        smtp_code: int | None = None,
        response_ms: int | None = None,
    ) -> None:
        soft = 1 if (smtp_code in SOFT_BLOCK_CODES) else 0
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO verification_log (ts, method, email, status, smtp_code, response_ms, soft_block) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (int(time.time()), method, email, status, smtp_code, response_ms, soft),
            )
            conn.commit()

    def log_feedback(
        self,
        email: str,
        actual_status: str,
        reported_status: str | None = None,
        notes: str | None = None,
    ) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO verification_feedback (ts, email, reported_status, actual_status, notes) "
                "VALUES (?, ?, ?, ?, ?)",
                (int(time.time()), email, reported_status, actual_status, notes),
            )
            conn.commit()

    # --- reads ---
    def today_volume(self) -> dict:
        cutoff = int(time.time()) - 86400
        with self._conn() as conn:
            row = conn.execute(
                "SELECT "
                "  SUM(CASE WHEN method='smtp' THEN 1 ELSE 0 END) AS smtp, "
                "  SUM(CASE WHEN method='zerobounce' THEN 1 ELSE 0 END) AS zerobounce, "
                "  SUM(CASE WHEN method='reoon' THEN 1 ELSE 0 END) AS reoon, "
                "  COUNT(*) AS total "
                "FROM verification_log WHERE ts > ?",
                (cutoff,),
            ).fetchone()
        return {"smtp": row[0] or 0, "zerobounce": row[1] or 0, "reoon": row[2] or 0, "total": row[3] or 0}

    def accuracy(self, days: int = 30) -> dict:
        cutoff = int(time.time()) - days * 86400
        with self._conn() as conn:
            row = conn.execute(
                "SELECT "
                "  COUNT(*) AS total, "
                "  SUM(CASE WHEN reported_status = actual_status THEN 1 ELSE 0 END) AS correct "
                "FROM verification_feedback WHERE ts > ?",
                (cutoff,),
            ).fetchone()
        total = row[0] or 0
        correct = row[1] or 0
        return {
            "feedback_count": total,
            "correct": correct,
            "accuracy_pct": round(100.0 * correct / total, 1) if total else None,
            "window_days": days,
        }


class Warmup:
    """SMTP IP warm-up: daily cap + soft-block circuit breaker, tracked per source IP."""

    def __init__(
        self,
        db_path: str | Path,
        start: int = 25,
        max_cap: int = 1500,
        days_to_max: int = 60,
        soft_block_threshold: float = 0.05,
        min_sample_before_breaker: int = 50,
        per_domain_cap: int = 40,
        source_ips: list[str] | None = None,
    ) -> None:
        self.db_path = str(db_path)
        self.start = start
        self.max_cap = max_cap
        self.days_to_max = max(1, days_to_max)
        self.soft_block_threshold = soft_block_threshold
        self.min_sample = min_sample_before_breaker
        self.per_domain_cap = per_domain_cap
        self.source_ips = source_ips or []
        # Cache of source_ip -> first_seen_at (unix timestamp); refreshed on
        # init. New IPs are registered with the current time so their warmup
        # starts at day 0.
        self._first_seen_cache: dict[str, int] = {}
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            _migrate_db(conn)
            conn.executescript(SCHEMA)
            _backfill_ip_metadata(conn)
            self._register_ips(conn)

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL;")
        return conn

    def _register_ips(self, conn: sqlite3.Connection) -> None:
        """Insert metadata rows for any configured IPs not yet known. Load
        first_seen_at into the in-memory cache for fast per-IP age lookups."""
        now = int(time.time())
        ips_to_register = list(self.source_ips) if self.source_ips else [""]
        for ip in ips_to_register:
            conn.execute(
                "INSERT OR IGNORE INTO smtp_ip_metadata (source_ip, first_seen_at) VALUES (?, ?)",
                (ip, now),
            )
        conn.commit()
        rows = conn.execute("SELECT source_ip, first_seen_at FROM smtp_ip_metadata").fetchall()
        self._first_seen_cache = {ip: ts for ip, ts in rows}

    def _days_elapsed(self, source_ip: str = "") -> int:
        """Days since this IP was first registered (per-IP warmup age)."""
        ts = self._first_seen_cache.get(source_ip)
        if ts is None:
            return 0  # unknown IP — treat as brand new
        return max(0, int((time.time() - ts) // 86400))

    def current_cap(self, source_ip: str = "") -> int:
        """Per-IP daily cap based on that IP's individual warmup age."""
        d = self._days_elapsed(source_ip)
        if d >= self.days_to_max:
            return self.max_cap
        return self.start + int((self.max_cap - self.start) * d / self.days_to_max)

    def total_cap(self) -> int:
        """Total daily cap summed across all configured IPs (each at its own age)."""
        ips = self.source_ips or [""]
        return sum(self.current_cap(ip) for ip in ips)

    def _ensure_today(self, conn: sqlite3.Connection, source_ip: str = "") -> tuple[int, int, int]:
        day = _today()
        row = conn.execute(
            "SELECT attempts, soft_blocks, paused FROM smtp_daily_counters WHERE day = ? AND source_ip = ?",
            (day, source_ip),
        ).fetchone()
        if row is None:
            conn.execute(
                "INSERT INTO smtp_daily_counters (day, source_ip, attempts, soft_blocks, paused) "
                "VALUES (?, ?, 0, 0, 0)",
                (day, source_ip),
            )
            conn.commit()
            return (0, 0, 0)
        return row

    def _domain_today(self, conn: sqlite3.Connection, domain: str, source_ip: str = "") -> tuple[int, int]:
        row = conn.execute(
            "SELECT attempts, soft_blocks FROM smtp_domain_daily "
            "WHERE day = ? AND source_ip = ? AND domain = ?",
            (_today(), source_ip, domain),
        ).fetchone()
        return row if row else (0, 0)

    def can_attempt(self, target_domain: str | None = None, source_ip: str = "") -> tuple[bool, str | None]:
        """Returns (allowed, reason_if_blocked). Checks counters for the given source IP."""
        with self._conn() as conn:
            attempts, _soft, paused = self._ensure_today(conn, source_ip)
            domain_attempts = 0
            domain_soft = 0
            if target_domain:
                domain_attempts, domain_soft = self._domain_today(conn, target_domain, source_ip)
        if paused:
            return False, "smtp_soft_block_circuit_open"
        if attempts >= self.current_cap(source_ip):
            return False, "smtp_daily_cap_reached"
        if target_domain and domain_attempts >= self.per_domain_cap:
            return False, f"smtp_per_domain_cap_reached:{target_domain}"
        if target_domain and domain_attempts >= 10 and domain_soft >= 3:
            return False, f"smtp_per_domain_soft_block:{target_domain}"
        return True, None

    def record_attempt(
        self, smtp_code: int | None, target_domain: str | None = None, source_ip: str = ""
    ) -> None:
        is_soft = 1 if (smtp_code in SOFT_BLOCK_CODES) else 0
        day = _today()
        now = int(time.time())
        with self._conn() as conn:
            self._ensure_today(conn, source_ip)
            conn.execute(
                "INSERT OR IGNORE INTO smtp_ip_metadata (source_ip, first_seen_at) VALUES (?, ?)",
                (source_ip, now),
            )
            self._first_seen_cache.setdefault(source_ip, now)
            conn.execute(
                "UPDATE smtp_ip_metadata SET last_activity_at = ?, "
                "lifetime_attempts = lifetime_attempts + 1, "
                "lifetime_soft_blocks = lifetime_soft_blocks + ? "
                "WHERE source_ip = ?",
                (now, is_soft, source_ip),
            )
            conn.execute(
                "UPDATE smtp_daily_counters "
                "SET attempts = attempts + 1, soft_blocks = soft_blocks + ? "
                "WHERE day = ? AND source_ip = ?",
                (is_soft, day, source_ip),
            )
            if target_domain:
                conn.execute(
                    "INSERT INTO smtp_domain_daily (day, source_ip, domain, attempts, soft_blocks) "
                    "VALUES (?, ?, ?, 1, ?) "
                    "ON CONFLICT(day, source_ip, domain) DO UPDATE SET "
                    "  attempts = attempts + 1, soft_blocks = soft_blocks + ?",
                    (day, source_ip, target_domain, is_soft, is_soft),
                )
            row = conn.execute(
                "SELECT attempts, soft_blocks FROM smtp_daily_counters WHERE day = ? AND source_ip = ?",
                (day, source_ip),
            ).fetchone()
            attempts, soft_blocks = row
            if attempts >= self.min_sample and (soft_blocks / attempts) > self.soft_block_threshold:
                conn.execute(
                    "UPDATE smtp_daily_counters SET paused = 1 WHERE day = ? AND source_ip = ?",
                    (day, source_ip),
                )
                ip_label = source_ip or "default"
                logger.warning(
                    "SMTP circuit breaker open for IP %s: %d/%d soft blocks today "
                    "(%.1f%% > %.1f%% threshold). Pausing that IP for the rest of the UTC day.",
                    ip_label, soft_blocks, attempts,
                    100 * soft_blocks / attempts, 100 * self.soft_block_threshold,
                )
            conn.commit()

    def is_pool_exhausted(self) -> bool:
        """True if every configured source IP has hit its (per-IP) daily cap
        or tripped its circuit breaker for today.

        Used to decide whether to reject new SMTP requests with HTTP 503.
        Cached results don't go through this check.
        """
        ips_to_check = self.source_ips or [""]
        with self._conn() as conn:
            for ip in ips_to_check:
                row = conn.execute(
                    "SELECT attempts, paused FROM smtp_daily_counters WHERE day = ? AND source_ip = ?",
                    (_today(), ip),
                ).fetchone()
                if row is None:
                    return False  # IP has no attempts yet => capacity available
                attempts, paused = row
                if not paused and attempts < self.current_cap(ip):
                    return False
        return True

    def today_stats(self) -> dict:
        day = _today()
        with self._conn() as conn:
            agg = conn.execute(
                "SELECT COALESCE(SUM(attempts),0), COALESCE(SUM(soft_blocks),0), COALESCE(MAX(paused),0) "
                "FROM smtp_daily_counters WHERE day = ?",
                (day,),
            ).fetchone()
            attempts, soft_blocks, paused = agg

            # Left-join daily counters onto metadata so we surface every
            # configured IP, including ones with zero traffic today.
            ip_rows = conn.execute(
                """
                SELECT m.source_ip,
                       m.first_seen_at,
                       m.last_activity_at,
                       m.lifetime_attempts,
                       m.lifetime_soft_blocks,
                       COALESCE(d.attempts, 0),
                       COALESCE(d.soft_blocks, 0),
                       COALESCE(d.paused, 0)
                FROM smtp_ip_metadata m
                LEFT JOIN smtp_daily_counters d
                  ON d.source_ip = m.source_ip AND d.day = ?
                ORDER BY m.source_ip
                """,
                (day,),
            ).fetchall()

            top_domains = conn.execute(
                "SELECT domain, SUM(attempts) AS a, SUM(soft_blocks) AS s "
                "FROM smtp_domain_daily WHERE day = ? GROUP BY domain ORDER BY a DESC LIMIT 10",
                (day,),
            ).fetchall()

        total = self.total_cap()
        per_ip = []
        for ip, first_seen, last_act, life_att, life_soft, a, s, p in ip_rows:
            cap = self.current_cap(ip)
            age_days = self._days_elapsed(ip)
            per_ip.append({
                "source_ip": ip or "default",
                "first_seen": dt.datetime.fromtimestamp(first_seen, dt.timezone.utc).isoformat(),
                "last_activity": (dt.datetime.fromtimestamp(last_act, dt.timezone.utc).isoformat()
                                  if last_act else None),
                "age_days": age_days,
                "day_in_warmup": min(age_days, self.days_to_max),
                "warmup_complete": age_days >= self.days_to_max,
                "cap": cap,
                "attempts": a,
                "soft_blocks": s,
                "soft_block_pct": round(100.0 * s / a, 1) if a else 0.0,
                "remaining": max(0, cap - a),
                "paused": bool(p),
                "lifetime_attempts": life_att,
                "lifetime_soft_blocks": life_soft,
            })

        return {
            "day": day,
            "attempts": attempts,
            "soft_blocks": soft_blocks,
            "soft_block_pct": round(100.0 * soft_blocks / attempts, 1) if attempts else 0.0,
            "cap": total,
            "remaining": max(0, total - attempts),
            "paused": bool(paused),
            "per_domain_cap": self.per_domain_cap,
            "days_to_max": self.days_to_max,
            "source_ip_count": len(per_ip),
            "per_ip": per_ip,
            "top_domains_today": [
                {"domain": d, "attempts": a, "soft_blocks": s} for d, a, s in top_domains
            ],
        }


__all__ = ["Metrics", "Warmup", "SOFT_BLOCK_CODES"]
