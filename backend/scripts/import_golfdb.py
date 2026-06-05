#!/usr/bin/env python3
"""
Bulk import of GolfDB swing videos into the Swing Coach reference library.

Usage (run from the backend/ directory):
    python scripts/import_golfdb.py

Options:
    --csv PATH          CSV file path  (default: data/golfdb.csv)
    --videos-dir PATH   Directory containing {id}.mp4 files
                        (default: data/library_videos/)
    --dry-run           Print what would be imported, don't write anything
    --no-transcode      Skip H.264 transcoding (faster, may not play in all browsers)
    --skip-existing     Skip rows whose video is already in the library

Example:
    python scripts/import_golfdb.py --csv data/golf_shortened.csv --dry-run

CSV columns expected:
    id, player, hand, sex, club, view, events

events column: JSON list of 10 frame indices
    [0]    = first frame of video  (ignored)
    [1..8] = the 8 swing phases    (used)
    [9]    = last frame of video   (ignored)

Phase mapping:
    events[1] → Address
    events[2] → Takeaway
    events[3] → Backswing
    events[4] → Top of Swing
    events[5] → Downswing
    events[6] → Impact
    events[7] → Follow Through
    events[8] → Finish
"""
from __future__ import annotations

import argparse
import ast
import csv
import logging
import sys
from pathlib import Path

# ── Path setup: allow imports from backend/ root ──────────────────────────
BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))

import cv2
from services.library_service import (
    LIBRARY_DIR, add_entry_from_disk, list_entries,
)

# ── Logging ───────────────────────────────────────────────────────────────
logging.basicConfig(level=logging.INFO, format="%(levelname)-8s %(message)s")
log = logging.getLogger(__name__)

# ── Mapping tables ────────────────────────────────────────────────────────

# events index → phase name  (events[0] and events[9] are start/end, ignored)
PHASE_MAP = {
    1: "Address",
    2: "Takeaway",
    3: "Backswing",
    4: "Top of Swing",
    5: "Downswing",
    6: "Impact",
    7: "Follow Through",
    8: "Finish",
}

CAMERA_MAP = {
    "face-on":       "face_on",
    "down-the-line": "dtl",
}

CLUB_MAP = {
    "driver":  "driver",
    "iron":    "irons",
    "fairway": "irons",   # fairway wood → irons is closest existing category
    "wedge":   "wedges",
    "putter":  "putter",
}

GENDER_MAP = {
    "m": "male",
    "f": "female",
}

HAND_MAP = {
    "r": "right",
    "l": "left",
}

# ── Helpers ───────────────────────────────────────────────────────────────

def get_video_fps(video_path: Path) -> float:
    """Read FPS from video metadata via OpenCV. Falls back to 30fps."""
    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    cap.release()
    return round(fps, 3)


def events_to_phase_times(events: list[int], fps: float) -> dict[str, float]:
    """
    Convert frame-index events to phase timestamps in seconds.
    Uses the video's actual FPS so conversion is accurate.
    """
    return {
        phase_name: round(events[idx] / fps, 4)
        for idx, phase_name in PHASE_MAP.items()
        if idx < len(events)
    }


def existing_descriptions(entries: list) -> set[str]:
    """Return set of GolfDB descriptions already in the library."""
    return {e.description for e in entries if "GolfDB" in e.description}

# ── Main ─────────────────────────────────────────────────────────────────

