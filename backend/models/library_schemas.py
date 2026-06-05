"""
Data models for the reference library, frame selection, and phase comparison.
"""
from __future__ import annotations
from typing import Dict, List, Optional
from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Reference Library
# ---------------------------------------------------------------------------

class LibraryEntry(BaseModel):
    id:            str
    name:          str
    camera_angle:  str                  # "dtl" | "face_on"
    handedness:    str                  # "right" | "left"
    gender:        str = "male"
    club_type:     str = "driver"
    tags:          List[str] = []
    video_url:     str
    thumbnail_url: Optional[str] = None
    duration:      Optional[float] = None
    fps:           Optional[float] = None
    description:   str = ""
    created_at:    str
    # Saved phase timestamps (seconds) for this reference swing.
    phase_times:   Dict[str, float] = Field(default_factory=dict)
    # "preloaded" = imported from GolfDB CSV; "user" = uploaded by a user.
    source:        str = "user"


class LibraryCatalog(BaseModel):
    entries: List[LibraryEntry] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Frame Selection
# ---------------------------------------------------------------------------

PHASE_NAMES = [
    "Address", "Takeaway", "Backswing", "Top of Swing",
    "Downswing", "Impact", "Follow Through", "Finish",
]


class FrameSelectionData(BaseModel):
    """User's manual assignment of video timestamps to swing phases."""
    session_id:      str
    reference_id:    Optional[str] = None
    user_times:      Dict[str, float] = Field(default_factory=dict)
    reference_times: Dict[str, float] = Field(default_factory=dict)
    handedness:      str = "right"
    camera_angle:    str = "dtl"
    gender:          str = "male"
    club_type:       str = "driver"

    @property
    def user_complete(self) -> bool:
        return len(self.user_times) == len(PHASE_NAMES)

    @property
    def reference_complete(self) -> bool:
        return len(self.reference_times) == len(PHASE_NAMES)

    @property
    def is_complete(self) -> bool:
        return self.user_complete and self.reference_complete


class FrameSelectionRequest(BaseModel):
    """Body for POST /sessions/{id}/frame-selection."""
    reference_id:    Optional[str] = None
    user_times:      Dict[str, float] = Field(default_factory=dict)
    reference_times: Dict[str, float] = Field(default_factory=dict)
    handedness:      str = "right"
    camera_angle:    str = "dtl"
    gender:          str = "male"
    club_type:       str = "driver"


# ---------------------------------------------------------------------------
# AI Coaching Feedback
# ---------------------------------------------------------------------------

class AICoachFeedback(BaseModel):
    """LLM-generated coaching output based on biomechanical comparison data."""
    summary:             str = ""
    top_strengths:       List[str] = Field(default_factory=list)
    top_improvements:    List[str] = Field(default_factory=list)
    recommended_drills:  List[str] = Field(default_factory=list)
    phase_tips:          Dict[str, str] = Field(default_factory=dict)  # phase → tip
    generated:           bool = False   # False = stub (no API key)


# ---------------------------------------------------------------------------
# Phase Comparison Result
# ---------------------------------------------------------------------------

class PhaseFrameAnalysis(BaseModel):
    """Pose data for one video at one phase timestamp."""
    phase:     str
    video_url: str
    time:      float
    frame_url: Optional[str] = None
    keypoints: Dict[str, dict] = Field(default_factory=dict)
    angles:    Dict[str, Optional[float]] = Field(default_factory=dict)


class PhaseComparisonData(BaseModel):
    """Side-by-side data for one phase."""
    phase:         str
    user:          PhaseFrameAnalysis
    reference:     PhaseFrameAnalysis
    deviation:     Dict[str, Optional[float]] = Field(default_factory=dict)
    rms_deviation: float = 0.0
    score:         float = 5.0


class SwingComparisonResult(BaseModel):
    """Complete comparison result returned by /comparison endpoint."""
    session_id:          str
    reference_id:        Optional[str] = None
    reference_name:      Optional[str] = None
    user_video_url:      str
    reference_video_url: Optional[str] = None
    handedness:          str
    camera_angle:        str
    club_type:           str = "driver"
    gender:              str = "male"
    phases:              Dict[str, PhaseComparisonData] = Field(default_factory=dict)
    overall_score:       float = 0.0
    requires_mirror:     bool = False
    angle_mismatch:      bool = False
    ai_feedback:         Optional[AICoachFeedback] = None
    created_at:          str
    status:              str = "complete"
