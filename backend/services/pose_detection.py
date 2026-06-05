"""
Pose detection using MediaPipe Pose.
Mirrors Swift PoseEstimationService (Vision VNDetectHumanBodyPoseRequest).

Processes each extracted frame, detects 33 body landmarks,
maps them to our JointName vocabulary, and computes JointAngles.
"""
from __future__ import annotations
import math
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

import cv2
import mediapipe as mp
import numpy as np

from models.schemas import FrameData, JointAngles, Keypoint
from services.angle_calculator import AngleCalculator

# MediaPipe landmark index → our joint name
LANDMARK_MAP: Dict[int, str] = {
    0:  "nose",
    7:  "left_ear",
    8:  "right_ear",
    11: "left_shoulder",
    12: "right_shoulder",
    13: "left_elbow",
    14: "right_elbow",
    15: "left_wrist",
    16: "right_wrist",
    23: "left_hip",
    24: "right_hip",
    25: "left_knee",
    26: "right_knee",
    27: "left_ankle",
    28: "right_ankle",
}

# Skeleton edges (joint_name_a, joint_name_b) — used by frontend renderer
SKELETON_EDGES: List[Tuple[str, str]] = [
    ("left_shoulder",  "right_shoulder"),
    ("left_shoulder",  "left_elbow"),
    ("left_elbow",     "left_wrist"),
    ("right_shoulder", "right_elbow"),
    ("right_elbow",    "right_wrist"),
    ("left_shoulder",  "left_hip"),
    ("right_shoulder", "right_hip"),
    ("left_hip",       "right_hip"),
    ("left_hip",       "left_knee"),
    ("left_knee",      "left_ankle"),
    ("right_hip",      "right_knee"),
    ("right_knee",     "right_ankle"),
    ("nose",           "left_shoulder"),
    ("nose",           "right_shoulder"),
]


def detect_poses(
    frames: List[FrameData],
    progress_cb: Optional[Callable[[float], None]] = None,
) -> List[FrameData]:
    """
    Run MediaPipe Pose on every frame.
    Returns frames with .keypoints and .angles populated in-place.
    """
    mp_pose = mp.solutions.pose

    with mp_pose.Pose(
        static_image_mode=True,
        model_complexity=1,          # 0=lite, 1=full, 2=heavy
        enable_segmentation=False,
        min_detection_confidence=0.5,
    ) as pose:
        total = len(frames)
        for idx, frame in enumerate(frames):
            try:
                _process_frame(frame, pose)
            except Exception:
                pass  # keep going on bad frames

            if progress_cb:
                progress_cb((idx + 1) / total)

    return frames


def _process_frame(frame: FrameData, pose) -> None:
    image = cv2.imread(frame.image_path)
    if image is None:
        return

    image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    h, w = image_rgb.shape[:2]

    results = pose.process(image_rgb)
    if not results.pose_landmarks:
        return

    landmarks = results.pose_landmarks.landmark

    # Map MediaPipe landmarks → our Keypoint dict
    keypoints: Dict[str, Keypoint] = {}
    for mp_idx, joint_name in LANDMARK_MAP.items():
        lm = landmarks[mp_idx]
        # MediaPipe uses top-left origin, y increases downward — matches our convention
        keypoints[joint_name] = Keypoint(
            x=float(np.clip(lm.x, 0, 1)),
            y=float(np.clip(lm.y, 0, 1)),
            confidence=float(lm.visibility),
        )

    # Derive synthetic midpoints
    ls = keypoints.get("left_shoulder")
    rs = keypoints.get("right_shoulder")
    lh = keypoints.get("left_hip")
    rh = keypoints.get("right_hip")

    if ls and rs and ls.is_reliable and rs.is_reliable:
        keypoints["mid_shoulder"] = Keypoint(
            x=(ls.x + rs.x) / 2,
            y=(ls.y + rs.y) / 2,
            confidence=min(ls.confidence, rs.confidence),
        )
    if lh and rh and lh.is_reliable and rh.is_reliable:
        keypoints["mid_hip"] = Keypoint(
            x=(lh.x + rh.x) / 2,
            y=(lh.y + rh.y) / 2,
            confidence=min(lh.confidence, rh.confidence),
        )

    frame.keypoints = keypoints
    frame.angles = AngleCalculator.compute(keypoints)


def get_skeleton_edges() -> List[Tuple[str, str]]:
    return SKELETON_EDGES
