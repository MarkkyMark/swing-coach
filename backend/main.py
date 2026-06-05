"""
FastAPI application entry point.
"""
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
)

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from api.routes import process, results, upload
from api.routes import frames as frames_router
from api.routes import library as library_router
from api.routes import frame_selection as frame_selection_router
from api.routes import admin as admin_router
from auth.routes import router as auth_router
from auth.db import init_db

load_dotenv()

STORAGE_DIR  = Path(os.getenv("STORAGE_DIR", "./storage"))
DATA_DIR     = Path(__file__).parent / "data"
CORS_ORIGINS = os.getenv(
    "CORS_ORIGINS", "http://localhost:5173,http://localhost:3000"
).split(",")

log = logging.getLogger(__name__)


def _validate_dependencies() -> None:
    from auth.utils import health_check
    try:
        health_check()
        log.info("✓ bcrypt OK")
    except RuntimeError as exc:
        log.error("✗ bcrypt FAILED: %s", exc)
        log.error("  Fix: pip install --force-reinstall bcrypt passlib[bcrypt]")
    try:
        from jose import jwt as _jwt
        log.info("✓ python-jose OK")
    except ImportError as exc:
        log.error("✗ python-jose MISSING: %s", exc)
    try:
        import numpy as np; _ = np.array([1.0])
        log.info("✓ numpy OK")
    except ImportError as exc:
        log.error("✗ numpy MISSING: %s", exc)
    try:
        import mediapipe as mp
        log.info("✓ mediapipe OK")
    except ImportError as exc:
        log.warning("✗ mediapipe MISSING: %s", exc)

    # 5. ffmpeg — required for H.264 transcoding of uploaded videos
    import shutil as _shutil
    if _shutil.which("ffmpeg"):
        log.info("✓ ffmpeg OK")
    else:
        log.warning(
            "✗ ffmpeg NOT FOUND — uploaded videos with H.265/ProRes/VP9 codec "
            "will not play in browsers until transcoded. "
            "Install: brew install ffmpeg   OR   apt install ffmpeg"
        )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _validate_dependencies()
    init_db()

    # Ensure library directory exists
    from services.library_service import ensure_library_dir
    ensure_library_dir()

    # Retroactively transcode any library videos that weren't H.264 yet
    # (catches entries uploaded before transcoding was added)
    try:
        from services.video_converter import transcode_existing_library
        transcode_existing_library()
    except Exception as exc:
        log.warning("Startup library transcode skipped: %s", exc)

    # Warm DTW reference cache
    try:
        from services.reference_swings import preload_all_references
        preload_all_references()
    except Exception as exc:
        log.warning("Could not preload DTW references: %s", exc)

    yield


app = FastAPI(
    title="Swing Coach API",
    description="Golf swing biomechanical analysis — manual + AI-assisted",
    version="3.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static file mounts ─────────────────────────────────────────────────────

# User session files (frames, comparison images, videos)
sessions_dir = STORAGE_DIR / "sessions"
sessions_dir.mkdir(parents=True, exist_ok=True)
app.mount("/sessions", StaticFiles(directory=str(sessions_dir)), name="sessions")

# Reference library videos + thumbnails
library_dir = DATA_DIR / "library"
library_dir.mkdir(parents=True, exist_ok=True)
app.mount("/library", StaticFiles(directory=str(library_dir)), name="library")

# ── API Routers ─────────────────────────────────────────────────────────────

app.include_router(auth_router,                       prefix="/api", tags=["Auth"])
app.include_router(upload.router,                     prefix="/api", tags=["Upload"])
app.include_router(process.router,                    prefix="/api", tags=["Processing"])
app.include_router(results.router,                    prefix="/api", tags=["Results"])
app.include_router(frames_router.router,              prefix="/api", tags=["Frames"])
app.include_router(library_router.router,             prefix="/api", tags=["Library"])
app.include_router(frame_selection_router.router,     prefix="/api", tags=["Frame Selection"])
app.include_router(admin_router.router,               prefix="/api", tags=["Admin"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "swing-coach-api", "version": "3.0.0"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
