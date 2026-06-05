"""
Central Pydantic schema definitions.

KEY FIX: Python @property is never serialized by Pydantic.
Computed values use @computed_field so they appear in JSON responses.
This fixes the Frames tab (key_frames missing) and Compare tab (avg_angles missing).
"""
from __future__ import annotations
from typing import Dict, List, Optional, Tuple
from pydantic import BaseModel, Field, computed_field
from enum import Enum


# ---------------------------------------------------------------------------
# Pose / Keypoints
# ---------------------------------------------------------------------------

class Keypoint(BaseModel):
    x: float          # normalized [0, 1] — origin top-left
    y: float          # normalized [0, 1]
    confidence: float

    @property
    def is_reliable(self) -> bool:
        return self.confidence > 0.5


class JointAngles(BaseModel):
    left_elbow_angle:     Optional[float] = None
    right_elbow_angle:    Optional[float] = None
    left_shoulder_angle:  Optional[float] = None
    right_shoulder_angle: Optional[float] = None
    spine_angle:          Optional[float] = None
    hip_rotation:         Optional[float] = None
    shoulder_rotation:    Optional[float] = None
    left_knee_angle:      Optional[float] = None
    right_knee_angle:     Optional[float] = None


class DeviationVector(BaseModel):
    spine_angle_delta:       Optional[float] = None
    hip_rotation_delta:      Optional[float] = None
    shoulder_rotation_delta: Optional[float] = None
    left_elbow_angle_delta:  Optional[float] = None
    right_elbow_angle_delta: Optional[float] = None

    @computed_field
    @property
    def rms_deviation(self) -> float:
        vals = [v for v in [
            self.spine_angle_delta, self.hip_rotation_delta,
            self.shoulder_rotation_delta, self.left_elbow_angle_delta,
            self.right_elbow_angle_delta,
        ] if v is not None]
        if not vals:
            return 0.0
        return float((sum(v ** 2 for v in vals) / len(vals)) ** 0.5)


# ---------------------------------------------------------------------------
# Frames
# ---------------------------------------------------------------------------

class FrameData(BaseModel):
    frame_index:        int
    timestamp:          float
    image_path:         str
    image_url:          str
    keypoints:          Dict[str, Keypoint] = Field(default_factory=dict)
    angles:             JointAngles = Field(default_factory=JointAngles)
    phase:              Optional[str] = None
    is_key_frame:       bool = False
    deviation_from_pro: Optional[DeviationVector] = None


# ---------------------------------------------------------------------------
# Swing Phases
# ---------------------------------------------------------------------------

class SwingPhaseName(str, Enum):
    ADDRESS        = "Address"
    TAKEAWAY       = "Takeaway"
    BACKSWING      = "Backswing"
    TOP_OF_SWING   = "Top of Swing"
    DOWNSWING      = "Downswing"
    IMPACT         = "Impact"
    FOLLOW_THROUGH = "Follow Through"
    FINISH         = "Finish"


PHASE_DESCRIPTIONS = {
    SwingPhaseName.ADDRESS:        "Static setup position. Club soled behind ball.",
    SwingPhaseName.TAKEAWAY:       "Club moves back from address. Wrists begin to hinge.",
    SwingPhaseName.BACKSWING:      "Rotation continues. Weight transfers to trail side.",
    SwingPhaseName.TOP_OF_SWING:   "Club reaches peak elevation. Full shoulder turn.",
    SwingPhaseName.DOWNSWING:      "Transition begins. Hips fire toward target.",
    SwingPhaseName.IMPACT:         "Club contacts ball. Hands ahead of clubhead.",
    SwingPhaseName.FOLLOW_THROUGH: "Club accelerates through impact zone.",
    SwingPhaseName.FINISH:         "Weight fully on lead side. Belt buckle faces target.",
}

PHASE_IMPORTANCE = {
    SwingPhaseName.ADDRESS:        1.5,
    SwingPhaseName.TAKEAWAY:       1.0,
    SwingPhaseName.BACKSWING:      1.0,
    SwingPhaseName.TOP_OF_SWING:   1.2,
    SwingPhaseName.DOWNSWING:      1.3,
    SwingPhaseName.IMPACT:         2.0,
    SwingPhaseName.FOLLOW_THROUGH: 0.8,
    SwingPhaseName.FINISH:         0.7,
}


class PhaseScore(BaseModel):
    overall:             float
    spine_angle:         Optional[float] = None
    hip_rotation:        Optional[float] = None
    arm_position:        Optional[float] = None
    weight_distribution: Optional[float] = None

    @computed_field
    @property
    def grade(self) -> str:
        if self.overall >= 9:  return "A+"
        if self.overall >= 8:  return "A"
        if self.overall >= 7:  return "B"
        if self.overall >= 6:  return "C"
        if self.overall >= 5:  return "D"
        return "F"


