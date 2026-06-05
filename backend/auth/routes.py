"""
Auth routes: signup, login, me, my-swings.

FIX: Removed unused `EmailStr` import — it required email-validator which
was missing from requirements.txt, causing an ImportError on first request
that surfaced to the frontend as a generic "Sign-up failed" message.
"""
from __future__ import annotations
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

from auth.db import (
    create_user, get_sessions_for_user,
    get_user_by_email, get_user_by_id,
)
from auth.utils import create_token, decode_token, hash_password, verify_password
from models.schemas import UserSessionSummary

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["Auth"])
bearer = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# JWT dependency helpers
# ---------------------------------------------------------------------------

def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer),
) -> Optional[dict]:
    if not creds:
        return None
    try:
        payload = decode_token(creds.credentials)
    except Exception as exc:
        log.warning("Token decode failed: %s", exc)
        return None
    if not payload:
        return None
    return get_user_by_id(payload.get("sub", ""))


def require_user(user: Optional[dict] = Depends(get_current_user)) -> dict:
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


# ---------------------------------------------------------------------------
# Request / Response models
# ---------------------------------------------------------------------------

class SignupRequest(BaseModel):
    email: str
    password: str

class LoginRequest(BaseModel):
    email: str
    password: str

class AuthResponse(BaseModel):
    token:   str
    user_id: str
    email:   str


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@router.post("/signup", response_model=AuthResponse, status_code=201)
def signup(body: SignupRequest):
    email    = body.email.strip().lower()
    password = body.password

    # Validate inputs before touching the DB or bcrypt
    if not email or "@" not in email:
        raise HTTPException(status_code=422, detail="Please enter a valid email address.")
    if len(password) < 8:
        raise HTTPException(status_code=422, detail="Password must be at least 8 characters.")

    try:
        pw_hash = hash_password(password)
    except Exception as exc:
        log.error("bcrypt hash failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500,
                            detail="Password hashing failed. Check that bcrypt is installed.")

    try:
        user = create_user(email, pw_hash)
    except Exception as exc:
        log.error("create_user failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500,
                            detail=f"Database error during signup: {exc}")

    if not user:
        raise HTTPException(status_code=409,
                            detail="An account with that email already exists.")

    try:
        token = create_token(user["id"], user["email"])
    except Exception as exc:
        log.error("JWT creation failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Token creation failed: {exc}")

    return AuthResponse(token=token, user_id=user["id"], email=user["email"])


@router.post("/login", response_model=AuthResponse)
def login(body: LoginRequest):
    email = body.email.strip().lower()

    try:
        user = get_user_by_email(email)
    except Exception as exc:
        log.error("DB lookup failed during login: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Database error: {exc}")

    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    try:
        ok = verify_password(body.password, user["password_hash"])
    except Exception as exc:
        log.error("Password verification failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Password verification error: {exc}")

    if not ok:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    token = create_token(user["id"], user["email"])
    return AuthResponse(token=token, user_id=user["id"], email=user["email"])


@router.get("/me")
def me(user: dict = Depends(require_user)):
    return {"user_id": user["id"], "email": user["email"], "created_at": user["created_at"]}


@router.get("/sessions", response_model=List[UserSessionSummary])
def my_sessions(user: dict = Depends(require_user)):
    try:
        rows = get_sessions_for_user(user["id"])
    except Exception as exc:
        log.error("get_sessions_for_user failed: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not load sessions: {exc}")

    return [
        UserSessionSummary(
            session_id=        r["session_id"],
            overall_score=     r.get("overall_score"),
            compared_pro_name= r.get("compared_pro_name"),
            created_at=        r["created_at"],
            status=            r["status"],
            thumbnail_url=     r.get("thumbnail_url"),
        )
        for r in rows
    ]
