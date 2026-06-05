from __future__ import annotations

from fastapi import APIRouter, HTTPException

from api.session_manager import session_manager
from services.pro_comparison import load_pro_catalog

router = APIRouter()


@router.get("/results/{session_id}")
async def get_results(session_id: str):
    """
    Return the complete SwingAnalysis JSON once the pipeline is complete.
    The heavy frame arrays are included — the frontend picks what it needs.
    """
    status = session_manager.get_status(session_id)
    if not status:
        raise HTTPException(status_code=404, detail="Session not found.")
    if status.status == "failed":
        raise HTTPException(status_code=422, detail=f"Analysis failed: {status.error}")
    if status.status != "complete":
        raise HTTPException(status_code=202, detail="Analysis still in progress.")

    analysis = session_manager.get_results(session_id)
    if not analysis:
        raise HTTPException(status_code=404, detail="Results not available.")

    return analysis


# /pros is served by api/routes/pro.py to avoid duplication