class PhaseFeedback(BaseModel):
    summary:      str
    strengths:    List[str] = Field(default_factory=list)
    improvements: List[str] = Field(default_factory=list)
    drills:       List[str] = Field(default_factory=list)


class SwingPhase(BaseModel):
    name:        str
    frame_range: Tuple[int, int]
    frames:      List[FrameData] = Field(default_factory=list)
    score:       Optional[PhaseScore] = None
    feedback:    Optional[PhaseFeedback] = None

    # ------------------------------------------------------------------
    # Computed fields — NOW serialized in JSON (this was the root bug)
    # ------------------------------------------------------------------

    @computed_field
    @property
    def key_frame(self) -> Optional[FrameData]:
        """Representative frame for this phase (first is_key_frame or middle)."""
        kf = next((f for f in self.frames if f.is_key_frame), None)
        return kf or (self.frames[len(self.frames) // 2] if self.frames else None)

    @computed_field
    @property
    def avg_deviation_rms(self) -> Optional[float]:
        """Mean RMS deviation across all frames in this phase."""
        devs = [f.deviation_from_pro.rms_deviation
                for f in self.frames if f.deviation_from_pro]
        return round(sum(devs) / len(devs), 3) if devs else None

    @computed_field
    @property
    def avg_angles(self) -> JointAngles:
        """Phase-average joint angles (used by Compare tab)."""
        def _avg(vals: list) -> Optional[float]:
            clean = [v for v in vals if v is not None]
            return round(sum(clean) / len(clean), 2) if clean else None

        return JointAngles(
            spine_angle=       _avg([f.angles.spine_angle       for f in self.frames]),
            hip_rotation=      _avg([f.angles.hip_rotation      for f in self.frames]),
            shoulder_rotation= _avg([f.angles.shoulder_rotation for f in self.frames]),
            left_elbow_angle=  _avg([f.angles.left_elbow_angle  for f in self.frames]),
            right_elbow_angle= _avg([f.angles.right_elbow_angle for f in self.frames]),
            left_knee_angle=   _avg([f.angles.left_knee_angle   for f in self.frames]),
            right_knee_angle=  _avg([f.angles.right_knee_angle  for f in self.frames]),
        )

    @property
    def frame_count(self) -> int:
        return len(self.frames)


# ---------------------------------------------------------------------------
# Full Analysis
# ---------------------------------------------------------------------------

class VideoMetadata(BaseModel):
    duration:     float
    width:        int
    height:       int
    fps:          float
    total_frames: int


class SwingAnalysis(BaseModel):
    session_id:         str
    video_url:          str
    metadata:           Optional[VideoMetadata] = None
    phases:             List[SwingPhase] = Field(default_factory=list)
    overall_score:      float = 0.0
    summary:            str = ""
    top_strengths:      List[str] = Field(default_factory=list)
    top_improvements:   List[str] = Field(default_factory=list)
    recommended_drills: List[str] = Field(default_factory=list)
    compared_pro_id:    Optional[str] = None
    compared_pro_name:  Optional[str] = None
    created_at:         str = ""

    # ------------------------------------------------------------------
    # Computed fields — serialized in JSON
    # ------------------------------------------------------------------

    @computed_field
    @property
    def key_frames(self) -> List[FrameData]:
        """One key frame per phase — used by FrameGallery and Compare tab."""
        return [p.key_frame for p in self.phases if p.key_frame is not None]

    # Regular property (NOT computed_field) — too large to duplicate in JSON
    @property
    def all_frames(self) -> List[FrameData]:
        return [f for phase in self.phases for f in phase.frames]

    def phase_by_name(self, name: str) -> Optional[SwingPhase]:
        return next((p for p in self.phases if p.name == name), None)


# ---------------------------------------------------------------------------
# API types
# ---------------------------------------------------------------------------

class UploadResponse(BaseModel):
    session_id: str
    metadata:   VideoMetadata
    video_url:  str              # actual served URL including the real file extension


class ProgressEvent(BaseModel):
    stage:            str
    stage_progress:   float
    overall_progress: float
    message:          str
    error:            Optional[str] = None


class SessionStatus(BaseModel):
    session_id: str
    status:     str
    progress:   Optional[ProgressEvent] = None
    error:      Optional[str] = None


class UserSessionSummary(BaseModel):
    """Lightweight session record shown on the My Swings page."""
    session_id:        str
    overall_score:     Optional[float] = None
    compared_pro_name: Optional[str] = None
    created_at:        str
    status:            str
    thumbnail_url:     Optional[str] = None  # first key frame URL
