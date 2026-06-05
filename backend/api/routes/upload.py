from __future__ import annotations
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile

from api.session_manager import session_manager
from auth.routes import get_current_user
from models.schemas import UploadResponse
from services.video_ingestion import VideoIngestionError, extract_video_metadata, save_uploaded_video

log    = logging.getLogger(__name__)
router = APIRouter()


@router.post("/upload", response_model=UploadResponse)
async def upload_video(
    video:          UploadFile     = File(...),
    pro_id:         str            = Form(default="tiger_2000"),
    handedness:     str            = Form(default="right"),    # "right" | "left"
    camera_angle:   str            = Form(default="dtl"),      # "dtl"   | "face_on"
    video_rotation: int            = Form(default=0),          # 0 | 90 | 180 | 270
    current_user:   Optional[dict] = Depends(get_current_user),
):
    """
    Accept a video upload with swing metadata.

    video_rotation: manual override for orientation (0 = auto-detect).
    handedness + camera_angle: used by the DTW phase detector.
    """
    if handedness   not in ("right", "left"):      handedness   = "right"
    if camera_angle not in ("dtl",  "face_on"):   camera_angle = "dtl"
    if video_rotation not in (0, 90, 180, 270):   video_rotation = 0

    user_id    = current_user["id"] if current_user else None
    session_id = session_manager.create_session(
        pro_id=         pro_id,
        user_id=        user_id,
        handedness=     handedness,
        camera_angle=   camera_angle,
        video_rotation= video_rotation,
    )
    session_dir = session_manager.get_session_dir(session_id)

    log.info(
        "Upload: session=%s pro=%s hand=%s cam=%s rot=%d user=%s",
        session_id, pro_id, handedness, camera_angle, video_rotation, user_id,
    )

    try:
        file_bytes = await video.read()
        video_path = await save_uploaded_video(
            file_bytes, video.filename or "video.mp4", session_dir
        )
        metadata = extract_video_metadata(video_path)
    except VideoIngestionError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except Exception as exc:
        log.error("Upload failed for %s: %s", session_id, exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"Upload failed: {exc}")

    # Build the actual video URL using the real file extension
    video_url = f"/sessions/{session_id}/video{video_path.suffix}"
    return UploadResponse(session_id=session_id, metadata=metadata, video_url=video_url)
