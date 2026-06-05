"""
Lightweight frame-level comparison engine.

After the user manually selects one frame per phase for both videos:
  1. Extracts those 16 frames (8 user + 8 reference) via OpenCV.
  2. Runs MediaPipe pose detection on each frame.
  3. Computes joint angles and deviations.
  4. Scores each phase (1-10).
  5. Generates AI coaching feedback via Claude.
  6. Auto-saves session to user's My Swings (if logged in).
  7. Persists reference phase timestamps to the library entry.
"""
from __future__ import annotations
import json
import logging
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Optional, Tuple

import cv2

from models.library_schemas import (
    AICoachFeedback,
    FrameSelectionData,
    PhaseComparisonData,
    PhaseFrameAnalysis,
    SwingComparisonResult,
    PHASE_NAMES,
)
from services.library_service import get_entry, get_video_path, save_phase_times

log = logging.getLogger(__name__)

STORAGE_DIR        = Path(os.getenv("STORAGE_DIR", "./storage"))
BASELINE_SCORE     = 10.0
PENALTY_PER_DEGREE = 0.15

# Per-phase weights for overall score.
# Impact 40%, Downswing 25%, Top 20%, 5 remaining phases share 15% (3% each).
# Weights sum to 1.0 exactly.
PHASE_WEIGHTS = {
    "Impact":         0.40,
    "Downswing":      0.25,
    "Top of Swing":   0.20,
    "Address":        0.03,
    "Takeaway":       0.03,
    "Backswing":      0.03,
    "Follow Through": 0.03,
    "Finish":         0.03,
}
# Kept for any callers that still reference PHASE_IMPORTANCE
PHASE_IMPORTANCE = PHASE_WEIGHTS


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------

def run_comparison(
    session_id:      str,
    selection:       FrameSelectionData,
    user_video_path: Path,
) -> SwingComparisonResult:
    session_dir  = STORAGE_DIR / "sessions" / session_id
    compare_dir  = session_dir / "comparison"
    compare_dir.mkdir(exist_ok=True)

    # Resolve reference
    ref_video_path: Optional[Path] = None
    ref_video_url:  Optional[str]  = None
    ref_name:       Optional[str]  = None
    ref_entry = None

    if selection.reference_id:
        ref_video_path = get_video_path(selection.reference_id)
        ref_entry = get_entry(selection.reference_id)
        if ref_entry:
            ref_video_url = ref_entry.video_url
            ref_name      = ref_entry.name

    requires_mirror = bool(ref_entry and ref_entry.handedness != selection.handedness)
    angle_mismatch  = bool(ref_entry and ref_entry.camera_angle != selection.camera_angle)

    # Extract + analyse frames per phase
    phases: Dict[str, PhaseComparisonData] = {}
    scores = []

    for phase in PHASE_NAMES:
        u_time = selection.user_times.get(phase)
        r_time = selection.reference_times.get(phase)

        if u_time is None and r_time is None:
            continue

        safe = phase.replace(" ", "_")
        u_frame_url = _extract_and_save(
            user_video_path, u_time or 0.0,
            compare_dir / f"user_{safe}.jpg", session_id, safe, "user",
        )
        r_frame_url = None
        if ref_video_path and r_time is not None:
            r_frame_url = _extract_and_save(
                ref_video_path, r_time,
                compare_dir / f"ref_{safe}.jpg", session_id, safe, "ref",
            )

        u_kps, u_angles = _analyse_frame(compare_dir / f"user_{safe}.jpg")
        r_kps, r_angles = {}, {}
        if r_frame_url:
            r_kps, r_angles = _analyse_frame(compare_dir / f"ref_{safe}.jpg")

        deviation, rms = _compute_deviation(u_angles, r_angles)
        score = max(1.0, min(10.0, BASELINE_SCORE - rms * PENALTY_PER_DEGREE))
        scores.append((score, PHASE_WEIGHTS.get(phase, 0.03)))

        phases[phase] = PhaseComparisonData(
            phase=phase,
            user=PhaseFrameAnalysis(
                phase=phase, video_url=f"/sessions/{session_id}/video.mp4",
                time=u_time or 0.0, frame_url=u_frame_url,
                keypoints=u_kps, angles=u_angles,
            ),
            reference=PhaseFrameAnalysis(
                phase=phase, video_url=ref_video_url or "",
                time=r_time or 0.0, frame_url=r_frame_url,
                keypoints=r_kps, angles=r_angles,
            ),
            deviation=deviation,
            rms_deviation=round(rms, 2),
            score=round(score, 2),
        )

    # Weighted overall: weights sum to 1.0, so divide by actual sum (handles
    # partial comparisons where not all 8 phases were set).
    total_w  = sum(w for _, w in scores)
    overall  = round(
        max(0.0, min(10.0, sum(s * w for s, w in scores) / total_w)), 2
    ) if total_w > 0 else 5.0

    result = SwingComparisonResult(
        session_id=          session_id,
        reference_id=        selection.reference_id,
        reference_name=      ref_name,
        user_video_url=      f"/sessions/{session_id}/video.mp4",
        reference_video_url= ref_video_url,
        handedness=          selection.handedness,
        camera_angle=        selection.camera_angle,
        club_type=           selection.club_type,
        gender=              selection.gender,
        phases=              phases,
        overall_score=       overall,
        requires_mirror=     requires_mirror,
        angle_mismatch=      angle_mismatch,
        created_at=          datetime.now(timezone.utc).isoformat(),
        status=              "complete",
    )

    # Generate AI coaching feedback
    result.ai_feedback = _generate_ai_feedback(result, ref_name or "reference")

    # Persist to disk
    (compare_dir / "comparison.json").write_text(result.model_dump_json(indent=2))
    log.info("Comparison saved: session=%s score=%.1f", session_id, overall)

    # Auto-save to user's My Swings
    _auto_save_session(session_id, result)

    # Persist reference phase timestamps so next comparison pre-loads them
    if selection.reference_id and selection.reference_times:
        save_phase_times(selection.reference_id, selection.reference_times)
        log.info("Saved reference phase times for %s", selection.reference_id)

    return result


