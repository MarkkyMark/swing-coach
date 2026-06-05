"""
Scoring engine.
Converts deviation data into 1–10 numerical scores per phase.
Mirrors Swift ScoringEngine.

Model:
  baseline = 10.0
  penalty  = abs(deviation_degrees) × 0.15
  clamped  to [1, 10]

Phase importance weights match the Swift version.
"""
from __future__ import annotations
from typing import List, Optional, Tuple

from models.schemas import PhaseScore, SwingPhase, SwingPhaseName, PHASE_IMPORTANCE

BASELINE          = 10.0
PENALTY_PER_DEGREE = 0.15
MIN_SCORE         = 1.0

SCORING_WEIGHTS = {
    "spine_angle":    0.25,
    "hip_rotation":   0.25,
    "shoulder_line":  0.20,
    "elbow_position": 0.15,
    "weight_transfer": 0.15,
}


def score_all_phases(phases: List[SwingPhase]) -> Tuple[List[SwingPhase], float]:
    """
    Score every phase in-place. Return (updated phases, overall_score).
    """
    scored   = []
    weighted = 0.0
    total_w  = 0.0

    for phase in phases:
        updated, ps = _score_phase(phase)
        scored.append(updated)

        importance  = PHASE_IMPORTANCE.get(phase.name, 1.0)
        weighted   += ps.overall * importance
        total_w    += importance

    overall = _clamp(weighted / total_w if total_w else 5.0)
    return scored, round(overall, 2)


def _score_phase(phase: SwingPhase) -> Tuple[SwingPhase, PhaseScore]:
    devs = [f.deviation_from_pro for f in phase.frames if f.deviation_from_pro]

    def avg_delta(attr: str) -> Optional[float]:
        vals = [getattr(d, attr) for d in devs if getattr(d, attr) is not None]
        return sum(vals) / len(vals) if vals else None

    spine_score    = _metric_score(avg_delta("spine_angle_delta"))
    hip_score      = _metric_score(avg_delta("hip_rotation_delta"))
    arm_score      = _metric_score(avg_delta("left_elbow_angle_delta"))
    shoulder_score = _metric_score(avg_delta("shoulder_rotation_delta"))

    overall = _clamp(
        spine_score    * SCORING_WEIGHTS["spine_angle"]    +
        hip_score      * SCORING_WEIGHTS["hip_rotation"]   +
        arm_score      * SCORING_WEIGHTS["elbow_position"] +
        shoulder_score * SCORING_WEIGHTS["shoulder_line"]  +
        BASELINE       * SCORING_WEIGHTS["weight_transfer"]
    )

    ps = PhaseScore(
        overall=round(overall, 2),
        spine_angle=round(spine_score, 2),
        hip_rotation=round(hip_score, 2),
        arm_position=round(arm_score, 2),
    )
    updated_phase = phase.model_copy(update={"score": ps})
    return updated_phase, ps


def _metric_score(deviation: Optional[float]) -> float:
    if deviation is None:
        return BASELINE
    penalty = abs(deviation) * PENALTY_PER_DEGREE
    return _clamp(BASELINE - penalty)


def _clamp(val: float) -> float:
    return max(MIN_SCORE, min(BASELINE, val))
