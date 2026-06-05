"""
Frame extraction with robust video orientation correction.

Orientation strategy (in order of preference):
  1. Manual override — user explicitly set video_rotation=90 on upload.
  2. ffprobe metadata — reads the `rotate` tag from the video stream.
  3. Aspect-ratio heuristic — if OpenCV reads the video as landscape but
     the raw frame dimensions look like a portrait phone video sideways
     (width / height > 1.6), rotate 90° CW as the most common fix.

Mobile videos shot in portrait orientation embed a rotation tag that
cv2.VideoCapture ignores, causing sideways frames.
"""
from __future__ import annotations
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Callable, List, Optional

import cv2
import numpy as np

from models.schemas import FrameData, JointAngles

log          = logging.getLogger(__name__)
TARGET_FPS   = float(os.getenv("TARGET_FPS", "30"))
MAX_FRAMES   = int(os.getenv("MAX_FRAMES", "300"))
JPEG_QUALITY = 85


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_frames(
    video_path:     Path,
    session_dir:    Path,
    target_fps:     float                         = TARGET_FPS,
    max_frames:     int                           = MAX_FRAMES,
    manual_rotation: int                          = 0,    # 0 | 90 | 180 | 270
    progress_cb:    Optional[Callable[[float], None]] = None,
) -> List[FrameData]:
    """
    Extract frames and correct orientation.
    manual_rotation takes precedence over all auto-detection.
    """
    frames_dir = session_dir / "frames"
    frames_dir.mkdir(exist_ok=True)

    # Determine rotation
    if manual_rotation in (90, 180, 270):
        rotation = manual_rotation
        log.info("Using manual rotation: %d°", rotation)
    else:
        rotation = _detect_rotation(video_path)
        if rotation:
            log.info("Auto-detected rotation: %d°", rotation)

    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise RuntimeError(f"Cannot open video: {video_path}")

    try:
        native_fps    = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames  = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        effective_fps = min(target_fps, native_fps)
        frame_interval = max(1, int(round(native_fps / effective_fps)))

        indices = list(range(0, total_frames, frame_interval))
        if len(indices) > max_frames:
            step    = len(indices) / max_frames
            indices = [indices[int(i * step)] for i in range(max_frames)]

        results: List[FrameData] = []
        total = len(indices)

        # Probe aspect ratio with the first frame (before any rotation)
        if not rotation:
            cap.set(cv2.CAP_PROP_POS_FRAMES, 0)
            ret, probe = cap.read()
            if ret:
                h, w = probe.shape[:2]
                ratio = w / h if h > 0 else 1.0
                # Wide frame from a portrait video shot sideways → rotate CW
                if ratio > 1.55:
                    log.info(
                        "Aspect ratio %.2f looks like sideways portrait — applying 90° CW rotation.",
                        ratio,
                    )
                    rotation = 90

        for output_idx, native_idx in enumerate(indices):
            cap.set(cv2.CAP_PROP_POS_FRAMES, native_idx)
            ret, frame = cap.read()
            if not ret:
                continue

            if rotation:
                frame = _rotate_frame(frame, rotation)

            frame     = _resize_long_edge(frame, 1080)
            filename  = f"frame_{output_idx:05d}.jpg"
            file_path = frames_dir / filename
            cv2.imwrite(str(file_path), frame, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])

            results.append(FrameData(
                frame_index=output_idx,
                timestamp=  round(native_idx / native_fps, 4),
                image_path= str(file_path),
                image_url=  f"/sessions/{session_dir.name}/frames/{filename}",
                angles=     JointAngles(),
            ))

            if progress_cb:
                progress_cb((output_idx + 1) / total)

        log.info("Extracted %d frames from %s (rotation=%d°)", len(results), video_path.name, rotation)
        return sorted(results, key=lambda f: f.frame_index)

    finally:
        cap.release()


# ---------------------------------------------------------------------------
# Rotation detection
# ---------------------------------------------------------------------------

def _detect_rotation(video_path: Path) -> int:
    """Try ffprobe; return 0 if unavailable (aspect heuristic applied later)."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_streams",
             str(video_path)],
            capture_output=True, text=True, timeout=10,
        )
        if result.returncode != 0:
            return 0
        data = json.loads(result.stdout)
        for stream in data.get("streams", []):
            tags = stream.get("tags", {})
            if "rotate" in tags:
                return int(tags["rotate"])
            for side in stream.get("side_data_list", []):
                if "rotation" in side:
                    return int(side["rotation"])
    except FileNotFoundError:
        log.debug("ffprobe not found — relying on aspect-ratio heuristic.")
    except Exception as exc:
        log.warning("ffprobe failed: %s", exc)
    return 0


def _rotate_frame(frame: np.ndarray, degrees: int) -> np.ndarray:
    if degrees in (90, -270):
        return cv2.rotate(frame, cv2.ROTATE_90_CLOCKWISE)
    if degrees in (180, -180):
        return cv2.rotate(frame, cv2.ROTATE_180)
    if degrees in (270, -90):
        return cv2.rotate(frame, cv2.ROTATE_90_COUNTERCLOCKWISE)
    return frame


def _resize_long_edge(frame: np.ndarray, max_dim: int) -> np.ndarray:
    h, w = frame.shape[:2]
    if max(h, w) <= max_dim:
        return frame
    scale = max_dim / max(h, w)
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