# ---------------------------------------------------------------------------
# AI coaching feedback
# ---------------------------------------------------------------------------

_COACHING_PROMPT = """You are an elite PGA-certified golf biomechanics coach.

You will receive a JSON object with phase-by-phase angle comparisons between
a student's swing and a reference swing. Each phase includes the student's
joint angles, the reference angles, and the deviation (delta).

Respond ONLY with a valid JSON object matching this exact schema:
{
  "summary": "2-3 sentence executive summary of the overall swing quality",
  "top_strengths": ["strength 1", "strength 2"],
  "top_improvements": ["improvement 1 with specific degree value", "improvement 2"],
  "recommended_drills": ["drill with reps/sets", "drill 2"],
  "phase_tips": {
    "Address": "one specific sentence coaching tip for this phase",
    "Takeaway": "...",
    "Backswing": "...",
    "Top of Swing": "...",
    "Downswing": "...",
    "Impact": "...",
    "Follow Through": "...",
    "Finish": "..."
  }
}

Rules:
- Be specific — cite degree values when relevant (e.g. "your hip rotation is 62° less than reference").
- Prioritise phases with the largest RMS deviation.
- Each drill must be concrete and actionable.
- Output raw JSON only — no markdown fences."""


def _generate_ai_feedback(result: SwingComparisonResult, ref_name: str) -> AICoachFeedback:
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    if not api_key:
        log.info("No ANTHROPIC_API_KEY — returning stub feedback.")
        return _stub_feedback(result)

    report = {
        "reference": ref_name,
        "overall_score": result.overall_score,
        "phases": [
            {
                "phase":         name,
                "score":         pd.score,
                "rms_deviation": pd.rms_deviation,
                "deviations":    {k: v for k, v in pd.deviation.items() if v is not None},
                "user_angles":   {k: v for k, v in pd.user.angles.items() if v is not None},
            }
            for name, pd in result.phases.items()
        ],
    }

    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        msg = client.messages.create(
            model="claude-opus-4-8",
            max_tokens=1200,
            system=_COACHING_PROMPT,
            messages=[{"role": "user", "content": json.dumps(report, indent=2)}],
        )
        raw = msg.content[0].text
        # Strip markdown fences if present
        if "```" in raw:
            start = raw.find("{"); end = raw.rfind("}") + 1
            raw = raw[start:end]
        data = json.loads(raw)
        return AICoachFeedback(
            summary=            data.get("summary", ""),
            top_strengths=      data.get("top_strengths", []),
            top_improvements=   data.get("top_improvements", []),
            recommended_drills= data.get("recommended_drills", []),
            phase_tips=         data.get("phase_tips", {}),
            generated=          True,
        )
    except Exception as exc:
        log.error("AI feedback failed: %s", exc, exc_info=True)
        return _stub_feedback(result)


def _stub_feedback(result: SwingComparisonResult) -> AICoachFeedback:
    """Returned when Claude is unavailable — still useful for structure."""
    worst = sorted(result.phases.values(), key=lambda p: p.rms_deviation, reverse=True)
    improvements = []
    for p in worst[:3]:
        if p.rms_deviation > 5:
            improvements.append(
                f"{p.phase}: {p.rms_deviation:.1f}° avg deviation — review this phase carefully."
            )
    return AICoachFeedback(
        summary=(
            f"Overall score: {result.overall_score:.1f}/10. "
            "Analysis complete. Add an ANTHROPIC_API_KEY for personalized coaching."
        ),
        top_strengths=["Swing captured and analysed successfully across all 8 phases."],
        top_improvements=improvements or ["Set ANTHROPIC_API_KEY for AI coaching tips."],
        recommended_drills=["Record your swing again and compare with a new reference video."],
        phase_tips={p: f"Deviation: {d.rms_deviation:.1f}°" for p, d in result.phases.items()},
        generated=False,
    )