def run(csv_path: Path, videos_dir: Path, dry_run: bool,
        no_transcode: bool, skip_existing: bool) -> None:

    if not csv_path.exists():
        log.error("CSV not found: %s", csv_path)
        sys.exit(1)

    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)

    # Pre-load existing entries for duplicate detection
    existing = existing_descriptions(list_entries()) if skip_existing else set()

    imported = 0
    skipped  = 0
    errors   = 0

    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)

        for row in reader:
            vid_id = row.get("id", "").strip()
            if not vid_id:
                continue

            try:
                # ── Parse CSV fields ───────────────────────────────────────
                player    = row["player"].strip().title()
                hand_raw  = row["hand"].strip().lower()
                sex_raw   = row["sex"].strip().lower()
                club_raw  = row["club"].strip().lower()
                view_raw  = row["view"].strip().lower()
                events_str = row["events"].strip()

                handedness   = HAND_MAP.get(hand_raw, "right")
                gender       = GENDER_MAP.get(sex_raw, "male")
                camera_angle = CAMERA_MAP.get(view_raw, "dtl")
                club_type    = CLUB_MAP.get(club_raw, "other")

                # ── Parse events ───────────────────────────────────────────
                try:
                    events = ast.literal_eval(events_str)
                    if not isinstance(events, (list, tuple)):
                        raise ValueError("not a list")
                except Exception:
                    log.warning("SKIP %s: cannot parse events: %s", vid_id, events_str[:60])
                    skipped += 1
                    continue

                events = [int(x) for x in events]

                if len(events) != 10:
                    log.warning("SKIP %s: events length %d != 10", vid_id, len(events))
                    skipped += 1
                    continue

                # Sanity: phase frames should be monotonically increasing
                phase_frames = events[1:9]
                if phase_frames != sorted(phase_frames):
                    log.warning("SKIP %s: phase frames not sorted: %s", vid_id, phase_frames)
                    skipped += 1
                    continue

                # ── Locate video ────────────────────────────────────────────
                video_path = videos_dir / f"{vid_id}.mp4"
                if not video_path.exists():
                    log.warning("SKIP %s: video not found at %s", vid_id, video_path)
                    skipped += 1
                    continue

                # ── Build display name ──────────────────────────────────────
                view_label = "DTL" if camera_angle == "dtl" else "Face-on"
                name = f"{player} — {club_type.title()} {view_label}"
                description = f"GolfDB #{vid_id}. {player}, {view_raw}, {club_raw}."

                # ── Duplicate check ─────────────────────────────────────────
                if skip_existing and description in existing:
                    log.info("SKIP %s: already in library (%s)", vid_id, name)
                    skipped += 1
                    continue

                # ── Get video FPS and convert events → timestamps ───────────
                fps         = get_video_fps(video_path)
                phase_times = events_to_phase_times(events, fps)

                # Validate: all phase timestamps should be within video duration
                cap            = cv2.VideoCapture(str(video_path))
                total_frames   = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
                cap.release()
                last_event = max(events[1:9])
                if total_frames > 0 and last_event >= total_frames:
                    log.warning(
                        "SKIP %s: phase frame %d >= total frames %d",
                        vid_id, last_event, total_frames
                    )
                    skipped += 1
                    continue

                tags = [player, club_raw, view_raw, gender, handedness]

                # ── Dry run output ──────────────────────────────────────────
                if dry_run:
                    log.info(
                        "DRY RUN  %-6s  %-40s  fps=%-6.1f  phases=%d/8",
                        vid_id, name, fps, len(phase_times)
                    )
                    imported += 1
                    continue

                # ── Import ─────────────────────────────────────────────────
                log.info("Importing %s — %s (fps=%.1f)…", vid_id, name, fps)
                entry = add_entry_from_disk(
                    source_video_path=video_path,
                    name=name,
                    camera_angle=camera_angle,
                    handedness=handedness,
                    gender=gender,
                    club_type=club_type,
                    description=description,
                    tags=tags,
                    phase_times=phase_times,
                    source="preloaded",
                    transcode=(not no_transcode),
                )

                if entry:
                    log.info(
                        "  OK  entry_id=%s  phases=%d/8  duration=%.1fs",
                        entry.id, len(entry.phase_times), entry.duration or 0
                    )
                    imported += 1
                else:
                    log.error("  ERR %s: add_entry_from_disk returned None", vid_id)
                    errors += 1

            except Exception as exc:
                log.error("ERR %s: %s", vid_id, exc, exc_info=True)
                errors += 1

    print()
    print(f"{'DRY RUN — ' if dry_run else ''}Results: "
          f"{imported} imported, {skipped} skipped, {errors} errors")

    if not dry_run and imported > 0:
        print(f"\nLibrary entries saved to: {LIBRARY_DIR.parent / 'library' / 'library.json'}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Bulk import GolfDB videos")
    parser.add_argument(
        "--csv",
        default=str(BACKEND_DIR / "data" / "golfdb.csv"),
        help="Path to the CSV file",
    )
    parser.add_argument(
        "--videos-dir",
        default=str(BACKEND_DIR / "data" / "library_videos"),
        help="Directory containing {id}.mp4 files",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be imported without writing anything",
    )
    parser.add_argument(
        "--no-transcode",
        action="store_true",
        help="Skip H.264 transcoding (faster startup, may not play in all browsers)",
    )
    parser.add_argument(
        "--skip-existing",
        action="store_true",
        help="Skip rows that are already in the library (idempotent re-runs)",
    )
    args = parser.parse_args()

    run(
        csv_path=    Path(args.csv),
        videos_dir=  Path(args.videos_dir),
        dry_run=     args.dry_run,
        no_transcode=args.no_transcode,
        skip_existing=args.skip_existing,
    )


if __name__ == "__main__":
    main()
