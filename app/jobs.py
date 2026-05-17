"""Background job queue for large batch verifications.

Submissions over ``SYNC_THRESHOLD`` contacts are enqueued instead of streamed
over the request connection. A single background worker pulls one contact at
a time, round-robin across users that have active jobs, so a 5,000-contact
batch from User A can't starve a 50-contact batch from User B.

Per-user quotas (used + pending vs ``DEFAULT_USER_DAILY_QUOTA``) are checked
at submission so users get a clear "you've used N today" rejection rather
than discovering it mid-batch.

Schema:
  batch_jobs(id, user_id, status, contacts JSON, total, done_count,
             results JSON, verify_provider, zerobounce_api_key, reoon_api_key,
             region, created_at, started_at, completed_at, error, cancel_requested)
"""
from __future__ import annotations

import asyncio
import datetime as dt
import json
import logging
import sqlite3
import time
import uuid
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Awaitable

logger = logging.getLogger(__name__)

SYNC_THRESHOLD = 25  # contacts: at or below = stream synchronously; above = queue
ACTIVE_STATUSES = ("queued", "running")
TERMINAL_STATUSES = ("done", "failed", "cancelled")

SCHEMA = """
CREATE TABLE IF NOT EXISTS batch_jobs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    status TEXT NOT NULL,
    contacts TEXT NOT NULL,
    total INTEGER NOT NULL,
    done_count INTEGER NOT NULL DEFAULT 0,
    results TEXT NOT NULL DEFAULT '[]',
    verify_provider TEXT NOT NULL DEFAULT 'smtp',
    zerobounce_api_key TEXT,
    reoon_api_key TEXT,
    region TEXT NOT NULL DEFAULT 'us',
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    completed_at INTEGER,
    error TEXT,
    cancel_requested INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_bj_user ON batch_jobs (user_id);
CREATE INDEX IF NOT EXISTS idx_bj_status ON batch_jobs (status, created_at);
"""

_MIGRATION_ADD_REGION = (
    "ALTER TABLE batch_jobs ADD COLUMN region TEXT NOT NULL DEFAULT 'us'"
)

_MIGRATION_ADD_REGION_INDEX = (
    "CREATE INDEX IF NOT EXISTS idx_bj_region ON batch_jobs (region, status, created_at)"
)


@dataclass
class QuotaCheck:
    allowed: bool
    used_today: int
    pending: int
    quota: int
    available: int
    reason: str | None = None


