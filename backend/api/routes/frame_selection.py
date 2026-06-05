"""
Frame selection and phase-aligned comparison endpoints.

POST /api/sessions/{id}/frame-selection    → save frame time assignments
GET  /api/sessions/{id}/frame-selection    → retrieve saved assignments
POST /api/sessions/{id}/compare            → run comparison on selected frames
GET  /api/sessions/{id}/comparison         → retrieve comparison result
"""
from __future__ import annotations
import logging
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException

from api.session_manager import session_manager
from auth.routes import get_current_user, require_user
from models.library_schemas import FrameSelectionData, FrameSelectionRequest, SwingComparisonResult
from services.frame_comparison import load_comparison, run_comparison

log    = logging.getLogger(__name__)
router = APIRouter(tags=["Frame Selection"])


# ---------------------------------------------------------------------------
# Frame selection CRUD
# ---------------------------------------------------------------------------

@router.get("/sessions/{session_id}/info")
async def get_session_info(session_id: str):
    """
    Lightweight info endpoint used by FrameSelectionPage on mount.
    Returns the video URL (with real extension) so the page doesn't
    need to guess or rely on URL params that may be lost on refresh.
    """
    video_url = session_manager.get_video_url(session_id)
    if not video_url:
        # Session may have been created but video not yet saved — check disk
        session_dir = session_manager.get_session_dir(session_id)
        if not session_dir.exists():
            raise HTTPException(404, "Session not found.")
        video_url = None  # video not ready yet

    return {
        "session_id":   session_id,
        "video_url":    video_url,
        "handedness":   session_manager.get_handedness(session_id),
        "camera_angle": session_manager.get_camera_angle(session_id),
        "pro_id":       session_manager.get_pro_id(session_id),
    }


@router.post("/sessions/{session_id}/frame-selection")
async def save_frame_selection(session_id: str, body: FrameSelectionRequest):
    """Save the user's frame time assignments for both videos."""
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(404, "Session not found.")

    selection = FrameSelectionData(
        session_id=      session_id,
        reference_id=    body.reference_id,
        user_times=      body.user_times,
        reference_times= body.reference_times,
        handedness=      body.handedness,
        camera_angle=    body.camera_angle,
        gender=          body.gender,
        club_type=       body.club_type,
    )
    session_manager.set_frame_selection(session_id, selection)
    log.info("Frame selection saved: session=%s user=%d/8 ref=%d/8",
             session_id, len(body.user_times), len(body.reference_times))
    return {
        "status":               "saved",
        "user_phases_set":      len(body.user_times),
        "reference_phases_set": len(body.reference_times),
        "is_complete":          selection.is_complete,
    }


@router.get("/sessions/{session_id}/frame-selection")
async def get_frame_selection(session_id: str):
    """Retrieve the current frame selection for a session."""
    sel = session_manager.get_frame_selection(session_id)
    if not sel:
        return FrameSelectionData(session_id=session_id)
    return sel


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------

@router.post("/sessions/{session_id}/compare")
async def start_comparison(session_id: str, background_tasks: BackgroundTasks):
    """
    Trigger phase-aligned comparison analysis.
    Runs synchronously (only 16 frames) but dispatched as a background task
    so the HTTP response returns immediately.
    """
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(404, "Session not found.")

    sel = session_manager.get_frame_selection(session_id)
    if not sel:
        raise HTTPException(422, "No frame selection found. Set frame times first.")
    if not sel.user_complete:
        missing = 8 - len(sel.user_times)
        raise HTTPException(422, f"User swing is missing {missing} phase assignment(s).")

    # Find user video path
    session_dir = session_manager.get_session_dir(session_id)
    user_video  = _find_video(session_dir)
    if not user_video:
        raise HTTPException(422, "User video file not found.")

    # Delete any stale comparison.json from a previous run so polling
    # doesn't immediately return an empty/outdated result.
    stale = session_manager.get_session_dir(session_id) / "comparison" / "comparison.json"
    if stale.exists():
        stale.unlink()
        log.info("Deleted stale comparison.json for session %s", session_id)

    # Also clear from in-memory store so get_comparison polls properly
    with session_manager._lock:
        if session_id in session_manager._sessions:
            session_manager._sessions[session_id].pop("comparison_result", None)

    session_manager.update_progress(session_id, "comparison", 0.0, "Running phase comparison…")
    background_tasks.add_task(_run_comparison_bg, session_id, sel, user_video)
    return {"status": "analyzing", "session_id": session_id}


