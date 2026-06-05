"""
Reference swing library endpoints.

GET  /api/library               → list all entries
POST /api/library/upload        → upload a new reference video
GET  /api/library/{id}          → get one entry's metadata
GET  /api/library/{id}/video    → stream the video file  ← extension-agnostic, /api-proxied
DELETE /api/library/{id}        → delete entry

WHY a dedicated /video endpoint instead of static file serving:
  The Vite dev server only proxies /api and /sessions to the FastAPI backend.
  Any URL that starts with /library would be served by Vite itself, returning 404.
  By routing video through /api/library/{id}/video we guarantee it's always
  proxied to FastAPI regardless of dev-server proxy config. This also makes the
  route extension-agnostic — the endpoint scans disk for whatever format was uploaded.
"""
from __future__ import annotations
import logging
import mimetypes
from pathlib import Path
from typing import Dict, List, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from models.library_schemas import LibraryEntry
from pydantic import BaseModel
from services.library_service import (
    add_entry, delete_entry, get_entry, get_video_path,
    get_phase_times, list_entries, save_phase_times, update_entry,
)

log    = logging.getLogger(__name__)
router = APIRouter(prefix="/library", tags=["Library"])

ALLOWED_EXTENSIONS = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MAX_VIDEO_MB = 500


@router.get("", response_model=List[LibraryEntry])
async def get_library(source: Optional[str] = None):
    """
    Return library entries.
    ?source=preloaded  → GolfDB pro swings only
    ?source=user       → user uploads only
    (omit)             → all entries
    """
    return list_entries(source=source)


VALID_GENDERS    = {"male", "female"}
VALID_CLUB_TYPES = {"driver", "irons", "wedges", "putter", "other"}


@router.post("/upload", response_model=LibraryEntry, status_code=201)
async def upload_reference(
    video:        UploadFile = File(...),
    name:         str        = Form(...),
    camera_angle: str        = Form(...),
    handedness:   str        = Form(...),
    gender:       str        = Form(default="male"),
    club_type:    str        = Form(default="driver"),
    description:  str        = Form(default=""),
    tags:         str        = Form(default=""),
):
    if handedness   not in ("right", "left"):
        raise HTTPException(422, "handedness must be 'right' or 'left'")
    if camera_angle not in ("dtl", "face_on"):
        raise HTTPException(422, "camera_angle must be 'dtl' or 'face_on'")
    if gender    not in VALID_GENDERS:    gender    = "male"
    if club_type not in VALID_CLUB_TYPES: club_type = "driver"

    ext = Path(video.filename or "video.mp4").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(422, f"Unsupported format '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    video_bytes = await video.read()
    if len(video_bytes) / 1_000_000 > MAX_VIDEO_MB:
        raise HTTPException(413, f"Video exceeds {MAX_VIDEO_MB} MB limit.")

    tag_list = [t.strip() for t in tags.split(",") if t.strip()]

    try:
        entry = add_entry(
            name=         name,
            camera_angle= camera_angle,
            handedness=   handedness,
            gender=       gender,
            club_type=    club_type,
            video_bytes=  video_bytes,
            filename=     video.filename or "video.mp4",
            description=  description,
            tags=         tag_list,
        )
    except Exception as exc:
        log.error("Library upload failed: %s", exc, exc_info=True)
        raise HTTPException(500, f"Failed to save reference: {exc}")

    return entry


@router.get("/{entry_id}/video")
async def stream_library_video(entry_id: str):
    """
    Stream the reference video file through the /api prefix.
    Supports HTTP range requests (needed for video seeking in browsers).
    Extension-agnostic: scans disk for .mp4 / .mov / .avi / etc.
    """
    path = get_video_path(entry_id)
    if not path or not path.exists():
        raise HTTPException(404, f"Video file for library entry '{entry_id}' not found.")

    # Detect correct MIME type from actual file extension
    mime, _ = mimetypes.guess_type(str(path))
    media_type = mime or "video/mp4"

    log.debug("Streaming library video: %s (%s)", path.name, media_type)
    return FileResponse(str(path), media_type=media_type)


@router.get("/{entry_id}", response_model=LibraryEntry)
async def get_library_entry(entry_id: str):
    entry = get_entry(entry_id)
    if not entry:
        raise HTTPException(404, f"Library entry '{entry_id}' not found.")
    return entry


@router.patch("/{entry_id}", response_model=LibraryEntry)
async def edit_library_entry(entry_id: str, body: dict):
    """Update editable fields (name, camera_angle, handedness, gender, club_type, description)."""
    updated = update_entry(entry_id, body)
    if not updated:
        raise HTTPException(404, f"Library entry '{entry_id}' not found.")
    return updated


@router.delete("/{entry_id}", status_code=204)
async def delete_library_entry(entry_id: str):
    if not delete_entry(entry_id):
        raise HTTPException(404, f"Library entry '{entry_id}' not found.")


# ---------------------------------------------------------------------------
# Phase times — saved reference phase points
# ---------------------------------------------------------------------------

class PhaseTimesBody(BaseModel):
    phase_times: Dict[str, float]


@router.get("/{entry_id}/phases")
async def get_library_phase_times(entry_id: str):
    """Return saved phase timestamps for this reference swing."""
    times = get_phase_times(entry_id)
    return {"entry_id": entry_id, "phase_times": times, "count": len(times)}


@router.post("/{entry_id}/phases")
async def save_library_phase_times(entry_id: str, body: PhaseTimesBody):
    """Persist phase timestamp assignments for a reference swing."""
    ok = save_phase_times(entry_id, body.phase_times)
    if not ok:
        raise HTTPException(404, f"Library entry '{entry_id}' not found.")
    return {"status": "saved", "count": len(body.phase_times)}
