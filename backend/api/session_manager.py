"""
Thread-safe session registry.
Stores per-session metadata (handedness, camera_angle) used by the pipeline.
"""
from __future__ import annotations
import logging
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional

from models.schemas import ProgressEvent, SessionStatus, SwingAnalysis, UserSessionSummary

log = logging.getLogger(__name__)

STORAGE_DIR = Path("./storage/sessions")

STAGE_OVERALL_WEIGHTS = {
    "extracting":     (0.00, 0.30),
    "pose_detection": (0.30, 0.65),
    "phase_detection":(0.65, 0.70),
    "comparison":     (0.70, 0.75),
    "scoring":        (0.75, 0.80),
    "feedback":       (0.80, 1.00),
    "complete":       (1.00, 1.00),
    "failed":         (0.00, 0.00),
}


class SessionManager:

    def __init__(self):
        self._lock:     threading.RLock = threading.RLock()
        self._sessions: Dict[str, dict] = {}
        STORAGE_DIR.mkdir(parents=True, exist_ok=True)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def create_session(
        self,
        pro_id:         str           = "tiger_2000",
        user_id:        Optional[str] = None,
        handedness:     str           = "right",
        camera_angle:   str           = "dtl",
        video_rotation: int           = 0,     # 0 | 90 | 180 | 270
    ) -> str:
        session_id  = str(uuid.uuid4())
        session_dir = STORAGE_DIR / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        created_at  = datetime.now(timezone.utc).isoformat()

        with self._lock:
            self._sessions[session_id] = {
                "id":             session_id,
                "user_id":        user_id,
                "status":         "uploaded",
                "pro_id":         pro_id,
                "handedness":     handedness,
                "camera_angle":   camera_angle,
                "video_rotation": video_rotation,
                "created_at":     created_at,
                "progress":       None,
                "results":        None,
                "error":          None,
            }

        try:
            from auth.db import upsert_session
            upsert_session(
                session_id=   session_id,
                user_id=      user_id,
                pro_id=       pro_id,
                status=       "uploaded",
                created_at=   created_at,
                handedness=   handedness,
                camera_angle= camera_angle,
            )
        except Exception as exc:
            log.warning("Could not persist session to DB: %s", exc)

        return session_id

    def get_session_dir(self, session_id: str) -> Path:
        return STORAGE_DIR / session_id

    def get_status(self, session_id: str) -> Optional[SessionStatus]:
        with self._lock:
            s = self._sessions.get(session_id)
        if not s:
            return self._recover_status(session_id)
        return SessionStatus(
            session_id=s["id"],
            status=    s["status"],
            progress=  s.get("progress"),
            error=     s.get("error"),
        )

    def _recover_status(self, session_id: str) -> Optional[SessionStatus]:
        result_path = STORAGE_DIR / session_id / "analysis.json"
        if result_path.exists():
            return SessionStatus(session_id=session_id, status="complete")
        return None

    # ------------------------------------------------------------------
    # Progress updates (called from background pipeline thread)
    # ------------------------------------------------------------------

    def update_progress(
        self,
        session_id:    str,
        stage:         str,
        stage_progress: float,
        message:       str = "",
    ) -> None:
        start, end = STAGE_OVERALL_WEIGHTS.get(stage, (0.0, 0.0))
        overall    = start + (end - start) * stage_progress
        event      = ProgressEvent(
            stage=           stage,
            stage_progress=  round(stage_progress, 4),
            overall_progress=round(overall, 4),
            message=         message,
        )
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["progress"] = event
                self._sessions[session_id]["status"]   = stage

    def mark_complete(self, session_id: str, analysis: SwingAnalysis) -> None:
        result_path = self.get_session_dir(session_id) / "analysis.json"
        result_path.write_text(analysis.model_dump_json(indent=2))

        thumbnail_url = analysis.key_frames[0].image_url if analysis.key_frames else None

        with self._lock:
            s = self._sessions.get(session_id, {})
            if session_id in self._sessions:
                self._sessions[session_id]["status"]   = "complete"
                self._sessions[session_id]["results"]  = analysis
                self._sessions[session_id]["progress"] = ProgressEvent(
                    stage="complete", stage_progress=1.0,
                    overall_progress=1.0, message="Analysis complete!"
                )

        try:
            from auth.db import upsert_session
            upsert_session(
                session_id=        session_id,
                user_id=           s.get("user_id"),
                pro_id=            s.get("pro_id", "tiger_2000"),
                status=            "complete",
                created_at=        s.get("created_at", analysis.created_at),
                overall_score=     analysis.overall_score,
                compared_pro_name= analysis.compared_pro_name,
                thumbnail_url=     thumbnail_url,
                handedness=        s.get("handedness", "right"),
                camera_angle=      s.get("camera_angle", "dtl"),
            )
        except Exception as exc:
            log.warning("Could not update session in DB after completion: %s", exc)

    def mark_failed(self, session_id: str, error: str) -> None:
        with self._lock:
            if session_id in self._sessions:
                self._sessions[session_id]["status"] = "failed"
                self._sessions[session_id]["error"]  = error
                self._sessions[session_id]["progress"] = ProgressEvent(
                    stage="failed", stage_progress=0,
                    overall_progress=0, message="Processing failed", error=error
                )
        try:
            from auth.db import upsert_session
            s = self._sessions.get(session_id, {})
            upsert_session(session_id, s.get("user_id"), s.get("pro_id", "tiger_2000"),
                           "failed", s.get("created_at", ""))
        except Exception as exc:
            log.warning("Could not update failed session in DB: %s", exc)

    # ------------------------------------------------------------------
    # Results retrieval
    # ------------------------------------------------------------------

    def get_results(self, session_id: str) -> Optional[SwingAnalysis]:
        with self._lock:
            s = self._sessions.get(session_id)
            if s and s.get("results"):
                return s["results"]

        result_path = self.get_session_dir(session_id) / "analysis.json"
        if result_path.exists():
            try:
                analysis = SwingAnalysis.model_validate_json(result_path.read_text())
                with self._lock:
                    if session_id not in self._sessions:
                        self._sessions[session_id] = {
                            "id": session_id, "status": "complete",
                            "results": analysis, "progress": None, "error": None,
                            "pro_id": analysis.compared_pro_id or "tiger_2000",
                            "created_at": analysis.created_at, "user_id": None,
                            "handedness": "right", "camera_angle": "dtl",
                        }
                return analysis
            except Exception as exc:
                log.error("Failed to load analysis from disk for %s: %s", session_id, exc)
        return None

    # ------------------------------------------------------------------
    # Metadata accessors (used by pipeline)
    # ------------------------------------------------------------------

    def get_video_url(self, session_id: str) -> Optional[str]:
        """Return the served URL for the user's video file, scanning for any extension."""
        session_dir = self.get_session_dir(session_id)
        for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm"):
            if (session_dir / f"video{ext}").exists():
                return f"/sessions/{session_id}/video{ext}"
        return None

    def get_pro_id(self, session_id: str) -> str:
        with self._lock:
            return self._sessions.get(session_id, {}).get("pro_id", "tiger_2000")

    def get_handedness(self, session_id: str) -> str:
        with self._lock:
            return self._sessions.get(session_id, {}).get("handedness", "right")

    def get_camera_angle(self, session_id: str) -> str:
        with self._lock:
            return self._sessions.get(session_id, {}).get("camera_angle", "dtl")

    def get_video_rotation(self, session_id: str) -> int:
        with self._lock:
            return int(self._sessions.get(session_id, {}).get("video_rotation", 0))

    def get_user_id(self, session_id: str) -> Optional[str]:
        with self._lock:
            return self._sessions.get(session_id, {}).get("user_id")

    def get_created_at(self, session_id: str) -> Optional[str]:
        with self._lock:
            return self._sessions.get(session_id, {}).get("created_at")

    # ------------------------------------------------------------------
    # Frame selection (new manual comparison flow)
    # ------------------------------------------------------------------

    def set_frame_selection(self, session_id: str, selection) -> None:
        with self._lock:
            if session_id not in self._sessions:
                # Session not in memory — create stub entry so it can be retrieved
                self._sessions[session_id] = {
                    "id": session_id, "status": "uploaded",
                    "progress": None, "results": None, "error": None,
                    "pro_id": "tiger_2000", "handedness": "right",
                    "camera_angle": "dtl", "video_rotation": 0,
                    "created_at": "", "user_id": None,
                }
            self._sessions[session_id]["frame_selection"] = selection

    def get_frame_selection(self, session_id: str):
        with self._lock:
            return self._sessions.get(session_id, {}).get("frame_selection")

    def set_comparison_result(self, session_id: str, result) -> None:
        """Store comparison result. Pass result=None to evict a stale entry."""
        with self._lock:
            if result is None:
                # Evict stale cached result so the next poll goes to disk/status
                if session_id in self._sessions:
                    self._sessions[session_id].pop("comparison_result", None)
                return
            if session_id not in self._sessions:
                self._sessions[session_id] = {
                    "id": session_id, "status": "complete",
                    "progress": None, "results": None, "error": None,
                    "pro_id": "tiger_2000", "handedness": "right",
                    "camera_angle": "dtl", "video_rotation": 0,
                    "created_at": "", "user_id": None,
                }
            self._sessions[session_id]["comparison_result"] = result
            self._sessions[session_id]["status"]            = "complete"

    def get_comparison_result(self, session_id: str):
        with self._lock:
            return self._sessions.get(session_id, {}).get("comparison_result")


session_manager = SessionManager()
