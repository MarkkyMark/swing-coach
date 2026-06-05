"""
JWT and password hashing utilities.

FIX: passlib 1.7.4 is incompatible with bcrypt ≥4.0 (bcrypt removed
     __about__ in a major API break). We now call bcrypt directly,
     which works correctly on all versions.
"""
from __future__ import annotations
import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Optional

log = logging.getLogger(__name__)

SECRET_KEY        = os.getenv("JWT_SECRET_KEY", "swing-coach-secret-change-me-in-production")
ALGORITHM         = "HS256"
TOKEN_EXPIRE_DAYS = 7

_BCRYPT_ERROR: Optional[str] = None

# ---------------------------------------------------------------------------
# Verify bcrypt works at import time (surfaces errors before first request)
# ---------------------------------------------------------------------------
try:
    import bcrypt as _bcrypt_lib
    _test = _bcrypt_lib.hashpw(b"__test__", _bcrypt_lib.gensalt(4))
    assert _bcrypt_lib.checkpw(b"__test__", _test)
    log.info("bcrypt: OK (v%s)", getattr(_bcrypt_lib, "__version__", "?"))
except Exception as exc:
    _BCRYPT_ERROR = (
        f"bcrypt not working: {exc}. "
        "Run: pip install --force-reinstall bcrypt"
    )
    log.error("bcrypt UNAVAILABLE — %s", _BCRYPT_ERROR)


def health_check() -> None:
    if _BCRYPT_ERROR:
        raise RuntimeError(_BCRYPT_ERROR)


# ---------------------------------------------------------------------------
# Password hashing — direct bcrypt (no passlib wrapper)
# ---------------------------------------------------------------------------

def hash_password(plain: str) -> str:
    if _BCRYPT_ERROR:
        raise RuntimeError(_BCRYPT_ERROR)
    import bcrypt
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(12)).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    if _BCRYPT_ERROR:
        raise RuntimeError(_BCRYPT_ERROR)
    try:
        import bcrypt
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception as exc:
        log.warning("verify_password error: %s", exc)
        return False


# ---------------------------------------------------------------------------
# JWT
# ---------------------------------------------------------------------------

def create_token(user_id: str, email: str) -> str:
    try:
        from jose import jwt
    except ImportError as exc:
        raise RuntimeError(f"python-jose not installed: {exc}") from exc
    expire  = datetime.now(timezone.utc) + timedelta(days=TOKEN_EXPIRE_DAYS)
    payload = {"sub": user_id, "email": email, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        from jose import JWTError, jwt
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except Exception:
        return None
