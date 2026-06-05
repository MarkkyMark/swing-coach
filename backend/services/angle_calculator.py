"""
Stateless geometry utilities for computing joint angles from pose keypoints.
Direct Python port of Swift AngleCalculator.
"""
from __future__ import annotations
import math
from typing import Dict, Optional, Tuple

from models.schemas import JointAngles, Keypoint

Point = Tuple[float, float]  # (x, y) normalized


class AngleCalculator:

    @staticmethod
    def compute(keypoints: Dict[str, Keypoint]) -> JointAngles:
        def pos(name: str) -> Optional[Point]:
            kp = keypoints.get(name)
            return (kp.x, kp.y) if kp and kp.is_reliable else None

        return JointAngles(
            left_elbow_angle=AngleCalculator.three_point_angle(
                pos("left_shoulder"), pos("left_elbow"), pos("left_wrist")),
            right_elbow_angle=AngleCalculator.three_point_angle(
                pos("right_shoulder"), pos("right_elbow"), pos("right_wrist")),
            left_shoulder_angle=AngleCalculator.three_point_angle(
                pos("left_hip"), pos("left_shoulder"), pos("left_elbow")),
            right_shoulder_angle=AngleCalculator.three_point_angle(
                pos("right_hip"), pos("right_shoulder"), pos("right_elbow")),
            spine_angle=AngleCalculator.spine_angle(
                pos("mid_shoulder"), pos("mid_hip")),
            hip_rotation=AngleCalculator.line_angle(
                pos("left_hip"), pos("right_hip")),
            shoulder_rotation=AngleCalculator.line_angle(
                pos("left_shoulder"), pos("right_shoulder")),
            left_knee_angle=AngleCalculator.three_point_angle(
                pos("left_hip"), pos("left_knee"), pos("left_ankle")),
            right_knee_angle=AngleCalculator.three_point_angle(
                pos("right_hip"), pos("right_knee"), pos("right_ankle")),
        )

    @staticmethod
    def three_point_angle(
        a: Optional[Point],
        vertex: Optional[Point],
        b: Optional[Point],
    ) -> Optional[float]:
        """Interior angle at `vertex` formed by rays to a and b, in degrees."""
        if a is None or vertex is None or b is None:
            return None
        vax = a[0] - vertex[0]
        vay = a[1] - vertex[1]
        vbx = b[0] - vertex[0]
        vby = b[1] - vertex[1]
        dot  = vax * vbx + vay * vby
        magA = math.sqrt(vax ** 2 + vay ** 2)
        magB = math.sqrt(vbx ** 2 + vby ** 2)
        if magA < 1e-9 or magB < 1e-9:
            return None
        cos_theta = max(-1.0, min(1.0, dot / (magA * magB)))
        return math.degrees(math.acos(cos_theta))

    @staticmethod
    def spine_angle(
        shoulder: Optional[Point],
        hip: Optional[Point],
    ) -> Optional[float]:
        """Forward lean: angle of spine vector from vertical (0° = upright)."""
        if shoulder is None or hip is None:
            return None
        dx = shoulder[0] - hip[0]
        dy = shoulder[1] - hip[1]      # y increases downward
        return abs(math.degrees(math.atan2(dx, -dy)))  # negate dy so up = 0

    @staticmethod
    def line_angle(
        a: Optional[Point],
        b: Optional[Point],
    ) -> Optional[float]:
        """Angle of line segment from horizontal, in degrees [-180, 180]."""
        if a is None or b is None:
            return None
        return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))

    @staticmethod
    def distance(a: Point, b: Point) -> float:
        return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2)