@router.get("/sessions/{session_id}/comparison", response_model=SwingComparisonResult)
async def get_comparison(session_id: str):
    """
    Retrieve the comparison result once complete.
    Returns 202 if still running or if the result has no phases.
    A zero-phase result means a previous failed/empty run — treat as not-ready.
    """
    # Check in-memory first (same phase-count guard as disk path)
    result = session_manager.get_comparison_result(session_id)
    if result and len(result.phases) > 0:
        return result
    if result and len(result.phases) == 0:
        # Stale empty in-memory result — clear it and fall through to status check
        session_manager.set_comparison_result(session_id, None)  # evict

    # Try disk — but only accept results with actual phase data
    result = load_comparison(session_id)
    if result and len(result.phases) > 0:
        session_manager.set_comparison_result(session_id, result)
        return result

    # Check if still analyzing
    status = session_manager.get_status(session_id)
    if status and status.status == "comparison":
        raise HTTPException(202, "Comparison still running.")

    raise HTTPException(404, "Comparison not found. Run POST /sessions/{id}/compare first.")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

@router.delete("/sessions/{session_id}/save")
async def delete_session_from_my_swings(
    session_id:   str,
    current_user: dict = Depends(require_user),
):
    """Remove a saved swing from the user's My Swings."""
    try:
        from auth.db import _get_conn
        conn = _get_conn()
        conn.execute(
            "DELETE FROM user_sessions WHERE session_id = ? AND user_id = ?",
            (session_id, current_user["id"]),
        )
        conn.commit()
        conn.close()
        log.info("Session %s removed from My Swings by user %s", session_id, current_user["id"])
        return {"status": "deleted"}
    except Exception as exc:
        log.error("Delete failed for session %s: %s", session_id, exc, exc_info=True)
        raise HTTPException(500, f"Could not delete session: {exc}")


@router.post("/sessions/{session_id}/save")
async def save_session_to_my_swings(
    session_id:   str,
    current_user: dict = Depends(require_user),
):
    """
    Explicitly save a completed comparison to the authenticated user's My Swings.
    Works even if the user wasn't logged in during the original upload,
    or arrived at the comparison page via a direct link.
    """
    comparison = session_manager.get_comparison_result(session_id)
    if not comparison:
        comparison = load_comparison(session_id)
    if not comparison:
        raise HTTPException(404, "No comparison found. Run the comparison first.")

    thumbnail_url = None
    for pd in comparison.phases.values():
        if pd.user.frame_url:
            thumbnail_url = pd.user.frame_url
            break

    try:
        from auth.db import upsert_session
        created_at = session_manager.get_created_at(session_id) or comparison.created_at
        upsert_session(
            session_id=        session_id,
            user_id=           current_user["id"],
            pro_id=            comparison.reference_id or "manual",
            status=            "complete",
            created_at=        created_at,
            overall_score=     comparison.overall_score,
            compared_pro_name= comparison.reference_name,
            thumbnail_url=     thumbnail_url,
        )
        # Also update the in-memory session's user_id so future auto-saves work
        if session_id in session_manager._sessions:
            session_manager._sessions[session_id]["user_id"] = current_user["id"]

        log.info("Session %s saved to My Swings by user %s", session_id, current_user["id"])
        return {"status": "saved", "session_id": session_id}
    except Exception as exc:
        log.error("Save failed for session %s: %s", session_id, exc, exc_info=True)
        raise HTTPException(500, f"Could not save session: {exc}")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _run_comparison_bg(session_id: str, selection: FrameSelectionData, user_video: Path):
    try:
        result = run_comparison(session_id, selection, user_video)
        session_manager.set_comparison_result(session_id, result)
        session_manager.update_progress(session_id, "complete", 1.0, "Comparison complete!")
    except Exception as exc:
        import traceback
        log.error("Comparison failed for %s:\n%s", session_id, traceback.format_exc())
        session_manager.mark_failed(session_id, str(exc))


def _find_video(session_dir: Path) -> Optional[Path]:
    for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
        p = session_dir / f"video{ext}"
        if p.exists():
            return p
    return None