class JobStore:
    """SQLite-backed persistence for batch jobs. Thread/process-safe via WAL."""

    def __init__(self, db_path: str | Path, region: str = "us") -> None:
        self.db_path = str(db_path)
        self.region = region
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as conn:
            conn.executescript(SCHEMA)
            # Migrate existing DB: add region column if not present, then
            # create the index (must come after column exists).
            try:
                conn.execute(_MIGRATION_ADD_REGION)
                conn.commit()
            except sqlite3.OperationalError:
                pass  # column already exists
            conn.execute(_MIGRATION_ADD_REGION_INDEX)
            conn.commit()
            # Reset running jobs for THIS region only — safe on shared DB when
            # multiple regional servers restart independently.
            conn.execute(
                "UPDATE batch_jobs SET status = 'queued', started_at = NULL "
                "WHERE status = 'running' AND region = ?",
                (region,),
            )
            conn.commit()

    def _conn(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.execute("PRAGMA journal_mode=WAL;")
        conn.execute("PRAGMA synchronous=NORMAL;")
        conn.row_factory = sqlite3.Row
        return conn

    # ----------------------------------------------------------------- writes
    def create(
        self,
        user_id: str,
        contacts: list[dict],
        verify_provider: str,
        zerobounce_api_key: str = "",
        reoon_api_key: str = "",
        region: str | None = None,
    ) -> str:
        job_id = uuid.uuid4().hex
        job_region = region if region is not None else self.region
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO batch_jobs "
                "(id, user_id, status, contacts, total, verify_provider, "
                " zerobounce_api_key, reoon_api_key, region, created_at) "
                "VALUES (?, ?, 'queued', ?, ?, ?, ?, ?, ?, ?)",
                (job_id, user_id, json.dumps(contacts), len(contacts),
                 verify_provider, zerobounce_api_key, reoon_api_key,
                 job_region, int(time.time())),
            )
            conn.commit()
        return job_id

    def mark_running(self, job_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE batch_jobs SET status = 'running', started_at = COALESCE(started_at, ?) "
                "WHERE id = ? AND status = 'queued'",
                (int(time.time()), job_id),
            )
            conn.commit()

    def append_result(self, job_id: str, result: dict) -> None:
        """Append a per-contact result and increment done_count.

        NOT thread/process safe under concurrent writers — relies on the single-
        worker invariant. If you ever run multiple workers, replace with a
        per-contact row table or use an explicit UPDATE...WHERE done_count = ?
        compare-and-swap.
        """
        with self._conn() as conn:
            row = conn.execute(
                "SELECT results, done_count FROM batch_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not row:
                return
            results = json.loads(row["results"])
            results.append(result)
            conn.execute(
                "UPDATE batch_jobs SET results = ?, done_count = ? WHERE id = ?",
                (json.dumps(results), row["done_count"] + 1, job_id),
            )
            conn.commit()

    def mark_done(self, job_id: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE batch_jobs SET status = 'done', completed_at = ? WHERE id = ?",
                (int(time.time()), job_id),
            )
            conn.commit()

    def mark_failed(self, job_id: str, error: str) -> None:
        with self._conn() as conn:
            conn.execute(
                "UPDATE batch_jobs SET status = 'failed', error = ?, completed_at = ? "
                "WHERE id = ?",
                (error[:500], int(time.time()), job_id),
            )
            conn.commit()

    def request_cancel(self, job_id: str, user_id: str) -> bool:
        """Mark cancellation; worker picks it up between contacts. Returns True
        if the job belonged to the user and was active."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT status FROM batch_jobs WHERE id = ? AND user_id = ?",
                (job_id, user_id),
            ).fetchone()
            if not row or row["status"] not in ACTIVE_STATUSES:
                return False
            conn.execute(
                "UPDATE batch_jobs SET cancel_requested = 1 WHERE id = ?", (job_id,)
            )
            conn.commit()
            return True

    def apply_cancel_if_requested(self, job_id: str) -> bool:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT cancel_requested FROM batch_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not row or not row["cancel_requested"]:
                return False
            conn.execute(
                "UPDATE batch_jobs SET status = 'cancelled', completed_at = ? "
                "WHERE id = ? AND status IN ('queued','running')",
                (int(time.time()), job_id),
            )
            conn.commit()
            return True

    # ------------------------------------------------------------------ reads
    def get(self, job_id: str) -> dict | None:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, user_id, status, contacts, total, done_count, results, "
                "verify_provider, region, created_at, started_at, completed_at, error, "
                "cancel_requested FROM batch_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
        return self._row_to_dict(row) if row else None

    def list_for_user(self, user_id: str, limit: int = 50) -> list[dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT id, user_id, status, total, done_count, verify_provider, "
                "region, created_at, started_at, completed_at, error "
                "FROM batch_jobs WHERE user_id = ? "
                "ORDER BY created_at DESC LIMIT ?",
                (user_id, limit),
            ).fetchall()
        return [self._summary_row(r) for r in rows]

    def users_with_active_jobs(self, region: str | None = None) -> list[str]:
        """Distinct user_ids with at least one active job for this region,
        ordered by their oldest active job's creation time."""
        rgn = region if region is not None else self.region
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT user_id FROM batch_jobs "
                "WHERE status IN ('queued','running') AND region = ? "
                "GROUP BY user_id "
                "ORDER BY MIN(created_at)",
                (rgn,),
            ).fetchall()
        return [row["user_id"] for row in rows]

    def next_active_job_for_user(self, user_id: str, region: str | None = None) -> dict | None:
        rgn = region if region is not None else self.region
        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, user_id, status, contacts, total, done_count, results, "
                "verify_provider, zerobounce_api_key, reoon_api_key, region, created_at "
                "FROM batch_jobs "
                "WHERE user_id = ? AND status IN ('queued','running') AND region = ? "
                "ORDER BY created_at LIMIT 1",
                (user_id, rgn),
            ).fetchone()
        return self._row_to_dict(row, include_secrets=True) if row else None

    def pending_count_for_user(self, user_id: str) -> int:
        """Total contacts queued or in-flight across ALL regions for this user.
        Intentionally global — quota is per-user, not per-region."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT COALESCE(SUM(total - done_count), 0) FROM batch_jobs "
                "WHERE user_id = ? AND status IN ('queued','running')",
                (user_id,),
            ).fetchone()
        return int(row[0])

    def reset_stale_running_jobs(self, stale_after_seconds: int = 3600,
                                  region: str | None = None) -> int:
        """Reset jobs stuck in 'running' for too long back to 'queued'.
        Scoped to this server's region so restarts on one server don't
        disturb another region's in-flight jobs."""
        rgn = region if region is not None else self.region
        cutoff = int(time.time()) - stale_after_seconds
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE batch_jobs SET status = 'queued', started_at = NULL "
                "WHERE status = 'running' AND started_at IS NOT NULL AND started_at < ? "
                "AND done_count < total AND region = ?",
                (cutoff, rgn),
            )
            conn.commit()
            return cur.rowcount

    def queue_position(self, job_id: str) -> int:
        """How many same-region jobs are ahead of this one in the FIFO. 0 = next."""
        with self._conn() as conn:
            row = conn.execute(
                "SELECT created_at, region FROM batch_jobs WHERE id = ?", (job_id,)
            ).fetchone()
            if not row:
                return -1
            ahead = conn.execute(
                "SELECT COUNT(*) FROM batch_jobs "
                "WHERE status IN ('queued','running') AND region = ? AND created_at < ?",
                (row["region"], row["created_at"]),
            ).fetchone()[0]
        return int(ahead)

    # ------------------------------------------------------------ row helpers
    @staticmethod
    def _row_to_dict(row: sqlite3.Row, include_secrets: bool = False) -> dict:
        keys = row.keys()
        out = {
            "id": row["id"],
            "user_id": row["user_id"],
            "status": row["status"],
            "contacts": json.loads(row["contacts"]),
            "total": row["total"],
            "done_count": row["done_count"],
            "results": json.loads(row["results"]),
            "verify_provider": row["verify_provider"],
            "region": row["region"] if "region" in keys else "us",
            "created_at": JobStore._iso(row["created_at"]),
            "started_at": JobStore._iso(row["started_at"]) if "started_at" in keys else None,
            "completed_at": JobStore._iso(row["completed_at"]) if "completed_at" in keys else None,
            "error": row["error"] if "error" in keys else None,
            "cancel_requested": bool(row["cancel_requested"]) if "cancel_requested" in keys else False,
        }
        if include_secrets:
            out["zerobounce_api_key"] = row["zerobounce_api_key"]
            out["reoon_api_key"] = row["reoon_api_key"]
        return out

    @staticmethod
    def _summary_row(row: sqlite3.Row) -> dict:
        keys = row.keys()
        return {
            "id": row["id"],
            "user_id": row["user_id"],
            "status": row["status"],
            "total": row["total"],
            "done_count": row["done_count"],
            "verify_provider": row["verify_provider"],
            "region": row["region"] if "region" in keys else "us",
            "created_at": JobStore._iso(row["created_at"]),
            "started_at": JobStore._iso(row["started_at"]),
            "completed_at": JobStore._iso(row["completed_at"]),
            "error": row["error"],
        }

    @staticmethod
    def _iso(ts: int | None) -> str | None:
        if not ts:
            return None
        return dt.datetime.fromtimestamp(ts, dt.timezone.utc).isoformat()


