"""
Reference swing library — persistent, file-based storage.

Library structure on disk:
  data/library/
    library.json           ← catalog of all entries
    {entry_id}/
      video.mp4            ← the reference video
      thumb.jpg            ← optional thumbnail (first frame)
      frames/              ← optional pre-extracted frames

Thread safety: a module-level threading.Lock protects all JSON reads/writes.
This is sufficient for a single-process deployment.
"""
from __future__ import annotations
import json
import logging
import os
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

import cv2

from models.library_schemas import LibraryCatalog, LibraryEntry

log = logging.getLogger(__name__)

LIBRARY_DIR   = Path(os.getenv("STORAGE_DIR", "./storage")).parent / "data" / "library"
LIBRARY_JSON  = LIBRARY_DIR / "library.json"
_lock         = threading.Lock()


# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------

def ensure_library_dir() -> None:
    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    if not LIBRARY_JSON.exists():
        LIBRARY_JSON.write_text('{"entries":[]}')
    log.info("Library directory: %s", LIBRARY_DIR)


# ---------------------------------------------------------------------------
# Read / Write catalog
# ---------------------------------------------------------------------------

def _read() -> LibraryCatalog:
    try:
        return LibraryCatalog.model_validate_json(LIBRARY_JSON.read_text())
    except Exception:
        return LibraryCatalog()


def _write(catalog: LibraryCatalog) -> None:
    LIBRARY_JSON.write_text(catalog.model_dump_json(indent=2))


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def list_entries(source: Optional[str] = None) -> List[LibraryEntry]:
    """
    Return all library entries, optionally filtered by source.
    source="preloaded" → GolfDB imports only
    source="user"      → user uploads only
    source=None        → everything
    """
    with _lock:
        catalog  = _read()
        migrated = False
        for i, entry in enumerate(catalog.entries):
            if not entry.video_url.startswith("/api/"):
                catalog.entries[i] = entry.model_copy(
                    update={"video_url": f"/api/library/{entry.id}/video"}
                )
                migrated = True
        if migrated:
            _write(catalog)
        entries = catalog.entries

    if source:
        entries = [e for e in entries if e.source == source]
    return entries


def get_entry(entry_id: str) -> Optional[LibraryEntry]:
    with _lock:
        for e in _read().entries:
            if e.id == entry_id:
                return e
    return None


def add_entry_from_disk(
    source_video_path: Path,
    name: str,
    camera_angle: str,
    handedness: str,
    gender: str = "male",
    club_type: str = "driver",
    description: str = "",
    tags: List[str] = [],
    phase_times: Dict[str, float] = {},
    source: str = "preloaded",
    transcode: bool = True,
) -> Optional[LibraryEntry]:
    """
    Import a video from an on-disk path (used by the GolfDB bulk import script).
    Copies the file into the library directory — original is left untouched.
    Phase times can be pre-populated from CSV event data.
    """
    import shutil as _shutil

    entry_id  = str(uuid.uuid4())[:8]
    entry_dir = LIBRARY_DIR / entry_id
    entry_dir.mkdir(parents=True, exist_ok=True)

    ext        = source_video_path.suffix.lower() or ".mp4"
    video_path = entry_dir / f"video{ext}"
    _shutil.copy2(str(source_video_path), str(video_path))

    if transcode:
        from services.video_converter import transcode_to_h264
        video_path = transcode_to_h264(video_path)

    duration, fps = _probe_video(video_path)
    thumb_url     = _extract_thumbnail(video_path, entry_dir / "thumb.jpg", entry_id)

    entry = LibraryEntry(
        id=           entry_id,
        name=         name.strip(),
        camera_angle= camera_angle,
        handedness=   handedness,
        gender=       gender,
        club_type=    club_type,
        tags=         tags,
        video_url=    f"/api/library/{entry_id}/video",
        thumbnail_url=thumb_url,
        duration=     duration,
        fps=          fps,
        description=  description,
        created_at=   datetime.now(timezone.utc).isoformat(),
        phase_times=  dict(phase_times),
        source=       source,
    )

    with _lock:
        catalog = _read()
        catalog.entries.append(entry)
        _write(catalog)

    log.info("Imported %s from disk as library entry %s", source_video_path.name, entry_id)
    return entry


