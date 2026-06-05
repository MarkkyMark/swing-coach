"""
Full analysis pipeline orchestrator.
Passes handedness, camera_angle, pro_id to the DTW phase detector.
"""
from __future__ import annotations
import logging
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from api.session_manager import session_manager
from models.schemas import SwingAnalysis
from services.frame_extraction import extract_frames
from services.feedback_service import generate_feedback
from services.pose_detection import detect_poses
from services.pro_comparison import compare_phases_to_pro, load_pro_catalog
from services.scoring_engine import score_all_phases
from services.swing_phase_detector import detect_phases

log = logging.getLogger(__name__)


def run_pipeline(session_id: str) -> None:
    session_dir    = session_manager.get_session_dir(session_id)
    pro_id         = session_manager.get_pro_id(session_id)
    handedness     = session_manager.get_handedness(session_id)
    camera_angle   = session_manager.get_camera_angle(session_id)
    video_rotation = session_manager.get_video_rotation(session_id)

    log.info(
        "[Pipeline] session=%s pro=%s hand=%s cam=%s rot=%d",
        session_id, pro_id, handedness, camera_angle, video_rotation,
    )

    video_path = _find_video(session_dir)
    if not video_path:
        session_manager.mark_failed(session_id, "Video file not found.")
        return

    try:
        # ── Stage 1: Frame extraction ──────────────────────────────────────
        _progress(session_id, "extracting", 0, "Extracting frames…")
        frames = extract_frames(
            video_path=      video_path,
            session_dir=     session_dir,
            manual_rotation= video_rotation,
            progress_cb=     lambda p: _progress(
                session_id, "extracting", p, f"Extracting frames ({int(p*100)}%)…"
            ),
        )
        if not frames:
            raise RuntimeError("No frames extracted from video.")
        _progress(session_id, "extracting", 1, f"Extracted {len(frames)} frames.")

        # ── Stage 2: Pose detection ────────────────────────────────────────
        _progress(session_id, "pose_detection", 0, "Detecting body pose…")
        frames = detect_poses(
            frames=      frames,
            progress_cb= lambda p: _progress(
                session_id, "pose_detection", p, f"Pose detection ({int(p*100)}%)…"
            ),
        )
        _progress(session_id, "pose_detection", 1, "Pose detection complete.")

        # ── Stage 3: Phase detection (DTW) ─────────────────────────────────
        _progress(session_id, "phase_detection", 0, "Aligning swing phases via DTW…")
        phases = detect_phases(
            frames=       frames,
            pro_id=       pro_id,
            handedness=   handedness,
            camera_angle= camera_angle,
        )
        method = phases[0].frames[0].phase if phases else "unknown"
        _progress(session_id, "phase_detection", 1,
                  f"Detected {len(phases)} phases.")

        # ── Stage 4: Pro comparison ────────────────────────────────────────
        _progress(session_id, "comparison", 0, "Comparing to pro reference…")
        phases = compare_phases_to_pro(phases, pro_id)
        _progress(session_id, "comparison", 1, "Comparison complete.")

        # ── Stage 5: Scoring ───────────────────────────────────────────────
        _progress(session_id, "scoring", 0, "Scoring phases…")
        phases, overall_score = score_all_phases(phases)
        _progress(session_id, "scoring", 1, f"Overall: {overall_score:.1f}/10")

        # ── Stage 6: AI Feedback ───────────────────────────────────────────
        _progress(session_id, "feedback", 0, "Generating coaching feedback…")
        catalog  = load_pro_catalog()
        pro_name = catalog.get(pro_id, {}).get("name", pro_id)

        analysis = SwingAnalysis(
            session_id=        session_id,
            video_url=         f"/sessions/{session_id}/video{video_path.suffix}",
            phases=            phases,
            overall_score=     overall_score,
            compared_pro_id=   pro_id,
            compared_pro_name= pro_name,
            created_at=        datetime.now(timezone.utc).isoformat(),
        )
        analysis = generate_feedback(analysis, pro_name)
        _progress(session_id, "feedback", 1, "Feedback generated.")

        session_manager.mark_complete(session_id, analysis)
        log.info("[Pipeline] Done: session=%s score=%.1f", session_id, overall_score)

    except Exception as exc:
        log.error("[Pipeline] FAILED %s:\n%s", session_id, traceback.format_exc())
        session_manager.mark_failed(session_id, str(exc))


def _progress(session_id: str, stage: str, p: float, msg: str = "") -> None:
    session_manager.update_progress(session_id, stage, p, msg)


def _find_video(session_dir: Path) -> Optional[Path]:
    for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
        p = session_dir / f"video{ext}"
        if p.exists():
            return p
    return None
