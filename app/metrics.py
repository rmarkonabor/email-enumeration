"""SMTP IP warm-up controller and verification metrics/feedback storage.

Two responsibilities, one SQLite database (shared with the cache):

1. **Warmup**: cap daily SMTP attempts to ramp our outgoing IP reputation
   gradually using a stepped schedule (see ``DEFAULT_STEPPED_SCHEDULE``).
   Each source IP is tracked independently — caps, circuit breaker, and
   per-provider counters are all keyed by ``source_ip``.

   The stepped schedule is a conservative starting hypothesis tuned for
   B2B-only verification traffic. A later phase layers an AIMD-style
   adaptive controller on top, but the schedule remains the cold-start
   default and the safety floor.

2. **Metrics**: log every verification attempt (SMTP or third-party) and
   accept user feedback ("you said verified but the email bounces") so we
   can measure real-world accuracy. SMTP attempts are additionally tallied
   per (source_ip, provider) in ``smtp_provider_daily`` so we can observe
   per-provider health (throttle rate, latency) before adapting caps.

Soft-block SMTP codes (throttling — count toward circuit breaker):
   421  Service not available, closing transmission channel
   450  Mailbox unavailable; try again later
   451  Local error in processing
   452  Insufficient system storage

Hard-block SMTP codes (policy / blocklist — reputation incident):
   521  Server does not accept mail
   554  Transaction failed / policy reject
"""
from __future__ import annotations

import datetime as dt
import logging
import sqlite3
import time
from pathlib import Path

logger = logging.getLogger(__name__)

SOFT_BLOCK_CODES = {421, 450, 451, 452}
HARD_BLOCK_CODES = {521, 554}

# B2B-tuned stepped warmup schedule: (days_upper_bound_exclusive, daily_cap_per_ip).
# Driven by Microsoft as the binding constraint (Phase 1 of adaptive controller
# treats this as both starting point and floor; it does NOT replace the need
# for SNDS/Postmaster reputation monitoring).
DEFAULT_STEPPED_SCHEDULE: tuple[tuple[int, int], ...] = (
    (2,      60),    # days 0-1   : cold start, observe only
    (5,      200),   # days 2-4   : establish baseline
    (10,     500),   # days 5-9   : first real load
    (15,     1100),  # days 10-14 : cross harvest-suspicion threshold deliberately
    (22,     2000),  # days 15-21 :
    (30,     3000),  # days 22-29 :
    (45,     4200),  # days 30-44 :
    (60,     5500),  # days 45-59 : conservative steady state
    (10**9,  5800),  # 60+        : hold; manual raise only with SNDS-green data
)

