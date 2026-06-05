"""
SQLite-backed user store and session persistence.

Uses the built-in sqlite3 module — no external ORM needed.
WAL mode is enabled for safe concurrent reads from the background pipeline thread.
"""
from __future__ import annotations
import logging
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

DB_PATH = Path(os.getenv("STORAGE_DIR", "./storage")) / "swingcoach.db"


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_db() -> None:
    """Create tables if they don't exist. Called once at app startup via lifespan."""
    try:
        DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        log.error("Cannot create DB directory %s: %s", DB_PATH.parent, exc)
        raise

    log.info("Initializing SQLite database at %s", DB_PATH)
    conn = _get_conn()
    try:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id            TEXT PRIMARY KEY,
                email         TEXT UNIQUE NOT NULL COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                created_at    TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS user_sessions (
                session_id        TEXT PRIMARY KEY,
                user_id           TEXT,
                pro_id            TEXT,
                status            TEXT DEFAULT 'uploaded',
                overall_score     REAL,
                compared_pro_name TEXT,
                thumbnail_url     TEXT,
                handedness        TEXT DEFAULT 'right',
                camera_angle      TEXT DEFAULT 'dtl',
                created_at        TEXT NOT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id)
            );
        """)
        conn.commit()

        # Schema migration: add columns that were added after the initial release.
        # ALTER TABLE ... ADD COLUMN is idempotent via the try/except below.
        migrations = [
            "ALTER TABLE user_sessions ADD COLUMN handedness  TEXT DEFAULT 'right'",
            "ALTER TABLE user_sessions ADD COLUMN camera_angle TEXT DEFAULT 'dtl'",
        ]
        for sql in migrations:
            try:
                conn.execute(sql)
                conn.commit()
                log.info("Migration applied: %s", sql)
            except Exception:
                pass  # Column already exists — safe to ignore

        log.info("Database tables ready.")
    except Exception as exc:
        log.error("init_db failed: %s", exc, exc_info=True)
        raise
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# User CRUD
# ---------------------------------------------------------------------------

def create_user(email: str, password_hash: str) -> Optional[Dict]:
    uid  = str(uuid.uuid4())
    now  = datetime.now(timezone.utc).isoformat()
    conn = _get_conn()
    try:
        conn.execute(
            "INSERT INTO users (id, email, password_hash, created_at) VALUES (?,?,?,?)",
            (uid, email.lower().strip(), password_hash, now),
        )
        conn.commit()
        log.info("Created user %s (%s)", uid, email)
        return {"id": uid, "email": email.lower().strip(), "created_at": now}
    except sqlite3.IntegrityError:
        log.info("Duplicate email signup attempt: %s", email)
        return None   # email already taken
    except Exception as exc:
        log.error("create_user DB error: %s", exc, exc_info=True)
        raise
    finally:
        conn.close()


def get_user_by_email(email: str) -> Optional[Dict]:
    conn = _get_conn()
    try:
        row = conn.execute(
            "SELECT * FROM users WHERE email = ?", (email.lower().strip(),)
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def get_user_by_id(user_id: str) -> Optional[Dict]:
    if not user_id:
        return None
    conn = _get_conn()
    try:
        row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# Session persistence
# ---------------------------------------------------------------------------

def upsert_session(
    session_id: str,
    user_id: Optional[str],
    pro_id: str,
    status: str,
    created_at: str,
    overall_score: Optional[float] = None,
    compared_pro_name: Optional[str] = None,
    thumbnail_url: Optional[str] = None,
    handedness: str = "right",
    camera_angle: str = "dtl",
) -> None:
    conn = _get_conn()
    try:
        conn.execute("""
            INSERT INTO user_sessions
                (session_id, user_id, pro_id, status, overall_score, compared_pro_name,
                 thumbnail_url, handedness, camera_angle, created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(session_id) DO UPDATE SET
                status            = excluded.status,
                overall_score     = excluded.overall_score,
                compared_pro_name = excluded.compared_pro_name,
                thumbnail_url     = excluded.thumbnail_url,
                user_id           = COALESCE(excluded.user_id, user_sessions.user_id)
        """, (session_id, user_id, pro_id, status, overall_score, compared_pro_name,
              thumbnail_url, handedness, camera_angle, created_at))
        conn.commit()
    except Exception as exc:
        log.error("upsert_session failed for %s: %s", session_id, exc, exc_info=True)
        raise   # propagate so endpoints know the save failed
    finally:
        conn.close()


def get_sessions_for_user(user_id: str) -> List[Dict]:
    conn = _get_conn()
    try:
        rows = conn.execute(
            "SELECT * FROM user_sessions WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()
