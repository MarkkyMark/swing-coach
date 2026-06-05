"""
Forward-kinematics pose synthesizer.

Given biomechanical angle measurements from the pro reference data,
generates normalized [0,1] keypoint positions for a plausible stick figure.

Used by the Compare tab to render the pro's expected pose alongside the user's
actual detected pose — without needing real pro video footage.
"""
from __future__ import annotations
import math
from typing import Dict


def synthesize_keypoints(
    spine_angle: float       = 32.0,   # degrees: forward lean from vertical
    hip_rotation: float      = 0.0,    # degrees: hip line from horizontal
    shoulder_rotation: float = 0.0,    # degrees: shoulder line from horizontal
    left_elbow_angle: float  = 160.0,  # interior angle at left elbow
    right_elbow_angle: float = 155.0,  # interior angle at right elbow
    weight_distribution: float = 0.5,  # 0=trail, 1=lead
) -> Dict[str, Dict]:
    """
    Returns a dict of { joint_name: {x, y, confidence} } in normalized [0,1] coords.

    Coordinate system: origin top-left, x→right, y→down.
    A full standing figure occupies roughly y=[0.05, 0.95].

    Approach:
    1. Place mid_hip at a fixed anchor point.
    2. Rotate spine by spine_angle to find mid_shoulder.
    3. Rotate hip line by hip_rotation to find left/right hips.
    4. Rotate shoulder line by shoulder_rotation to find shoulders.
    5. Extend arms from shoulders using elbow angles (simplified 2D kinematics).
    6. Extend legs from hips.
    """
    # ── Body segment lengths (normalized, ~portrait 3:4 aspect) ────────────
    TORSO   = 0.22
    UPPER_A = 0.11
    FORE_A  = 0.10
    THIGH   = 0.18
    SHIN    = 0.16
    HEAD_R  = 0.05
    HIP_W   = 0.10
    SHLDR_W = 0.11

    # ── Hip anchor ─────────────────────────────────────────────────────────
    # Shift slightly based on weight distribution (positive x = lead/left side)
    hip_cx = 0.5 - (weight_distribution - 0.5) * 0.04
    hip_cy = 0.63

    # ── Spine direction ────────────────────────────────────────────────────
    spine_rad = math.radians(spine_angle)
    # Spine goes UP and slightly forward (positive spine_angle = tilt toward ball)
    spine_dx = math.sin(spine_rad)
    spine_dy = -math.cos(spine_rad)  # negative because y increases downward

    shldr_cx = hip_cx + TORSO * spine_dx
    shldr_cy = hip_cy + TORSO * spine_dy

    # ── Hip joints ─────────────────────────────────────────────────────────
    hip_rad = math.radians(hip_rotation)
    lh_x = hip_cx - HIP_W * math.cos(hip_rad)
    lh_y = hip_cy - HIP_W * math.sin(hip_rad)
    rh_x = hip_cx + HIP_W * math.cos(hip_rad)
    rh_y = hip_cy + HIP_W * math.sin(hip_rad)

    # ── Shoulder joints ────────────────────────────────────────────────────
    sh_rad = math.radians(shoulder_rotation)
    ls_x = shldr_cx - SHLDR_W * math.cos(sh_rad)
    ls_y = shldr_cy - SHLDR_W * math.sin(sh_rad)
    rs_x = shldr_cx + SHLDR_W * math.cos(sh_rad)
    rs_y = shldr_cy + SHLDR_W * math.sin(sh_rad)

    # ── Head ───────────────────────────────────────────────────────────────
    nose_x = shldr_cx + spine_dx * 0.06
    nose_y = shldr_cy - 0.09

    # ── Left arm (lead arm in a right-handed swing) ─────────────────────────
    # Lead arm swings forward and down at address; rotates back on backswing
    lead_arm_dir = math.radians(-15 + shoulder_rotation * 0.4)
    le_x = ls_x + UPPER_A * math.cos(lead_arm_dir)
    le_y = ls_y + UPPER_A * math.sin(lead_arm_dir)

    # Wrist continues from elbow — deflected by elbow angle
    le_bend  = math.radians(180 - left_elbow_angle) * 0.5
    lw_dir   = lead_arm_dir + le_bend
    lw_x     = le_x + FORE_A * math.cos(lw_dir)
    lw_y     = le_y + FORE_A * math.sin(lw_dir)

    # ── Right arm (trail arm) ───────────────────────────────────────────────
    trail_arm_dir = math.radians(-165 + shoulder_rotation * 0.4)
    re_x = rs_x + UPPER_A * math.cos(trail_arm_dir)
    re_y = rs_y + UPPER_A * math.sin(trail_arm_dir)

    re_bend  = math.radians(180 - right_elbow_angle) * 0.5
    rw_dir   = trail_arm_dir - re_bend
    rw_x     = re_x + FORE_A * math.cos(rw_dir)
    rw_y     = re_y + FORE_A * math.sin(rw_dir)

    # ── Legs ───────────────────────────────────────────────────────────────
    # Lead (left) leg: weight-shift bends the knee slightly inward
    lk_x = lh_x + 0.01 * (weight_distribution - 0.5)
    lk_y = lh_y + THIGH
    la_x = lk_x
    la_y = lk_y + SHIN

    # Trail (right) leg: more flexed at heavier weights
    rk_x = rh_x - 0.01 * (1 - weight_distribution)
    rk_y = rh_y + THIGH * (1 + (1 - weight_distribution) * 0.04)
    ra_x = rk_x
    ra_y = rk_y + SHIN

    # ── Clip all to [0.02, 0.98] and build output ───────────────────────────
    def pt(x: float, y: float) -> Dict:
        return {
            "x":          max(0.02, min(0.98, x)),
            "y":          max(0.02, min(0.98, y)),
            "confidence": 1.0,
        }

    return {
        "nose":           pt(nose_x,  nose_y),
        "left_shoulder":  pt(ls_x,    ls_y),
        "right_shoulder": pt(rs_x,    rs_y),
        "left_elbow":     pt(le_x,    le_y),
        "right_elbow":    pt(re_x,    re_y),
        "left_wrist":     pt(lw_x,    lw_y),
        "right_wrist":    pt(rw_x,    rw_y),
        "left_hip":       pt(lh_x,    lh_y),
        "right_hip":      pt(rh_x,    rh_y),
        "left_knee":      pt(lk_x,    lk_y),
        "right_knee":     pt(rk_x,    rk_y),
        "left_ankle":     pt(la_x,    la_y),
        "right_ankle":    pt(ra_x,    ra_y),
        "mid_hip":        pt(hip_cx,  hip_cy),
        "mid_shoulder":   pt(shldr_cx, shldr_cy),
    }