def check_quota(
    store: JobStore,
    metrics_used_today: Callable[[str], int],
    user_id: str,
    new_contacts: int,
    quota: int,
) -> QuotaCheck:
    """Combine actual completed lookups today with pending queued/in-flight
    work for the same user. Reject if adding ``new_contacts`` would exceed
    ``quota``. ``metrics_used_today`` is injected so callers can pass the
    Metrics method that counts verification_log rows in the last 24h."""
    used = max(0, metrics_used_today(user_id))
    pending = store.pending_count_for_user(user_id)
    available = max(0, quota - used - pending)
    if new_contacts > available:
        return QuotaCheck(
            allowed=False,
            used_today=used,
            pending=pending,
            quota=quota,
            available=available,
            reason=(f"daily_quota_exceeded: used {used}, pending {pending}, "
                    f"quota {quota}, available {available}, requested {new_contacts}"),
        )
    return QuotaCheck(
        allowed=True, used_today=used, pending=pending, quota=quota, available=available,
    )


class JobWorker:
    """Single-coroutine background worker. Round-robins one contact at a time
    across users with active jobs so big jobs don't starve small ones.

    The worker calls ``finder.find()`` directly — the per-IP warmup throttles
    and circuit-breaker still apply, just from inside the worker rather than
    a request handler.
    """

    def __init__(
        self,
        store: JobStore,
        finder: Any,
        warmup: Any,
        region: str = "us",
        pool_exhausted_sleep: float = 60.0,
        idle_sleep: float = 2.0,
        per_contact_sleep: float = 0.1,
    ) -> None:
        self.store = store
        self.finder = finder
        self.warmup = warmup
        self.region = region
        self.pool_exhausted_sleep = pool_exhausted_sleep
        self.idle_sleep = idle_sleep
        self.per_contact_sleep = per_contact_sleep
        self._rotation: deque[str] = deque()
        self._task: asyncio.Task | None = None
        self._stopping = False
        self._consecutive_skips = 0
        self._last_stale_check = 0.0

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._stopping = False
            self._task = asyncio.create_task(self._loop(), name="job-worker")
            logger.info("Job worker started")
            # Reset any jobs already stuck at startup
            reset = self.store.reset_stale_running_jobs()
            if reset:
                logger.warning("Reset %d stale running job(s) to queued on startup", reset)

    async def stop(self) -> None:
        self._stopping = True
        if self._task:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass

    async def _loop(self) -> None:
        while not self._stopping:
            try:
                # Periodically reset jobs stuck in 'running' for > 1 hour
                now = time.time()
                if now - self._last_stale_check > 3600:
                    reset = self.store.reset_stale_running_jobs()
                    if reset:
                        logger.warning("Stale-job watchdog reset %d job(s) to queued", reset)
                        self._rotation.clear()  # Force rotation refill
                    self._last_stale_check = now

                await self._tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.exception("Worker tick failed: %s", e)
                await asyncio.sleep(5)

    def _next_user(self) -> str | None:
        """Round-robin: keep an in-memory queue of users with pending work for
        this region, refilling from the DB when empty."""
        if not self._rotation:
            active = self.store.users_with_active_jobs(region=self.region)
            if not active:
                return None
            self._rotation.extend(active)
        return self._rotation.popleft() if self._rotation else None

    async def _tick(self) -> None:
        user_id = self._next_user()
        if user_id is None:
            await asyncio.sleep(self.idle_sleep)
            self._consecutive_skips = 0
            return

        job = self.store.next_active_job_for_user(user_id, region=self.region)
        if not job:
            self._consecutive_skips = 0
            return  # User's jobs all completed between rotation snapshot and now

        if self.store.apply_cancel_if_requested(job["id"]):
            self._consecutive_skips = 0
            return  # Cancelled; do nothing else

        # Guard against an over-counted job (e.g., reset-on-startup leftovers).
        if job["done_count"] >= job["total"]:
            self.store.mark_done(job["id"])
            self._consecutive_skips = 0
            return

        if job["status"] == "queued":
            self.store.mark_running(job["id"])

        # SMTP pool exhausted: defer this user but DON'T sleep all jobs — a
        # different user might have a zerobounce/reoon job that's unaffected.
        if (job["verify_provider"] == "smtp"
                and self.warmup is not None
                and self.warmup.is_pool_exhausted()):
            # Check cancel before deferring — user shouldn't have to wait for
            # a pool-exhaustion sleep just to see their cancel take effect.
            if self.store.apply_cancel_if_requested(job["id"]):
                self._consecutive_skips = 0
                return
            self._rotation.append(user_id)
            self._consecutive_skips += 1
            if self._consecutive_skips >= max(1, len(self._rotation) + 1):
                # Sleep in 5s chunks so cancel requests are applied promptly.
                slept = 0.0
                while slept < self.pool_exhausted_sleep and not self._stopping:
                    await asyncio.sleep(min(5.0, self.pool_exhausted_sleep - slept))
                    slept += 5.0
                self._consecutive_skips = 0
            else:
                # Yield to the event loop so request handlers aren't blocked
                # while we cycle through all users checking for exhaustion.
                await asyncio.sleep(0)
            return

        self._consecutive_skips = 0
        contact = job["contacts"][job["done_count"]]

        if not (str(contact.get("first_name", "")).strip()
                and str(contact.get("last_name", "")).strip()
                and str(contact.get("domain", "")).strip()):
            response = {
                "request": contact,
                "email": None,
                "status": "skipped",
                "catch_all": False,
                "candidates_tried": 0,
                "mail_provider": None,
                "credits_used": 0,
            }
        else:
            try:
                result = await self.finder.find(
                    first_name=contact["first_name"],
                    last_name=contact["last_name"],
                    domain=contact["domain"],
                    middle_name=contact.get("middle_name"),
                    return_attempts=False,
                    provider=job["verify_provider"],
                    provider_key=(job.get("zerobounce_api_key")
                                  if job["verify_provider"] == "zerobounce"
                                  else job.get("reoon_api_key") or ""),
                    user_id=user_id,
                )
                response = {
                    "request": contact,
                    "email": result.email,
                    "status": result.status,
                    "catch_all": result.catch_all,
                    "candidates_tried": result.candidates_tried,
                    "mail_provider": result.mail_provider,
                    "credits_used": result.credits_used,
                }
            except Exception as e:
                logger.warning("Contact processing failed (job=%s): %s", job["id"], e)
                response = {
                    "request": contact,
                    "email": None,
                    "status": "error",
                    "catch_all": False,
                    "candidates_tried": 0,
                    "mail_provider": None,
                    "credits_used": 0,
                    "error": str(e)[:200],
                }

        try:
            self.store.append_result(job["id"], response)
        except Exception as e:
            # If we can't persist the result the done_count won't increment and
            # this contact would be retried forever. Mark the job failed so it
            # doesn't loop — the stale watchdog would catch it in an hour anyway.
            logger.critical("append_result failed for job=%s contact=%d, marking failed: %s",
                            job["id"], job["done_count"], e)
            self.store.mark_failed(job["id"], f"DB write failed: {e}")
            return

        # Re-check job state after this contact
        updated = self.store.get(job["id"])
        if updated and updated["done_count"] >= updated["total"]:
            self.store.mark_done(job["id"])
        else:
            # Job has more work; rotate this user back into the queue
            self._rotation.append(user_id)

        await asyncio.sleep(self.per_contact_sleep)


__all__ = [
    "JobStore", "JobWorker", "QuotaCheck", "check_quota",
    "SYNC_THRESHOLD", "ACTIVE_STATUSES", "TERMINAL_STATUSES",
]
