"""
Video ingestion: validate, save, transcode, and extract metadata.
"""
import logging
import os
from pathlib import Path

import cv2

from models.schemas import VideoMetadata

log = logging.getLogger(__name__)

ALLOWED_EXTENSIONS   = {".mp4", ".mov", ".avi", ".mkv", ".webm"}
MAX_DURATION_SECONDS = float(os.getenv("MAX_VIDEO_DURATION_SECONDS", "90"))


class VideoIngestionError(Exception):
    pass


async def save_uploaded_video(file_bytes: bytes, filename: str, session_dir: Path) -> Path:
    """
    Save raw uploaded bytes to disk, transcode to H.264 for browser playback,
    and return the final video path (always .mp4 after transcoding).
    """
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise VideoIngestionError(
            f"Unsupported format '{ext}'. Allowed: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    video_path = session_dir / f"video{ext}"
    video_path.write_bytes(file_bytes)

    # Transcode to H.264/AAC/yuv420p with faststart for browser compatibility.
    # Uses imageio-ffmpeg bundled binary (no system install needed).
    from services.video_converter import transcode_to_h264
    video_path = transcode_to_h264(video_path)

    return video_path


def extract_video_metadata(video_path: Path) -> VideoMetadata:
    """Read duration, dimensions, FPS from video via OpenCV."""
    cap = cv2.VideoCapture(str(video_path))
    if not cap.isOpened():
        raise VideoIngestionError(f"Cannot open video: {video_path}")

    try:
        fps          = cap.get(cv2.CAP_PROP_FPS) or 30.0
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width        = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height       = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        duration     = total_frames / fps if fps > 0 else 0.0

        if duration > MAX_DURATION_SECONDS:
            raise VideoIngestionError(
                f"Video is {duration:.0f}s — maximum is {MAX_DURATION_SECONDS:.0f}s."
            )

        return VideoMetadata(
            duration=    round(duration, 3),
            width=       width,
            height=      height,
            fps=         round(fps, 2),
            total_frames=total_frames,
        )
    finally:
        cap.release()
