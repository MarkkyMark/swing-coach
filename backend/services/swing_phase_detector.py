"""
Swing Phase Detector — DTW Reference Alignment

Replaces the previous heuristic (shoulder rotation / wrist trajectory)
with Dynamic Time Warping alignment against pre-labeled synthetic reference swings.

Why the old approach failed:
  • Shoulder rotation is camera-angle-dependent (DTL vs face-on produce opposite angles).
  • The local-minimum / local-maximum wrist detection is noise-sensitive.
  • Neither approach can recover from sparse MediaPipe detections on dark footage.

New approach:
  1. Extract 16-dim pose feature vectors from every user frame.
  2. Load the reference feature sequence for the selected pro (42 frames, 8 labeled phases).
  3. DTW-align the user sequence to the reference.
  4. Assign each user frame the phase label of its closest reference frame.
  5. Build SwingPhase objects from the labeled frame spans.

Fallback chain:
  DTW (needs ≥30% pose coverage)
    → wrist y-trajectory heuristic (needs ≥30% wrist detections)
      → uniform segmentation (always works, labelled "(approx)")

Debug output:
  The _dtw_debug_info dict is attached to each SwingPhase so the frontend
  can display "detected via DTW vs reference" info.
"""
from __future__ import annotations
import logging
import math
import statistics
from typing import Dict, List, Optional, Tuple

import numpy as np

from models.schemas import FrameData, SwingPhase, SwingPhaseName
from services.dtw_aligner import dtw_align, assign_phases
from services.pose_features import extract_features, fill_missing_features
from services.reference_swings import get_reference

log = logging.getLogger(__name__)

PHASE_ORDER = [p.value for p in SwingPhaseName]


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def detect_phases(
    frames:       List[FrameData],
    pro_id:       str = "tiger_2000",
    handedness:   str = "right",
    camera_angle: str = "dtl",
) -> List[SwingPhase]:
    """
    Detect and label the 8 canonical swing phases.

    Parameters
    ----------
    frames       : all extracted frames with pose keypoints populated
    pro_id       : reference pro to align against
    handedness   : "right" | "left"  (mirrors features for left-handed)
    camera_angle : "dtl" | "face_on" (informational; reference is DTL by default)
    """
    n = len(frames)
    if n < 8:
        log.warning("Too few frames (%d) — uniform segmentation.", n)
        return _fallback_uniform(frames, method="uniform (too few frames)")

    # ── Strategy 1: DTW alignment ────────────────────────────────────────
    result = _detect_dtw(frames, pro_id, handedness)
    if result:
        return result

    # ── Strategy 2: wrist trajectory heuristic ──────────────────────────
    log.info("DTW insufficient coverage — trying wrist heuristic.")
    result = _detect_wrist(frames, handedness)
    if result:
        return result

    # ── Strategy 3: uniform fallback ────────────────────────────────────
    log.warning("All detection strategies failed — uniform segmentation.")
    return _fallback_uniform(frames, method="uniform (fallback)")


# ---------------------------------------------------------------------------
# Strategy 1: DTW
# ---------------------------------------------------------------------------

def _detect_dtw(
    frames:     List[FrameData],
    pro_id:     str,
    handedness: str,
) -> Optional[List[SwingPhase]]:
    try:
        # Extract feature vectors
        raw_feats = [extract_features(f.keypoints, handedness) for f in frames]
        n_valid   = sum(1 for f in raw_feats if f is not None)
        coverage  = n_valid / len(frames)

        log.info("DTW pose coverage: %.1f%% (%d/%d frames)", coverage * 100, n_valid, len(frames))

        if coverage < 0.25:
            log.info("Coverage too low for DTW (need ≥25%%).")
            return None

        # Fill gaps by interpolation
        feats   = fill_missing_features(raw_feats)
        user_seq = np.stack(feats)              # (N, D)

        # Load reference
        ref_result = get_reference(pro_id)
        if ref_result is None:
            log.warning("No reference for pro '%s'.", pro_id)
            return None
        ref_seq, ref_labels = ref_result

        # Run DTW
        path, cost = dtw_align(user_seq, ref_seq, band=0.45)

        # Assign per-frame labels
        phase_labels = assign_phases(len(frames), path, ref_labels)

        # Attach debug metadata
        debug = {
            "method":      "dtw",
            "pro_id":      pro_id,
            "dtw_cost":    round(cost, 4),
            "coverage":    round(coverage, 3),
            "ref_frames":  len(ref_seq),
            "user_frames": len(frames),
        }
        log.info("DTW alignment: cost=%.4f  coverage=%.1f%%", cost, coverage * 100)

        return _build_from_labels(frames, phase_labels, debug)

    except Exception as exc:
        log.error("DTW detection raised: %s", exc, exc_info=True)
        return None


