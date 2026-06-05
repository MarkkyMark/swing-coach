"""
Admin / maintenance endpoints.

POST /api/admin/retranscode-library
  Re-encodes all library videos to H.264 using ffmpeg.
  Useful after installing ffmpeg if videos were uploaded before it was available.
"""
from __future__ import annotations
import logging

from fastapi import APIRouter, BackgroundTasks, HTTPException

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/admin", tags=["Admin"])


@router.post("/retranscode-library")
async def retranscode_library(background_tasks: BackgroundTasks):
    """
    Re-encode all library videos to browser-safe H.264/AAC.
    Run this after installing ffmpeg if videos were uploaded before it was available.
    """
    from services.video_converter import ffmpeg_available
    if not ffmpeg_available():
        raise HTTPException(
            status_code=503,
            detail=(
                "ffmpeg is not installed. "
                "Install it first:  brew install ffmpeg  (macOS)  "
                "or  apt install ffmpeg  (Linux/Debian)."
            ),
        )

    background_tasks.add_task(_do_retranscode)
    return {"status": "started", "message": "Library retranscode running in background. Check server logs."}


def _do_retranscode():
    from services.video_converter import transcode_existing_library
    log.info("Manual library retranscode triggered via API.")
    transcode_existing_library()
    log.info("Manual library retranscode complete.")


@router.get("/ffmpeg-status")
async def ffmpeg_status():
    """Check whether ffmpeg is installed and usable."""
    from services.video_converter import ffmpeg_available
    import shutil
    path = shutil.which("ffmpeg")
    ok   = ffmpeg_available()
    return {
        "available": ok,
        "path":      path,
        "message":   (
            "ffmpeg is ready — all uploaded videos will be transcoded to H.264."
            if ok else
            "ffmpeg not found. Install with: brew install ffmpeg (macOS) or apt install ffmpeg (Linux). "
            "Then POST /api/admin/retranscode-library to fix existing entries."
        ),
    }