SCHEMA = """
CREATE TABLE IF NOT EXISTS verification_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    method TEXT NOT NULL,
    email TEXT NOT NULL,
    status TEXT NOT NULL,
    smtp_code INTEGER,
    response_ms INTEGER,
    soft_block INTEGER NOT NULL DEFAULT 0,
    user_id TEXT,
    candidates_tried INTEGER NOT NULL DEFAULT 0,
    credits_used INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_vl_ts ON verification_log (ts);
CREATE INDEX IF NOT EXISTS idx_vl_email ON verification_log (email);
CREATE INDEX IF NOT EXISTS idx_vl_user ON verification_log (user_id);

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

CREATE TABLE IF NOT EXISTS smtp_provider_daily (
    day TEXT NOT NULL,
    source_ip TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    soft_blocks INTEGER NOT NULL DEFAULT 0,
    hard_blocks INTEGER NOT NULL DEFAULT 0,
    latency_ms_sum INTEGER NOT NULL DEFAULT 0,
    latency_ms_count INTEGER NOT NULL DEFAULT 0,
    latency_ms_max INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, source_ip, provider)
);
CREATE INDEX IF NOT EXISTS idx_spd_day ON smtp_provider_daily (day);
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


def _migrate_verification_log(conn: sqlite3.Connection) -> None:
    """Add columns to verification_log on existing deployments."""
    tbl = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='verification_log'"
    ).fetchone()
    if not tbl:
        return  # Fresh install — SCHEMA creates it fully
    cols = {row[1] for row in conn.execute("PRAGMA table_info(verification_log)").fetchall()}
    if "user_id" not in cols:
        conn.execute("ALTER TABLE verification_log ADD COLUMN user_id TEXT")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_vl_user ON verification_log (user_id)")
    if "candidates_tried" not in cols:
        # SQLite ALTER TABLE ADD COLUMN cannot enforce NOT NULL without a default,
        # but DEFAULT 0 makes all existing rows 0 which is correct.
        conn.execute("ALTER TABLE verification_log ADD COLUMN candidates_tried INTEGER DEFAULT 0")
    if "credits_used" not in cols:
        conn.execute("ALTER TABLE verification_log ADD COLUMN credits_used INTEGER DEFAULT 0")
    conn.commit()


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
            _migrate_verification_log(conn)
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
        user_id: str | None = None,
        candidates_tried: int = 0,
        credits_used: int = 0,
    ) -> None:
        soft = 1 if (smtp_code in SOFT_BLOCK_CODES) else 0
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO verification_log "
                "(ts, method, email, status, smtp_code, response_ms, soft_block, user_id, "
                " candidates_tried, credits_used) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (int(time.time()), method, email, status, smtp_code, response_ms, soft, user_id,
                 candidates_tried, credits_used),
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

    def user_activity_summary(self) -> list[dict]:
        """Aggregate verification counts per user_id across 24h / 7d / 30d windows."""
        now = int(time.time())
        cutoffs = {
            "24h": now - 86400,
            "7d": now - 7 * 86400,
            "30d": now - 30 * 86400,
        }
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT user_id, COUNT(*), MAX(ts) "
                "FROM verification_log "
                "WHERE user_id IS NOT NULL "
                "GROUP BY user_id",
            ).fetchall()
            out = []
            for user_id, total, last_ts in rows:
                counts = {}
                for label, cutoff in cutoffs.items():
                    n = conn.execute(
                        "SELECT COUNT(*) FROM verification_log WHERE user_id = ? AND ts > ?",
                        (user_id, cutoff),
                    ).fetchone()[0]
                    counts[label] = n
                out.append({
                    "user_id": user_id,
                    "lifetime_lookups": total,
                    "last_activity": dt.datetime.fromtimestamp(last_ts, dt.timezone.utc).isoformat()
                                     if last_ts else None,
                    **{f"lookups_{k}": v for k, v in counts.items()},
                })
        return out

    def user_lookups_today(self, user_id: str) -> int:
        """Count of verification_log rows for this user in the last 24h.
        Used by the job queue for per-user daily quota enforcement."""
        cutoff = int(time.time()) - 86400
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COUNT(*) FROM verification_log WHERE user_id = ? AND ts > ?",
                (user_id, cutoff),
            ).fetchone()
        return int(row[0])

    def user_recent_log(self, user_id: str, limit: int = 50) -> list[dict]:
        """Last N verification log entries for a specific user (newest first)."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT ts, method, email, status, smtp_code, response_ms "
                "FROM verification_log WHERE user_id = ? "
                "ORDER BY ts DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [
            {
                "ts": dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat(),
                "method": method,
                "email": email,
                "status": status,
                "smtp_code": smtp_code,
                "response_ms": response_ms,
            }
            for ts, method, email, status, smtp_code, response_ms in rows
        ]

    def user_stats(self, user_id: str, range_seconds: int | None) -> dict:
        """Aggregate dashboard stats for a user over the given time window.
        range_seconds=None means all time."""
        cutoff = int(time.time()) - range_seconds if range_seconds else 0
        with self._conn() as conn:
            row = conn.execute(
                """
                SELECT
                  COUNT(*) AS total,
                  SUM(CASE WHEN status='verified'  THEN 1 ELSE 0 END) AS verified,
                  SUM(CASE WHEN status='catch_all' THEN 1 ELSE 0 END) AS catch_all,
                  SUM(CASE WHEN status='not_found' THEN 1 ELSE 0 END) AS not_found,
                  SUM(COALESCE(candidates_tried, 0)) AS total_enumerations,
                  SUM(COALESCE(credits_used, 0)) AS total_credits,
                  SUM(CASE WHEN status='verified' THEN COALESCE(candidates_tried, 0) ELSE 0 END) AS enum_verified_sum,
                  COUNT(CASE WHEN status='verified' THEN 1 END) AS verified_count2
                FROM verification_log
                WHERE user_id = ? AND ts >= ?
                  AND status IN ('verified', 'catch_all', 'not_found')
                """,
                (user_id, cutoff),
            ).fetchone()
            total, verified, catch_all, not_found, total_enum, total_credits, \
                enum_verified_sum, verified_count2 = row

            total = total or 0
            verified = verified or 0
            catch_all = catch_all or 0
            not_found = not_found or 0
            total_enum = total_enum or 0
            total_credits = total_credits or 0
            avg_enum = round(enum_verified_sum / verified_count2, 2) if verified_count2 else 0

            # Daily breakdown — group by UTC date
            daily_rows = conn.execute(
                """
                SELECT
                  date(ts, 'unixepoch') AS day,
                  COUNT(*) AS total,
                  SUM(CASE WHEN status='verified' THEN 1 ELSE 0 END) AS verified,
                  SUM(COALESCE(candidates_tried, 0)) AS enumerations,
                  SUM(COALESCE(credits_used, 0)) AS credits
                FROM verification_log
                WHERE user_id = ? AND ts >= ?
                  AND status IN ('verified', 'catch_all', 'not_found')
                GROUP BY day
                ORDER BY day
                """,
                (user_id, cutoff),
            ).fetchall()

        return {
            "total": total,
            "verified": verified,
            "catch_all": catch_all,
            "not_found": not_found,
            "total_enumerations": total_enum,
            "total_credits": total_credits,
            "avg_enumerations_per_verified": avg_enum,
            "daily": [
                {"date": d, "total": t, "verified": v, "enumerations": e, "credits": c}
                for d, t, v, e, c in daily_rows
            ],
        }

    def delete_user_data(self, user_id: str) -> int:
        """Delete all verification_log rows for a user. Returns rows deleted."""
        with self._conn() as conn:
            cur = conn.execute("DELETE FROM verification_log WHERE user_id = ?", (user_id,))
            conn.commit()
            return cur.rowcount

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
        schedule: tuple[tuple[int, int], ...] = DEFAULT_STEPPED_SCHEDULE,
        soft_block_threshold: float = 0.05,
        min_sample_before_breaker: int = 50,
        per_domain_cap: int = 40,
        source_ips: list[str] | None = None,
    ) -> None:
        self.db_path = str(db_path)
        self.schedule = tuple(sorted(schedule, key=lambda s: s[0]))
        # Derived reference values for reporting / backward-compat in stats output.
        self.start = self.schedule[0][1]
        self.max_cap = self.schedule[-1][1]
        # Last *finite* step's upper bound — the day at which we reach steady state.
        finite_steps = [u for u, _ in self.schedule if u < 10**8]
        self.days_to_max = max(finite_steps) if finite_steps else self.schedule[0][0]
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
            _migrate_verification_log(conn)
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
        """Per-IP daily cap from the stepped schedule based on that IP's age."""
        d = self._days_elapsed(source_ip)
        for upper_excl, cap in self.schedule:
            if d < upper_excl:
                return cap
        return self.schedule[-1][1]

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
        self,
        smtp_code: int | None,
        target_domain: str | None = None,
        source_ip: str = "",
        provider: str = "unknown",
        response_ms: int | None = None,
    ) -> None:
        is_soft = 1 if (smtp_code in SOFT_BLOCK_CODES) else 0
        is_hard = 1 if (smtp_code in HARD_BLOCK_CODES) else 0
        day = _today()
        now = int(time.time())
        latency = int(response_ms) if response_ms and response_ms > 0 else 0
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
            conn.execute(
                "INSERT INTO smtp_provider_daily "
                "(day, source_ip, provider, attempts, soft_blocks, hard_blocks, "
                " latency_ms_sum, latency_ms_count, latency_ms_max) "
                "VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?) "
                "ON CONFLICT(day, source_ip, provider) DO UPDATE SET "
                "  attempts = attempts + 1, "
                "  soft_blocks = soft_blocks + ?, "
                "  hard_blocks = hard_blocks + ?, "
                "  latency_ms_sum = latency_ms_sum + ?, "
                "  latency_ms_count = latency_ms_count + ?, "
                "  latency_ms_max = MAX(latency_ms_max, ?)",
                (day, source_ip, provider,
                 is_soft, is_hard, latency, 1 if latency else 0, latency,
                 is_soft, is_hard, latency, 1 if latency else 0, latency),
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

            provider_rows = conn.execute(
                "SELECT source_ip, provider, attempts, soft_blocks, hard_blocks, "
                "       latency_ms_sum, latency_ms_count, latency_ms_max "
                "FROM smtp_provider_daily WHERE day = ? "
                "ORDER BY source_ip, attempts DESC",
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

        per_provider = [
            {
                "source_ip": ip or "default",
                "provider": p,
                "attempts": a,
                "soft_blocks": sb,
                "hard_blocks": hb,
                "soft_block_pct": round(100.0 * sb / a, 1) if a else 0.0,
                "hard_block_pct": round(100.0 * hb / a, 1) if a else 0.0,
                "latency_avg_ms": int(lsum / lcount) if lcount else 0,
                "latency_max_ms": lmax,
            }
            for ip, p, a, sb, hb, lsum, lcount, lmax in provider_rows
        ]

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
            "per_provider": per_provider,
            "schedule": [
                {"days_upper_excl": u, "cap": c} for u, c in self.schedule
            ],
            "top_domains_today": [
                {"domain": d, "attempts": a, "soft_blocks": s} for d, a, s in top_domains
            ],
        }


__all__ = ["Metrics", "Warmup", "SOFT_BLOCK_CODES"]