# ---------------------------------------------------------------------------
# Auto-save session to My Swings
# ---------------------------------------------------------------------------

def _auto_save_session(session_id: str, result: SwingComparisonResult) -> None:
    """Upsert to user_sessions so the comparison appears on My Swings page."""
    try:
        from api.session_manager import session_manager
        from auth.db import upsert_session

        user_id    = session_manager.get_user_id(session_id)
        created_at = session_manager.get_created_at(session_id)

        # Thumbnail: first available user frame across phases
        thumbnail_url = None
        for pd in result.phases.values():
            if pd.user.frame_url:
                thumbnail_url = pd.user.frame_url
                break

        upsert_session(
            session_id=        session_id,
            user_id=           user_id,
            pro_id=            result.reference_id or "manual",
            status=            "complete",
            created_at=        created_at or result.created_at,
            overall_score=     result.overall_score,
            compared_pro_name= result.reference_name,
            thumbnail_url=     thumbnail_url,
        )
        if user_id:
            log.info("Auto-saved session %s to My Swings (user %s)", session_id, user_id)
    except Exception as exc:
        log.warning("Auto-save failed for session %s: %s", session_id, exc)


# ---------------------------------------------------------------------------
# Frame extraction helpers
# ---------------------------------------------------------------------------

def _extract_and_save(
    video_path: Path,
    time_secs:  float,
    output_path: Path,
    session_id: str,
    phase_safe: str,
    side:       str,
) -> Optional[str]:
    try:
        cap = cv2.VideoCapture(str(video_path))
        cap.set(cv2.CAP_PROP_POS_MSEC, time_secs * 1000)
        ret, frame = cap.read()
        cap.release()
        if not ret:
            return None
        h, w = frame.shape[:2]
        if max(h, w) > 1080:
            s = 1080 / max(h, w)
            frame = cv2.resize(frame, (int(w*s), int(h*s)))
        cv2.imwrite(str(output_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 88])
        return f"/sessions/{session_id}/comparison/{side}_{phase_safe}.jpg"
    except Exception as e:
        log.error("Frame extraction failed: %s", e)
        return None


def _analyse_frame(frame_path: Path) -> Tuple[Dict, Dict]:
    if not frame_path.exists():
        return {}, {}
    try:
        import mediapipe as mp
        image = cv2.imread(str(frame_path))
        if image is None:
            return {}, {}
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        mp_pose = mp.solutions.pose
        with mp_pose.Pose(static_image_mode=True, model_complexity=1,
                          min_detection_confidence=0.45) as pose:
            result = pose.process(rgb)
        if not result.pose_landmarks:
            return {}, {}
        lms    = result.pose_landmarks.landmark
        KP_MAP = {
            11:"left_shoulder", 12:"right_shoulder",
            13:"left_elbow",    14:"right_elbow",
            15:"left_wrist",    16:"right_wrist",
            23:"left_hip",      24:"right_hip",
            25:"left_knee",     26:"right_knee",
            27:"left_ankle",    28:"right_ankle",
        }
        kps = {
            name: {"x": round(lms[i].x, 4), "y": round(lms[i].y, 4),
                   "confidence": round(lms[i].visibility, 3)}
            for i, name in KP_MAP.items()
        }
        lh = lms[23]; rh = lms[24]; ls = lms[11]; rs = lms[12]
        kps["mid_hip"]      = {"x":(lh.x+rh.x)/2, "y":(lh.y+rh.y)/2, "confidence":1.0}
        kps["mid_shoulder"] = {"x":(ls.x+rs.x)/2, "y":(ls.y+rs.y)/2, "confidence":1.0}
        return kps, _compute_angles(kps)
    except Exception as e:
        log.error("Pose analysis failed: %s", e)
        return {}, {}