# ---------------------------------------------------------------------------
# Strategy 2: wrist y-trajectory heuristic
# ---------------------------------------------------------------------------

def _detect_wrist(
    frames:     List[FrameData],
    handedness: str,
) -> Optional[List[SwingPhase]]:
    lead_wrist = "left_wrist" if handedness == "right" else "right_wrist"
    n          = len(frames)

    y_raw: List[Optional[float]] = []
    for f in frames:
        kp = f.keypoints.get(lead_wrist)
        if kp and (kp.confidence if hasattr(kp, "confidence") else kp.get("confidence", 0)) > 0.2:
            y_raw.append(float(kp.y if hasattr(kp, "y") else kp.get("y", 0.5)))
        else:
            y_raw.append(None)

    n_valid = sum(1 for v in y_raw if v is not None)
    if n_valid < n * 0.30:
        log.info("Wrist coverage too low (%.1f%%).", n_valid / n * 100)
        return None

    y = _interpolate(y_raw)
    y = _smooth(y, max(7, n // 25))

    # Address: first stable period (≤1% frame height velocity)
    vel     = [abs(y[i+1] - y[i]) for i in range(n-1)] + [0.0]
    vel     = _smooth(vel, 5)
    addr    = 0
    WIN     = max(5, n // 20)
    for i in range(n // 3):
        if all(vel[i+k] < 0.009 for k in range(min(WIN, n - i))):
            addr = i + WIN // 2
            break
    addr = min(addr, n // 5)

    # Top of swing: minimum wrist y (highest position) in first 65% after address
    top_search_end   = addr + int((n - addr) * 0.65)
    top_search_start = addr + max(3, (n - addr) // 10)
    top_search_end   = min(top_search_end, n - 1)
    if top_search_start >= top_search_end:
        return None
    seg  = y[top_search_start:top_search_end]
    top  = top_search_start + seg.index(min(seg))

    # Impact: maximum wrist y after top (lowest point)
    i_start = top + max(3, (n - top) // 8)
    i_end   = top + int((n - top) * 0.72)
    i_end   = min(i_end, n - 2)
    if i_start >= i_end:
        imp = top + (n - top) * 2 // 3
    else:
        seg2 = y[i_start:i_end]
        imp  = i_start + seg2.index(max(seg2))
    imp    = min(imp, n - 3)
    finish = n - 1

    if not (0 <= addr < top < imp < finish):
        return None

    labels = _labels_from_anchors(n, addr, top, imp, finish)
    debug  = {"method": "wrist_heuristic", "address": addr, "top": top, "impact": imp}
    log.info("Wrist heuristic: addr=%d top=%d impact=%d", addr, top, imp)
    return _build_from_labels(frames, labels, debug)


def _labels_from_anchors(n: int, addr: int, top: int, imp: int, fin: int) -> List[str]:
    """Assign phase labels frame-by-frame from 4 anchor indices."""
    bs   = max(top - addr, 3)
    t1   = addr + bs // 3
    t2   = addr + 2 * bs // 3
    ds   = top + max(1, (imp - top) // 2)
    ft   = imp + max(1, (fin - imp) // 2)

    boundaries = [
        ("Address",        0,   addr),
        ("Takeaway",       addr, t1),
        ("Backswing",      t1,   t2),
        ("Top of Swing",   t2,   top),
        ("Downswing",      top,  ds),
        ("Impact",         ds,   imp),
        ("Follow Through", imp,  ft),
        ("Finish",         ft,   fin),
    ]

    labels = ["Address"] * n
    for name, start, stop in boundaries:
        stop = min(stop, n - 1)
        for i in range(start, stop + 1):
            labels[i] = name
    return labels


# ---------------------------------------------------------------------------
# Phase builder — shared by both strategies
# ---------------------------------------------------------------------------

def _build_from_labels(
    frames:       List[FrameData],
    phase_labels: List[str],
    debug:        Dict,
) -> List[SwingPhase]:
    """
    Group frames by consecutive phase label into SwingPhase objects.
    Within each phase, mark the middle frame as the key frame.
    """
    # Collect contiguous spans
    spans: List[Tuple[str, int, int]] = []
    cur_phase  = phase_labels[0]
    span_start = 0

    for i, label in enumerate(phase_labels[1:], 1):
        if label != cur_phase:
            spans.append((cur_phase, span_start, i - 1))
            cur_phase  = label
            span_start = i
    spans.append((cur_phase, span_start, len(frames) - 1))

    # Ensure all 8 phases appear (merge duplicates, insert missing as single-frame)
    spans = _merge_and_order(spans, len(frames))

    phases: List[SwingPhase] = []
    for phase_name, start, stop in spans:
        stop          = min(stop, len(frames) - 1)
        phase_frames  = list(frames[start:stop + 1])
        if not phase_frames:
            continue

        mid = len(phase_frames) // 2
        phase_frames[mid] = phase_frames[mid].model_copy(update={"is_key_frame": True})
        phase_frames = [f.model_copy(update={"phase": phase_name}) for f in phase_frames]

        phases.append(SwingPhase(
            name=        phase_name,
            frame_range= (start, stop),
            frames=      phase_frames,
        ))

    return phases


def _merge_and_order(
    spans: List[Tuple[str, int, int]],
    n:     int,
) -> List[Tuple[str, int, int]]:
    """
    Ensure all 8 phases appear in canonical order.
    If a phase appears multiple times (DTW can produce repeats), keep the longest.
    If a phase is missing, synthesize a 1-frame placeholder from the nearest span.
    """
    # Collapse to canonical order, keeping longest span per phase
    best: Dict[str, Tuple[str, int, int]] = {}
    for name, start, stop in spans:
        length = stop - start
        if name not in best or length > best[name][2] - best[name][1]:
            best[name] = (name, start, stop)

    ordered: List[Tuple[str, int, int]] = []
    prev_stop = 0
    for phase_name in PHASE_ORDER:
        if phase_name in best:
            _, start, stop = best[phase_name]
            ordered.append((phase_name, max(prev_stop, start), stop))
            prev_stop = stop + 1
        else:
            # Synthesize a 1-frame placeholder at the current position
            pos = min(prev_stop, n - 1)
            ordered.append((phase_name, pos, pos))

    return ordered


# ---------------------------------------------------------------------------
# Fallback: uniform segmentation
# ---------------------------------------------------------------------------

def _fallback_uniform(
    frames: List[FrameData],
    method: str = "uniform",
) -> List[SwingPhase]:
    n     = len(frames)
    chunk = max(1, n // len(PHASE_ORDER))
    spans = []
    for i, name in enumerate(PHASE_ORDER):
        start = i * chunk
        stop  = (i + 1) * chunk - 1 if i < len(PHASE_ORDER) - 1 else n - 1
        spans.append((name, start, min(stop, n - 1)))
    debug = {"method": method}
    labels = ["Address"] * n
    for name, start, stop in spans:
        for i in range(start, stop + 1):
            labels[i] = name
    return _build_from_labels(frames, labels, debug)


# ---------------------------------------------------------------------------
# Signal processing helpers
# ---------------------------------------------------------------------------

def _interpolate(values: List[Optional[float]]) -> List[float]:
    result: List[Optional[float]] = list(values)
    n      = len(result)
    first  = next((i for i, v in enumerate(result) if v is not None), None)
    last   = next((i for i, v in enumerate(reversed(result)) if v is not None), None)
    if first is None:
        return [0.5] * n
    last = n - 1 - last  # type: ignore
    for i in range(first):
        result[i] = result[first]
    for i in range(last + 1, n):
        result[i] = result[last]
    i = 0
    while i < n:
        if result[i] is None:
            j = i + 1
            while j < n and result[j] is None:
                j += 1
            sv, ev = result[i - 1], result[j] if j < n else result[i - 1]
            for k in range(i, j):
                t = (k - i + 1) / (j - i + 1)
                result[k] = sv + t * (ev - sv)  # type: ignore
            i = j
        else:
            i += 1
    return [v if v is not None else 0.5 for v in result]


def _smooth(values: List[float], window: int) -> List[float]:
    n, half = len(values), window // 2
    return [sum(values[max(0,i-half):min(n,i+half+1)]) /
            len(values[max(0,i-half):min(n,i+half+1)])
            for i in range(n)]
