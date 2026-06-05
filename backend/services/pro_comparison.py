"""
Pro swing comparison engine.
Loads reference data from data/pro_reference.json,
computes DeviationVector for every frame relative to the reference.
Mirrors Swift ProSwingComparisonEngine.
"""
from __future__ import annotations
import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional

from models.schemas import DeviationVector, SwingPhase

DATA_PATH = Path(__file__).parent.parent / "data" / "pro_reference.json"


@lru_cache(maxsize=1)
def _load_all_pros() -> Dict:
    with open(DATA_PATH) as f:
        return json.load(f)


def load_pro_catalog() -> Dict[str, Dict]:
    """Returns {pro_id: {"name": ..., "bio": ..., "style": ...}} for the UI dropdown."""
    data = _load_all_pros()
    return {
        pid: {"name": meta["name"], "bio": meta["bio"], "style": meta["style"]}
        for pid, meta in data.items()
    }


def compare_phases_to_pro(
    phases: List[SwingPhase],
    pro_id: str,
) -> List[SwingPhase]:
    """
    Attach DeviationVector to every frame in every phase.
    Returns the phases list with deviation data populated.
    """
    all_pros = _load_all_pros()
    pro_data = all_pros.get(pro_id)
    if not pro_data:
        return phases   # no reference — skip comparison

    pro_phases = pro_data["phases"]
    updated    = []

    for phase in phases:
        ref = pro_phases.get(phase.name)
        if not ref:
            updated.append(phase)
            continue

        new_frames = []
        for frame in phase.frames:
            dev = _compute_deviation(frame.angles, ref)
            new_frames.append(frame.model_copy(update={"deviation_from_pro": dev}))

        updated.append(phase.model_copy(update={"frames": new_frames}))

    return updated


def _normalize_line(angle: float) -> float:
    """Normalize atan2-derived line angle to [0°, 180°) — handles 180° symmetry."""
    return ((angle % 180) + 180) % 180


def _line_delta(user: Optional[float], ref: float) -> Optional[float]:
    """Circular delta for undirected line angles (shoulder / hip). Result in [-90, 90]."""
    if user is None:
        return None
    nu = _normalize_line(user)
    nr = _normalize_line(ref)
    diff = nu - nr
    if diff > 90:   diff -= 180
    elif diff < -90: diff += 180
    return round(diff, 2)


def _bounded_delta(user: Optional[float], ref: float) -> Optional[float]:
    """Linear delta for bounded [0°, 180°] angles (elbow, spine)."""
    return round(user - ref, 2) if user is not None else None


def _compute_deviation(angles, ref: Dict) -> DeviationVector:
    return DeviationVector(
        spine_angle_delta=      _bounded_delta(angles.spine_angle,       ref["spine_angle"]),
        hip_rotation_delta=     _line_delta(angles.hip_rotation,         ref["hip_rotation"]),
        shoulder_rotation_delta=_line_delta(angles.shoulder_rotation,    ref["shoulder_rotation"]),
        left_elbow_angle_delta= _bounded_delta(angles.left_elbow_angle,  ref["left_elbow_angle"]),
        right_elbow_angle_delta=_bounded_delta(angles.right_elbow_angle, ref["right_elbow_angle"]),
    )
