from __future__ import annotations
import asyncio
import json

from fastapi import APIRouter, BackgroundTasks, HTTPException
from fastapi.responses import StreamingResponse

from api.session_manager import session_manager
from pipeline import run_pipeline

router = APIRouter()


@router.post("/process/{session_id}")
async def start_processing(session_id: str, background_tasks: BackgroundTasks):
    """
    Kick off the full analysis pipeline in a background thread.
    Returns immediately; client polls /progress/{session_id} for updates.
    """
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(status_code=404, detail="Session not found.")
    if status.status in ("processing", "complete"):
        return {"status": status.status, "message": "Already running or complete."}

    background_tasks.add_task(run_pipeline, session_id)
    return {"status": "processing", "session_id": session_id}


@router.get("/progress/{session_id}")
async def stream_progress(session_id: str):
    """
    Server-Sent Events endpoint.
    Emits a progress JSON event every 500ms until the pipeline finishes.
    """
    if not session_manager.get_status(session_id):
        raise HTTPException(status_code=404, detail="Session not found.")

    async def event_generator():
        while True:
            status = session_manager.get_status(session_id)
            if not status:
                break

            event_data = {
                "status":  status.status,
                "progress": status.progress.model_dump() if status.progress else None,
                "error":   status.error,
            }
            yield f"data: {json.dumps(event_data)}\n\n"

            if status.status in ("complete", "failed"):
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",    # disable nginx buffering
        },
    )


@router.get("/status/{session_id}")
async def get_status(session_id: str):
    """Simple JSON status poll (alternative to SSE for environments that block it)."""
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(status_code=404, detail="Session not found.")
    return status