def update_entry(entry_id: str, updates: dict) -> Optional[LibraryEntry]:
    """Update editable metadata fields of a library entry."""
    EDITABLE = {"name", "camera_angle", "handedness", "gender", "club_type", "description", "tags"}
    safe_updates = {k: v for k, v in updates.items() if k in EDITABLE}
    with _lock:
        catalog = _read()
        for i, entry in enumerate(catalog.entries):
            if entry.id == entry_id:
                catalog.entries[i] = entry.model_copy(update=safe_updates)
                _write(catalog)
                log.info("Updated library entry %s: %s", entry_id, list(safe_updates.keys()))
                return catalog.entries[i]
    return None


def save_phase_times(entry_id: str, times: Dict[str, float]) -> bool:
    """
    Persist phase timestamp assignments for a reference swing.
    Called automatically after every comparison so users don't
    have to re-select reference phase points next time.
    """
    with _lock:
        catalog = _read()
        for i, entry in enumerate(catalog.entries):
            if entry.id == entry_id:
                catalog.entries[i] = entry.model_copy(update={"phase_times": times})
                _write(catalog)
                log.info("Saved %d phase times for library entry %s", len(times), entry_id)
                return True
    return False


def get_phase_times(entry_id: str) -> Dict[str, float]:
    """Return saved phase timestamps for a library entry, or {} if none."""
    entry = get_entry(entry_id)
    if entry:
        return entry.phase_times
    return {}


def add_entry(
    name:         str,
    camera_angle: str,
    handedness:   str,
    video_bytes:  bytes,
    filename:     str,
    gender:       str = "male",
    club_type:    str = "driver",
    description:  str = "",
    tags:         List[str] = [],
    source:       str = "user",
) -> LibraryEntry:
    """Save a new reference video and register it in the catalog."""
    entry_id  = str(uuid.uuid4())[:8]
    entry_dir = LIBRARY_DIR / entry_id
    entry_dir.mkdir(parents=True, exist_ok=True)

    # Save raw upload
    ext        = Path(filename).suffix.lower() or ".mp4"
    video_path = entry_dir / f"video{ext}"
    video_path.write_bytes(video_bytes)

    # Transcode to H.264/AAC/yuv420p with faststart.
    # Uses imageio-ffmpeg bundled binary — no system install required.
    from services.video_converter import transcode_to_h264
    video_path = transcode_to_h264(video_path)

    # Extract metadata + thumbnail from the (possibly transcoded) file
    duration, fps = _probe_video(video_path)
    thumb_url     = _extract_thumbnail(video_path, entry_dir / "thumb.jpg", entry_id)

    entry = LibraryEntry(
        id=           entry_id,
        name=         name.strip(),
        camera_angle= camera_angle,
        handedness=   handedness,
        gender=       gender,
        club_type=    club_type,
        tags=         tags,
        video_url=    f"/api/library/{entry_id}/video",
        thumbnail_url=thumb_url,
        duration=     duration,
        fps=          fps,
        description=  description,
        created_at=   datetime.now(timezone.utc).isoformat(),
        source=       source,
    )

    with _lock:
        catalog = _read()
        catalog.entries.append(entry)
        _write(catalog)

    log.info("Library: added entry %s (%s)", entry_id, name)
    return entry


def delete_entry(entry_id: str) -> bool:
    with _lock:
        catalog = _read()
        before  = len(catalog.entries)
        catalog.entries = [e for e in catalog.entries if e.id != entry_id]
        if len(catalog.entries) == before:
            return False
        _write(catalog)

    # Remove files
    import shutil
    entry_dir = LIBRARY_DIR / entry_id
    if entry_dir.exists():
        shutil.rmtree(entry_dir)
    log.info("Library: deleted entry %s", entry_id)
    return True


def get_video_path(entry_id: str) -> Optional[Path]:
    """Return the absolute path to the reference video file."""
    entry = get_entry(entry_id)
    if not entry:
        return None
    entry_dir = LIBRARY_DIR / entry_id
    for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
        p = entry_dir / f"video{ext}"
        if p.exists():
            return p
    return None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _probe_video(path: Path):
    try:
        cap = cv2.VideoCapture(str(path))
        fps   = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
        cap.release()
        return round(total / fps, 2) if fps else None, round(fps, 2)
    except Exception:
        return None, None


def _extract_thumbnail(video_path: Path, thumb_path: Path, entry_id: str) -> Optional[str]:
    try:
        cap = cv2.VideoCapture(str(video_path))
        ret, frame = cap.read()
        cap.release()
        if ret:
            cv2.imwrite(str(thumb_path), frame)
            return f"/library/{entry_id}/thumb.jpg"
    except Exception as e:
        log.warning("Thumbnail extraction failed: %s", e)
    return None
