"""
GET /api/frames/{session_id}
GET /api/frames/{session_id}/phase-summary

FIX: `str | None` union syntax requires Python 3.10+.
     Replaced with `Optional[str]` for Python 3.8/3.9 compatibility.
     A syntax error here silently prevents the entire router from loading,
     causing all frame requests to return 404 with no error message.
"""
from __future__ import annotations
import logging
from typing import Optional

from fastapi import APIRouter, HTTPException

from api.session_manager import session_manager

log    = logging.getLogger(__name__)
router = APIRouter()


@router.get("/frames/{session_id}")
async def get_frames(session_id: str, phase: Optional[str] = None):
    """
    Returns every extracted frame for this session with full keypoint + deviation data.
    Optional ?phase=Impact filter returns frames for one swing phase only.
    """
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(status_code=404, detail="Session not found.")
    if status.status == "failed":
        raise HTTPException(status_code=422,
                            detail=f"Analysis failed: {status.error}")
    if status.status != "complete":
        raise HTTPException(status_code=202,
                            detail=f"Analysis is still running (stage: {status.status}).")

    try:
        analysis = session_manager.get_results(session_id)
    except Exception as exc:
        log.error("get_results failed for %s: %s", session_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Could not load results: {exc}")

    if not analysis:
        raise HTTPException(status_code=404, detail="Results not found on disk.")
    if not analysis.phases:
        raise HTTPException(status_code=404, detail="No phases found in analysis.")

    all_frames = []
    for swing_phase in analysis.phases:
        if phase and swing_phase.name != phase:
            continue
        for frame in swing_phase.frames:
            all_frames.append({
                "frame_index":    frame.frame_index,
                "timestamp":      frame.timestamp,
                "image_url":      frame.image_url,
                "phase":          frame.phase,
                "is_key_frame":   frame.is_key_frame,
                "keypoints":      {k: v.model_dump() for k, v in frame.keypoints.items()},
                "angles":         frame.angles.model_dump(),
                "deviation_from_pro": (
                    frame.deviation_from_pro.model_dump()
                    if frame.deviation_from_pro else None
                ),
            })

    all_frames.sort(key=lambda f: f["frame_index"])
    log.info("Returning %d frames for session %s", len(all_frames), session_id)
    return {"frames": all_frames, "total": len(all_frames)}


@router.get("/frames/{session_id}/phase-summary")
async def get_phase_summary(session_id: str):
    """
    Lightweight: one key frame per phase with average angles.
    Used by the Compare tab — avoids loading all 300 frames.
    """
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(status_code=404, detail="Session not found.")
    if status.status != "complete":
        raise HTTPException(status_code=202,
                            detail=f"Analysis not complete (stage: {status.status}).")

    analysis = session_manager.get_results(session_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Results not available.")

    summary = []
    for swing_phase in analysis.phases:
        kf = swing_phase.key_frame
        summary.append({
            "phase":             swing_phase.name,
            "score":             swing_phase.score.model_dump() if swing_phase.score else None,
            "avg_angles":        swing_phase.avg_angles.model_dump(),
            "avg_deviation_rms": swing_phase.avg_deviation_rms,
            "key_frame": {
                "frame_index":    kf.frame_index,
                "timestamp":      kf.timestamp,
                "image_url":      kf.image_url,
                "keypoints":      {k: v.model_dump() for k, v in kf.keypoints.items()},
                "angles":         kf.angles.model_dump(),
                "deviation_from_pro": (
                    kf.deviation_from_pro.model_dump()
                    if kf.deviation_from_pro else None
                ),
            } if kf else None,
        })

    return {"phases": summary, "pro_name": analysis.compared_pro_name}
