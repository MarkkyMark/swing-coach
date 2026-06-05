"""
Pose feature extraction for DTW alignment.

Produces a 16-dimensional, translation- and scale-invariant descriptor
from MediaPipe keypoints.

Invariance achieved by:
  - Translating all joint positions relative to the mid-hip centre.
  - Scaling by the torso length (hip-to-shoulder distance).

Using these 8 joints captures all swing-relevant motion:
  shoulders (rotation), elbows (arm plane), wrists (club path), hips (rotation).

For left-handed golfers, the x-axis is mirrored so the reference sequences
(computed for right-handers) remain valid.
"""
from __future__ import annotations
import logging
import numpy as np
from typing import Dict, List, Optional

log = logging.getLogger(__name__)

# Joints included in the feature vector — order must match reference sequences
DTW_JOINTS = [
    "left_shoulder",  "right_shoulder",
    "left_elbow",     "right_elbow",
    "left_wrist",     "right_wrist",
    "left_hip",       "right_hip",
]
FEATURE_DIM = len(DTW_JOINTS) * 2   # 16


def extract_features(
    keypoints:  Dict,          # dict of joint_name → Keypoint (or plain dict)
    handedness: str = "right",
) -> Optional[np.ndarray]:
    """
    Extract a FEATURE_DIM-dimensional feature vector from one frame's keypoints.

    Returns None if anchor joints are missing or unreliable.
    The 'Keypoint' objects are from models.schemas; plain dicts with x/y/confidence
    also work (used by the reference sequence generator).
    """
    def _get(name: str):
        kp = keypoints.get(name)
        if kp is None:
            return None
        # Support both Pydantic Keypoint objects and plain dicts
        if hasattr(kp, "confidence"):
            return kp if kp.confidence > 0.2 else None
        conf = kp.get("confidence", 1.0)
        return kp if conf > 0.2 else None

    def _xy(name: str):
        kp = _get(name)
        if kp is None:
            return None, None
        if hasattr(kp, "x"):
            return float(kp.x), float(kp.y)
        return float(kp.get("x", 0.5)), float(kp.get("y", 0.5))

    # Anchor joints for origin + scale
    lhx, lhy = _xy("left_hip")
    rhx, rhy = _xy("right_hip")
    lsx, lsy = _xy("left_shoulder")
    rsx, rsy = _xy("right_shoulder")

    if any(v is None for v in [lhx, rhx, lsx, rsx]):
        return None

    hip_cx   = (lhx + rhx) / 2
    hip_cy   = (lhy + rhy) / 2
    shldr_cx = (lsx + rsx) / 2
    shldr_cy = (lsy + rsy) / 2

    torso = max(0.04, ((shldr_cx - hip_cx) ** 2 + (shldr_cy - hip_cy) ** 2) ** 0.5)

    features: List[float] = []
    for joint in DTW_JOINTS:
        x, y = _xy(joint)
        if x is None:
            # Missing joint → use hip centre (neutral / zero relative position)
            features.extend([0.0, 0.0])
        else:
            rx = (x - hip_cx) / torso
            ry = (y - hip_cy) / torso
            # Mirror x for left-handers so reference sequences align correctly
            if handedness == "left":
                rx = -rx
            features.extend([rx, ry])

    return np.array(features, dtype=np.float32)


def fill_missing_features(
    raw: List[Optional[np.ndarray]],
) -> List[np.ndarray]:
    """
    Fill None entries in a feature sequence by linear interpolation.
    Leading / trailing Nones are filled with the nearest valid value.
    """
    n = len(raw)
    result: List[Optional[np.ndarray]] = list(raw)

    # Identify first and last valid indices
    first = next((i for i, v in enumerate(result) if v is not None), None)
    last  = next((i for i, v in enumerate(reversed(result)) if v is not None), None)

    if first is None:
        # Completely empty — return zero vectors
        zero = np.zeros(FEATURE_DIM, dtype=np.float32)
        return [zero] * n

    last = n - 1 - last  # type: ignore

    # Fill leading
    for i in range(first):
        result[i] = result[first].copy()  # type: ignore
    # Fill trailing
    for i in range(last + 1, n):
        result[i] = result[last].copy()   # type: ignore

    # Fill interior by linear interpolation
    i = 0
    while i < n:
        if result[i] is None:
            j = i + 1
            while j < n and result[j] is None:
                j += 1
            start = result[i - 1]  # type: ignore
            end   = result[j] if j < n else result[i - 1]  # type: ignore
            gap   = j - i + 1
            for k in range(i, j):
                t = (k - i + 1) / gap
                result[k] = start + t * (end - start)
            i = j
        else:
            i += 1

    return result  # type: ignore