def _compute_angles(kps: Dict) -> Dict:
    def pt(n): k=kps.get(n); return (k["x"],k["y"]) if k else None
    def a3(a,v,b):
        if not (a and v and b): return None
        ax,ay=a[0]-v[0],a[1]-v[1]; bx,by=b[0]-v[0],b[1]-v[1]
        d=ax*bx+ay*by; ma=math.sqrt(ax**2+ay**2); mb=math.sqrt(bx**2+by**2)
        return round(math.degrees(math.acos(max(-1,min(1,d/(ma*mb))))),2) if ma>1e-9 and mb>1e-9 else None
    def la(a,b):
        if not (a and b): return None
        return round(math.degrees(math.atan2(b[1]-a[1],b[0]-a[0])),2)
    def sa(s,h):
        if not (s and h): return None
        return round(abs(math.degrees(math.atan2(s[0]-h[0],-(s[1]-h[1])))),2)
    return {
        "left_elbow_angle":  a3(pt("left_shoulder"), pt("left_elbow"),  pt("left_wrist")),
        "right_elbow_angle": a3(pt("right_shoulder"),pt("right_elbow"), pt("right_wrist")),
        "left_knee_angle":   a3(pt("left_hip"),      pt("left_knee"),   pt("left_ankle")),
        "right_knee_angle":  a3(pt("right_hip"),     pt("right_knee"),  pt("right_ankle")),
        "spine_angle":       sa(pt("mid_shoulder"),  pt("mid_hip")),
        "hip_rotation":      la(pt("left_hip"),      pt("right_hip")),
        "shoulder_rotation": la(pt("left_shoulder"), pt("right_shoulder")),
    }


def _normalize_line_angle(angle: float) -> float:
    """
    Normalize an atan2-derived line angle to [0°, 180°).

    WHY: atan2(dy, dx) is used for shoulder-line and hip-line angles.
    A geometric LINE has 180° symmetry — the angle from A→B and from B→A
    represent the same physical orientation but differ by 180°.
    This causes phantom 180° errors when one video's MediaPipe assigns
    left/right shoulder slightly differently.

    Example: 57.4° and -119.0° are the SAME line orientation:
      normalize(57.4)  = 57.4°
      normalize(-119)  = (-119 % 180) = 61.0°   → actual diff = 3.6°
    """
    return ((angle % 180) + 180) % 180


def _line_delta(user: float, ref: float) -> float:
    """
    Circular difference for LINE angles (mod 180°). Result in [-90°, 90°].
    Use for: shoulder_rotation, hip_rotation.
    """
    nu = _normalize_line_angle(user)
    nr = _normalize_line_angle(ref)
    diff = nu - nr
    # Wrap to [-90, 90]
    if diff > 90:
        diff -= 180
    elif diff < -90:
        diff += 180
    return round(diff, 2)


def _directed_delta(user: float, ref: float) -> float:
    """
    Circular difference for DIRECTED angles (mod 360°). Result in [-180°, 180°].
    Use for: spine_angle, elbow angles (bounded 0–180, so linear is fine here).
    """
    return round(((user - ref + 180) % 360) - 180, 2)


# Angles computed by atan2 → undirected line → use mod-180 comparison
_LINE_ANGLE_METRICS      = {"hip_rotation", "shoulder_rotation"}
# Angles bounded in [0°, 180°] → linear difference is correct
_BOUNDED_ANGLE_METRICS   = {"spine_angle", "left_elbow_angle", "right_elbow_angle",
                             "left_knee_angle", "right_knee_angle"}

# If even after circular normalization the delta is this large, something is
# seriously wrong (e.g. camera angle mismatch or pose detection failure).
_SUSPICIOUS_DELTA_THRESHOLD = 90.0


def _compute_deviation(user_a: Dict, ref_a: Dict) -> Tuple[Dict, float]:
    all_metrics = list(_LINE_ANGLE_METRICS | _BOUNDED_ANGLE_METRICS)
    dev  = {}
    vals = []

    for m in all_metrics:
        u = user_a.get(m)
        r = ref_a.get(m)
        if u is None or r is None:
            dev[m] = None
            continue

        if m in _LINE_ANGLE_METRICS:
            delta = _line_delta(u, r)
        else:
            # Bounded angles are in [0, 180] — linear diff can't wrap
            delta = round(u - r, 2)

        dev[m] = delta

        if abs(delta) > _SUSPICIOUS_DELTA_THRESHOLD:
            log.warning(
                "Large %s delta=%.1f° (user=%.1f° ref=%.1f°) — "
                "possible camera mismatch or bad pose detection.",
                m, delta, u, r,
            )
        else:
            vals.append(delta ** 2)   # only include plausible deltas in RMS

    rms = math.sqrt(sum(vals) / len(vals)) if vals else 0.0
    return dev, rms


# ---------------------------------------------------------------------------
# Load saved comparison
# ---------------------------------------------------------------------------

def load_comparison(session_id: str) -> Optional[SwingComparisonResult]:
    result_path = STORAGE_DIR / "sessions" / session_id / "comparison" / "comparison.json"
    if result_path.exists():
        try:
            return SwingComparisonResult.model_validate_json(result_path.read_text())
        except Exception as e:
            log.error("Failed to load comparison for %s: %s", session_id, e)
    return None
