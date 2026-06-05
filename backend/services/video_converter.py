"""
Video processing for guaranteed browser-safe H.264 playback.

STRATEGY
════════
We always want to serve H.264 + AAC + yuv420p MP4 with the moov atom at
the front (faststart). This format plays in every browser without plugins.

ffmpeg source priority:
  1. imageio-ffmpeg   — ships its own ffmpeg binary via pip (no system install)
  2. System ffmpeg    — falls back to whatever `ffmpeg` is on $PATH
  3. qtfaststart only — if no ffmpeg at all, at least fix the moov position

The old MPEG-4 Part 2 (mp4v) codec is the most common "SRC_NOT_SUPPORTED"
cause — Chrome has not supported it in HTML5 video since Chrome 33 (2014).
H.264 (avc1) re-encoding fixes it.
"""
from __future__ import annotations
import logging
import shutil
import subprocess
from pathlib import Path
from typing import Optional

log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Locate ffmpeg (prefer bundled imageio-ffmpeg binary)
# ---------------------------------------------------------------------------

def _find_ffmpeg() -> Optional[str]:
    """Return the path to ffmpeg, preferring the imageio-ffmpeg bundled copy."""
    # 1. imageio-ffmpeg ships a binary that works immediately after pip install
    try:
        import imageio_ffmpeg
        path = imageio_ffmpeg.get_ffmpeg_exe()
        if path and Path(path).exists():
            return path
    except Exception:
        pass
    # 2. System ffmpeg
    system = shutil.which("ffmpeg")
    if system:
        return system
    return None


def ffmpeg_available() -> bool:
    return _find_ffmpeg() is not None


# ---------------------------------------------------------------------------
# Stage 1: qtfaststart — move moov atom to front (no re-encode, pure Python)
# ---------------------------------------------------------------------------

def apply_faststart(video_path: Path) -> Path:
    """Move the MP4 moov atom to the front without re-encoding."""
    if video_path.suffix.lower() not in (".mp4", ".m4v"):
        return video_path
    try:
        from qtfaststart import processor as qp
        from qtfaststart.exceptions import FastStartException
        tmp = video_path.with_suffix(".faststart_tmp.mp4")
        try:
            qp.process(str(video_path), str(tmp))
            tmp.replace(video_path)
            log.info("qtfaststart: moov relocated in %s", video_path.name)
        except FastStartException:
            tmp.unlink(missing_ok=True)  # already fast-start or not applicable
        return video_path
    except ImportError:
        log.debug("qtfaststart not installed")
        return video_path
    except Exception as exc:
        log.warning("qtfaststart error: %s", exc)
        return video_path


# ---------------------------------------------------------------------------
# Stage 2: ffmpeg — re-encode to H.264/AAC/yuv420p + faststart
# ---------------------------------------------------------------------------

def transcode_to_h264(input_path: Path, crf: int = 23, preset: str = "fast") -> Path:
    """
    Re-encode video to H.264 + AAC + yuv420p with moov faststart.

    Uses the imageio-ffmpeg bundled binary first (no system install needed).
    Falls back to apply_faststart-only if no ffmpeg is found anywhere.
    Returns the output path (always .mp4).
    """
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log.warning("No ffmpeg found — applying faststart only to %s", input_path.name)
        return apply_faststart(input_path)

    output_path = input_path.parent / "video.mp4"
    tmp_path    = input_path.parent / "_transcode_tmp.mp4"

    cmd = [
        ffmpeg, "-y",
        "-i",        str(input_path),
        "-vcodec",   "libx264",
        "-acodec",   "aac",
        "-pix_fmt",  "yuv420p",
        "-movflags", "+faststart",
        "-crf",      str(crf),
        "-preset",   preset,
        "-map_metadata", "-1",
        str(tmp_path),
    ]

    log.info("Transcoding %s → H.264 (ffmpeg: %s)…", input_path.name, Path(ffmpeg).name)
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)

        if result.returncode != 0:
            log.error("ffmpeg failed (rc=%d):\n%s", result.returncode, result.stderr[-2000:])
            tmp_path.unlink(missing_ok=True)
            return apply_faststart(input_path)   # best-effort fallback

        if output_path.exists():
            output_path.unlink()
        tmp_path.rename(output_path)

        if input_path.resolve() != output_path.resolve():
            input_path.unlink(missing_ok=True)

        log.info("Transcode OK: %s (%.1f KB)", output_path.name,
                 output_path.stat().st_size / 1000)
        return output_path

    except subprocess.TimeoutExpired:
        log.error("ffmpeg timed out for %s", input_path.name)
        tmp_path.unlink(missing_ok=True)
        return apply_faststart(input_path)
    except Exception as exc:
        log.error("ffmpeg error: %s", exc, exc_info=True)
        tmp_path.unlink(missing_ok=True)
        return apply_faststart(input_path)


# ---------------------------------------------------------------------------
# Startup helper — fix existing library videos
# ---------------------------------------------------------------------------

def transcode_existing_library() -> None:
    """Transcode all library videos that aren't already H.264."""
    ffmpeg = _find_ffmpeg()
    if not ffmpeg:
        log.warning("No ffmpeg available — skipping library transcode at startup.")
        return

    from services.library_service import LIBRARY_DIR
    for entry_dir in LIBRARY_DIR.iterdir():
        if not entry_dir.is_dir():
            continue
        for ext in (".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"):
            candidate = entry_dir / f"video{ext}"
            if candidate.exists():
                # Check if it's already H.264
                with open(candidate, "rb") as f:
                    chunk = f.read(4096)
                if b"avc1" in chunk or b"H264" in chunk:
                    log.debug("Already H.264: %s", candidate.name)
                else:
                    log.info("Startup transcode: %s", candidate)
                    transcode_to_h264(candidate)
                break
